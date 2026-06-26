/**
 * Composition root for the Discord worker.
 *
 * The worker is a THIN channel adapter: it owns no answering, governance, or RAG
 * logic. This module wires the shared infrastructure (config, secrets, database)
 * and the two services the adapter actually calls:
 *
 *   - {@link TenancyService} — resolves which course + role an inbound Discord
 *     message belongs to (channel routing → tenant context).
 *   - `TeachingService` (from `@vta/core`) — runs the fixed, governed request
 *     pipeline and returns an already egress-governed {@link OutboundReply}.
 *
 * All the concrete-implementation choices (which agent, which redactor, which
 * judge) live inside `createTeachingService` in `@vta/core`; the worker just
 * hands it a {@link CoreConfig}. We never touch a model here.
 *
 * No I/O is performed at construction time: `createDb` builds a pool lazily and
 * `createTeachingService` is pure wiring. The only awaited call is resolving the
 * Discord bot token from the secrets provider.
 */

import { config as loadDotenv } from 'dotenv';

import type { CoreConfig , TeachingService } from '@vta/core';
import { createTeachingService } from '@vta/core';
import { TenancyService } from '@vta/tenancy';
import { createDb } from '@vta/data';
import type { Db } from '@vta/data';
import { loadProfile } from '@vta/llm';
import type { Logger, SecretsProvider } from '@vta/shared';
import { createLogger, createSecretsProvider, loadConfig } from '@vta/shared';

/** Everything the Discord gateway needs to handle a message and log in. */
export interface WorkerServices {
  /** The governed request orchestrator. The worker calls `handle()` and nothing else. */
  readonly teaching: TeachingService;
  /** Resolves the owning course + the caller's role for an inbound message. */
  readonly tenancy: TenancyService;
  /** Root logger for the worker (named children are derived per component). */
  readonly log: Logger;
  /** The resolved Discord bot token, fetched from the secrets provider. */
  readonly discordToken: string;
}

/**
 * Build and wire every service the worker depends on.
 *
 * Order: load `.env` → validate process config → build the secrets provider →
 * build the shared `Db` → load the active LLM role mapping → construct the
 * `TenancyService` (over the same `Db`) and the `TeachingService` (via the core
 * composition root) → resolve the Discord bot token.
 */
export async function buildServices(): Promise<WorkerServices> {
  // Local development reads secrets/config from a `.env` file; in production the
  // process environment is already populated. `dotenv` never overrides an
  // already-set variable, so this is safe to call unconditionally.
  loadDotenv();

  // Fail fast on missing/invalid infrastructure config before any wiring.
  const config = loadConfig();

  const log = createLogger({ name: 'discord-worker', level: config.LOG_LEVEL });

  // Secrets (LLM keys, Canvas tokens, the Discord bot token) come from env in
  // development and Key Vault in production — behind one interface either way.
  const secrets: SecretsProvider = createSecretsProvider({
    provider: config.SECRETS_PROVIDER,
    ...(config.AZURE_KEY_VAULT_URL !== undefined ? { vaultUrl: config.AZURE_KEY_VAULT_URL } : {}),
    env: process.env,
  });

  // One shared connection pool. Tenancy reads course/role/config from it; core
  // reads retrieval chunks and writes the audit log through it.
  const db: Db = createDb(config.DATABASE_URL);

  // The active logical-role → concrete-model mapping for this deployment.
  const mapping = loadProfile(config.LLM_PROFILE);

  // Tenancy front door — constructs its own course/role resolvers over the Db.
  const tenancy = new TenancyService({ db, logger: log });

  // The governed pipeline. The worker never reaches past `handle()` into any of
  // the concrete governors/agents this composition root assembles.
  const coreConfig: CoreConfig = {
    db,
    secrets,
    mapping,
    logger: log,
  };
  const teaching = createTeachingService(coreConfig);

  // Resolve the bot token via the secrets abstraction. With the env provider,
  // `discord.bot-token` is mangled to the `DISCORD_BOT_TOKEN` environment
  // variable (UPPER_SNAKE, dots/dashes → underscores).
  const discordToken = await secrets.require('discord.bot-token');

  return { teaching, tenancy, log, discordToken };
}
