/**
 * Discord worker entrypoint.
 *
 * Boots the thin Discord channel adapter: build the services, connect a
 * discord.js gateway client, route every `messageCreate` event through the
 * governed pipeline, and log in. The client owns no policy — see
 * `./discordAdapter.ts` for the (deliberately dumb) handler.
 */

import { Client, Events, GatewayIntentBits } from 'discord.js';

import { toError } from '@vta/shared';
import { closeDb } from '@vta/data';

import { buildServices } from './services.js';
import { makeMessageHandler } from './discordAdapter.js';

/**
 * Hard deadline for graceful shutdown. Container Apps sends SIGTERM then SIGKILLs
 * ~30s later; we exit before that even if a close hangs, so we never die
 * mid-cleanup at the orchestrator's hand with an ambiguous state.
 */
const SHUTDOWN_TIMEOUT_MS = 25_000;

/**
 * Opt-in Application Insights. A no-op unless APPLICATIONINSIGHTS_CONNECTION_STRING
 * is set (so local/dev and unconfigured deploys pay nothing). The SDK is loaded
 * with a dynamic import so it never enters the startup path when telemetry is off.
 * Auto-collects console logs (our pino output), exceptions, and outbound HTTP.
 */
async function initTelemetry(): Promise<void> {
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (connectionString === undefined || connectionString === '') return;
  try {
    const appInsights = (await import('applicationinsights')).default;
    appInsights
      .setup(connectionString)
      .setAutoCollectConsole(true, true)
      .setAutoCollectExceptions(true)
      .setSendLiveMetrics(false)
      .start();
  } catch (err) {
    // Telemetry must never block the bot from starting.
    console.error('failed to initialize Application Insights (continuing without it):', toError(err).message);
  }
}

async function main(): Promise<void> {
  await initTelemetry();
  const { teaching, tenancy, log, discordToken, db } = await buildServices();

  // Intents declare which gateway events we receive.
  //   Guilds         — required for guild/channel/thread state.
  //   GuildMessages  — receive messages posted in guild channels.
  //   MessageContent — read the actual text of those messages.
  //
  // NOTE: MessageContent is a PRIVILEGED intent. It must be explicitly enabled
  // for the bot application in the Discord developer portal
  // (Bot → Privileged Gateway Intents → Message Content Intent), otherwise the
  // gateway connection is rejected at login.
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const onMessage = makeMessageHandler({ teaching, tenancy, log });

  client.once(Events.ClientReady, (ready) => {
    log.info({ tag: ready.user.tag }, 'discord worker logged in and ready');
  });

  // Gateway resilience: discord.js reconnects automatically, but the events are
  // otherwise silent. Observe them so a flapping connection is diagnosable (and
  // an unhandled 'error' can't crash the process). None of these are fatal — the
  // library recovers — so we only log.
  client.on(Events.Error, (err) => {
    log.error({ err: err.message }, 'discord client error');
  });
  client.on(Events.Warn, (info) => {
    log.warn({ info }, 'discord client warning');
  });
  client.on(Events.ShardError, (err, shardId) => {
    log.error({ err: err.message, shardId }, 'discord shard error');
  });
  client.on(Events.ShardDisconnect, (event, shardId) => {
    log.warn({ shardId, code: event.code }, 'discord shard disconnected');
  });
  client.on(Events.ShardReconnecting, (shardId) => {
    log.warn({ shardId }, 'discord shard reconnecting');
  });
  client.on(Events.ShardResume, (shardId, replayed) => {
    log.info({ shardId, replayed }, 'discord shard resumed');
  });

  // Track outstanding handler promises so graceful shutdown can DRAIN them:
  // client.destroy() stops new dispatches but does not join handlers already
  // running (each is a detached promise), so without this a message being
  // answered at SIGTERM would be killed mid-flight — losing the reply and its
  // audit write.
  const inFlight = new Set<Promise<void>>();

  client.on(Events.MessageCreate, (message) => {
    // The handler is self-contained and swallows its own errors; we still guard
    // the bridge so a rejected promise can never become an unhandled rejection.
    const p = onMessage(message).catch((err: unknown) => {
      log.error({ err: toError(err).message }, 'unhandled error in message handler');
    });
    inFlight.add(p);
    void p.finally(() => inFlight.delete(p));
  });

  // Graceful shutdown, in order: (1) tear down the gateway so we deregister
  // cleanly and stop accepting NEW messages; (2) DRAIN handlers already running
  // (client.destroy() does not join them) so their reply + audit write finish;
  // (3) close the Postgres pool. A hard deadline forces exit if any step hangs,
  // so the orchestrator never has to SIGKILL. `exitCode` distinguishes an
  // operator/orchestrator stop (0) from a crash-driven shutdown (non-zero) so
  // monitoring can tell a clean stop from a repeatedly-dying replica.
  let shuttingDown = false;
  const shutdown = (signal: string, exitCode = 0): void => {
    if (shuttingDown) return; // ignore repeated / overlapping signals
    shuttingDown = true;
    log.info({ signal, exitCode }, 'shutting down discord worker');

    const deadline = setTimeout(() => {
      log.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'graceful shutdown timed out; forcing exit');
      process.exit(exitCode === 0 ? 1 : exitCode);
    }, SHUTDOWN_TIMEOUT_MS);
    deadline.unref(); // don't let the timer itself keep the process alive

    void (async () => {
      try {
        await client.destroy();
      } catch (err) {
        log.error({ err: toError(err).message }, 'error destroying discord client during shutdown');
      }
      // Let in-flight handlers finish posting their reply + writing their audit
      // record. Bounded by the deadline above; allSettled so one failure doesn't
      // abandon the rest.
      if (inFlight.size > 0) {
        log.info({ inFlight: inFlight.size }, 'draining in-flight message handlers');
        await Promise.allSettled([...inFlight]);
      }
      try {
        await closeDb(db);
      } catch (err) {
        log.error({ err: toError(err).message }, 'error closing database pool during shutdown');
      }
      clearTimeout(deadline);
      process.exit(exitCode);
    })();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Last-resort process guards. A stray rejected promise should be logged, not
  // silently crash the worker (Node aborts on unhandled rejections). An uncaught
  // exception leaves the process in an unknown state, so log it and shut down
  // gracefully with a NON-ZERO code — the orchestrator restarts a clean replica
  // and monitoring sees a crash, not a clean stop.
  process.on('unhandledRejection', (reason) => {
    log.error({ err: toError(reason).message }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    log.error({ err: toError(err).message }, 'uncaught exception; shutting down');
    shutdown('uncaughtException', 1);
  });

  await client.login(discordToken);
}

main().catch((err: unknown) => {
  // A failure during boot (bad config, missing token, login rejected) is fatal:
  // log it and exit non-zero so the supervisor can restart/alert.
  const error = toError(err);
   
  console.error('discord worker failed to start:', error.message);
  process.exit(1);
});
