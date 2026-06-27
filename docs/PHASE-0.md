# Phase 0 — Foundations

> ⚠️ **Historical.** Describes the original Phase-0 scaffold. For the current
> system see [`README.md`](../README.md) and [`ARCHITECTURE.md`](../ARCHITECTURE.md).

Phase 0 establishes the foundations the rest of the Virtual Teaching Assistant
is built on. It contains **no business logic** — no governance rules, no RAG
retrieval, no Discord integration, no agent loop. The goal is a clean, fully
typed scaffold with clear interfaces and explicit `TODO` markers where Phase-1
logic will plug in.

## What Phase 0 delivers

1. **Monorepo** — an all-TypeScript pnpm workspace. ESM everywhere, NodeNext
   resolution, `strict` + `noUncheckedIndexedAccess` + `isolatedModules` on,
   shared `tsconfig.base.json`, root scripts (`build`, `typecheck`, `lint`,
   `format`, `test`, `infra:up`, `db:push`, `eval`), `.nvmrc` pinned to Node 22,
   and `.env.example`.

2. **`@vta/shared`** — the dependency-free leaf package providing the
   cross-cutting primitives every other package builds on:
   - **errors** — `VtaError` and friends (`ConfigError`, `SecretMissingError`,
     `NotFoundError`, `TenantMismatchError`, `ToolDeniedError`,
     `LlmUnavailableError`), `toError`, and `VtaErrorCode`.
   - **roles** — `LLM_ROLES`, `COURSE_ROLES`, `DEFAULT_COURSE_ROLE`, and the
     `LlmRole` / `CourseRole` types.
   - **domain** — `CourseId`, `UserId`, `ChannelKind`, `Attachment`,
     `InboundRequest`, `Citation`, `ReplyStatus`, `OutboundReply`.
   - **secrets** — `SecretsProvider`, `EnvSecretsProvider`,
     `KeyVaultSecretsProvider`, `createSecretsProvider`.
   - **env** — `AppConfig`, `loadConfig`.
   - **logger** — `Logger`, `createLogger`, `logger`.

3. **`@vta/data`** — the Drizzle **schema** and **migrations**, plus the
   course-scoped data-access surface. Schema models the tenant boundary
   (`course_id` everywhere); migrations are generated with `drizzle-kit` and
   applied via `pnpm db:push`. No retrieval or governance logic here.

4. **`@vta/llm`** — the LLM **role layer**: the only package that names concrete
   models. Resolves logical roles (`agent.primary` → DeepSeek-V4-Flash,
   `agent.fallback` → GPT-5.4-mini, plus `embed`, `rerank`, `guard.judge`) to
   configured clients. Provider plumbing only; no agent loop, no governance use.

5. **Infrastructure (Docker Compose)** — local Postgres and Redis brought up
   with `pnpm infra:up`, matching the connection settings in `.env.example`.

6. **CI** — a pipeline that installs via Corepack/pnpm and runs `build`,
   `typecheck`, `lint`, and `test` on every change.

7. **Eval skeleton** — the harness and directory structure for evaluations,
   runnable via `pnpm eval`. No real eval cases yet — it exercises the wiring so
   Phase-1 work can drop cases in.

## Phase-0 package dependency order

`@vta/shared` → `@vta/data`, `@vta/llm` (both depend only on `shared`).

## Phase-1 plan (dependency order)

Phase 1 adds business logic. Build in roughly this order, so each package can
depend on what precedes it:

1. **`@vta/tenancy`** — tenant resolution and isolation helpers on top of
   `@vta/shared` + `@vta/data`. Establishes how `course_id` is resolved and
   enforced before anything else runs.
2. **`@vta/audit`** — append-only audit logging used by every later stage; built
   early so all subsequent components can emit audit events.
3. **`@vta/governance`** — the structural ingress/egress policy engine
   (block/allow/rewrite, groundedness + citation checks, content-boundary rails,
   output PII, moderation, and the `beforeToolCall` gate). Depends on `shared`,
   `tenancy`, `audit`, and `llm` (for `guard.judge`).
4. **`@vta/rag`** — retrieval, grounding, and citation over course materials,
   using `@vta/data` for storage and `@vta/llm` for `embed`/`rerank`.
5. **`@vta/canvas`** — Canvas LMS catalog/source integration feeding `rag` and
   the `catalog_lookup` tool.
6. **`@vta/tools`** — the least-privilege tool set (`retrieve`,
   `catalog_lookup`, `send`), each gated by governance.
7. **`@vta/agent` (Pi)** — the Pi-embedded reasoning core. All Pi usage isolated
   in one adapter file; Bash removed; `beforeToolCall` wired to governance.
   Includes the **Codex CLI fallback** path.
8. **`@vta/core`** — the orchestrator that wires channel adapters → ingress
   governance → the Pi agent → least-privilege tools → egress governance →
   outbound, with audit throughout.
9. **`apps/discord-worker`** — the first runnable entrypoint: a Discord channel
   adapter driving `@vta/core`. Email and web surfaces follow.

## Out of scope for Phase 0

- Any governance rule logic.
- Any RAG retrieval or grounding logic.
- Any Discord (or email/web) integration.
- The agent loop itself.

These are placeholders and interfaces only in Phase 0; the implementations land
in Phase 1 per the order above.
