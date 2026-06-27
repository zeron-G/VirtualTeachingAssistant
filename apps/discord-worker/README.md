# @vta/discord-worker

The **thin Discord channel adapter** for the Virtual Teaching Assistant.

This app is deliberately dumb. For every inbound Discord message it does exactly
five things:

1. **Receives** the Discord message.
2. **Resolves** which course + role it belongs to via `@vta/tenancy`.
3. **Builds** a channel-agnostic `InboundRequest`.
4. **Calls** `TeachingService.handle()` (the governed pipeline in `@vta/core`).
5. **Posts** the returned `OutboundReply` **verbatim** back to Discord.

It contains **no answering, governance, or RAG logic**. The reply it posts is
already egress-governed by core — the worker never sees the model and never
posts raw model output or adds content of its own. A bug here cannot bypass
governance.

## How it behaves

- Ignores messages from bots (and itself), empty/whitespace-only messages, and
  DMs (Phase 1 is guild-only).
- If the channel maps to **no course**, the message is ignored **silently** (no
  reply), so the bot never leaks that any course exists.
- Replies are posted in a **per-student thread**: if the message is already in a
  thread, the reply goes there; otherwise the worker starts a thread on the
  message and posts inside it.
- The governed reply is posted on **every** status (`answered`, `refused`,
  `escalated`, `rate_limited`, `error`), split into ≤2000-char chunks when
  needed, so the student always receives the governed response.
- The message handler is fully isolated: any error is logged and swallowed, so
  one bad message can never crash the gateway.

## Required environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres (pgvector) connection string. Required. |
| `REDIS_URL` | Redis connection string (queue + rate-limit state). Defaults to `redis://localhost:6379`. |
| `LLM_PROFILE` | Active LLM profile: `dev` or `prod`. Defaults to `dev`. |
| `SECRETS_PROVIDER` | `env` (local) or `keyvault` (production). Defaults to `env`. |
| `DISCORD_BOT_TOKEN` | The Discord bot token. Resolved via the secrets provider as `discord.bot-token`. |
| `CANVAS_TOKEN_<COURSE>` | Per-course Canvas token (each professor brings their own), resolved as `canvas.token.<courseId>`. |

With `SECRETS_PROVIDER=env`, secret names are upper-cased with dots/dashes
turned into underscores. So `discord.bot-token` is read from `DISCORD_BOT_TOKEN`,
and `canvas.token.cs101` from `CANVAS_TOKEN_CS101`.

Config is loaded from a local `.env` file (via `dotenv`) when present; in
production the process environment is expected to be populated already.

## Channel → course mapping

Routing lives in **each course's config**, not in this app. A course's
`courseConfig.channelMap` declares the Discord guild + channel ids that route to
it (`channelMap.discord`). `@vta/tenancy` reads that mapping to resolve the
owning course (and the caller's role) for each inbound message.

## Privileged intent

This worker requests the **Message Content** gateway intent, which is
**privileged**. It must be explicitly enabled for the bot application in the
Discord developer portal:

> Bot → Privileged Gateway Intents → **Message Content Intent**

Without it the gateway rejects the connection at login.

## Run

```sh
# from the repo root
pnpm --filter @vta/discord-worker dev      # tsx, no build step
pnpm --filter @vta/discord-worker build    # compile to dist/
pnpm --filter @vta/discord-worker start    # run the compiled dist/main.js
```
