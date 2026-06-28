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

import { buildServices } from './services.js';
import { makeMessageHandler } from './discordAdapter.js';

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
  const { teaching, tenancy, log, discordToken } = await buildServices();

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

  client.on(Events.MessageCreate, (message) => {
    // The handler is self-contained and swallows its own errors; we still guard
    // the bridge so a rejected promise can never become an unhandled rejection.
    void onMessage(message).catch((err: unknown) => {
      log.error({ err: toError(err).message }, 'unhandled error in message handler');
    });
  });

  // Graceful shutdown: tear down the gateway connection so we deregister cleanly
  // rather than waiting for Discord to time the session out.
  const shutdown = (signal: string): void => {
    log.info({ signal }, 'shutting down discord worker');
    void client.destroy().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await client.login(discordToken);
}

main().catch((err: unknown) => {
  // A failure during boot (bad config, missing token, login rejected) is fatal:
  // log it and exit non-zero so the supervisor can restart/alert.
  const error = toError(err);
   
  console.error('discord worker failed to start:', error.message);
  process.exit(1);
});
