# syntax=docker/dockerfile:1
#
# Production image for the VTA web dashboard (Next.js, standalone output).
#
# Build context is the REPO ROOT (the whole pnpm workspace must be visible):
#   docker build -f apps/web/Dockerfile -t vta-web:<tag> .
#
# Runtime config is entirely via environment variables / secrets:
#   SESSION_SECRET (required, session signing), ADMIN_EMAILS (professor allowlist,
#   comma-separated), ADMIN_PASSWORD (shared instructor sign-in password).
#   Students browse as guests with no login.

# ----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1
RUN corepack enable

WORKDIR /repo
COPY . .

RUN pnpm install --frozen-lockfile
# Build just the web app. Next 'standalone' output lands under
# apps/web/.next/standalone with the monorepo path layout preserved.
RUN pnpm --filter=@vta/web build

# ----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

# Standalone server + the node_modules Next traced as required.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
# Static assets are not part of standalone — place them where the server expects.
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
