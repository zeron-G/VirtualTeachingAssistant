# syntax=docker/dockerfile:1
#
# Production image for the VTA Discord worker.
#
# Multi-stage:
#   1. build   — install the full pnpm monorepo (dev deps included so TypeScript
#                can compile), build every workspace package via turbo, then use
#                `pnpm deploy` to carve out a self-contained, production-only
#                tree of just @vta/discord-worker plus the workspace packages it
#                depends on (each with its built ./dist, declared via the
#                package "files" allowlist so it survives .gitignore).
#   2. runtime — a slim image containing only that deployed tree, run as the
#                unprivileged built-in `node` user.
#
# Build context is the REPO ROOT (so the whole workspace is visible):
#   az acr build -r <registry> -t vta-discord-worker:<tag> \
#     -f apps/discord-worker/Dockerfile .
#
# The container is configured entirely through environment variables / secrets
# at run time (DATABASE_URL, DISCORD_BOT_TOKEN, DEEPSEEK_API_KEY, OPENAI_API_KEY,
# LLM_PROFILE, SECRETS_PROVIDER, ...). It reads no .env file in production —
# dotenv simply finds none and the process environment is used as-is.

# ----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

# Pin pnpm via corepack (root package.json "packageManager" decides the version).
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1
RUN corepack enable

WORKDIR /repo

# Copy the whole workspace (node_modules/dist excluded via .dockerignore).
COPY . .

# Install all dependencies (incl. dev — required to compile TypeScript).
RUN pnpm install --frozen-lockfile

# Build every workspace package in dependency order.
RUN pnpm build

# Carve out a pruned, production-only deploy of the worker + its workspace deps.
# node-linker=hoisted produces a flat, self-contained node_modules (no symlink
# farm) — the built ./dist of each workspace dep is included via its package
# "files" allowlist. Verified to resolve every dep and boot to config validation.
RUN pnpm --filter=@vta/discord-worker deploy --prod --config.node-linker=hoisted /prod/worker

# ----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /prod/worker ./

USER node

# The worker is a long-lived gateway client; it has no HTTP port to health-check.
# Container Apps treats process liveness as health (it exits non-zero on fatal
# boot errors, which triggers a restart).
CMD ["node", "dist/main.js"]
