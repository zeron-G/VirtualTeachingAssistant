# Virtual Teaching Assistant (VTA)

> **Status: Phase 1 code-complete & build-green — NOT yet runnable end-to-end. Not in production.**
> All Phase-1 packages (governance, RAG, agent + Codex fallback, core orchestrator)
> and the Discord adapter are implemented and a clean-room build passes
> (install/build/typecheck/lint). A completeness audit found **2 integration
> blockers** (Discord-id→user-UUID mapping; no ingestion/seed entrypoint) plus
> gaps and zero automated tests — these are being closed in **Wave 7**.
> See [`docs/PHASE-1-STATUS.md`](./docs/PHASE-1-STATUS.md) for the full audit and plan.

The Virtual Teaching Assistant is a **governed, multi-tenant course Q&A
assistant**. It answers student questions about a specific course by embedding
the [Pi](https://github.com/badlogic/pi) agent harness as its reasoning core
and wrapping it in a **structural governance layer** that constrains what the
agent may read, do, and say. Every request is bound to a single course
(`course_id` is carried everywhere as a tenant boundary), passes through ingress
governance before the agent runs, is restricted to a small set of
least-privilege tools, and is checked again at egress (groundedness, citation,
content-boundary rails, output PII, moderation) before any reply is sent. The
first delivery channel is **Discord**; **email** and a **web** surface follow
later. The pilot is the **AI Essentials** course, taught by **Professor Gordon
Gao**.

## Monorepo layout

Phase-0 packages (present in this tree):

| Path                | Package         | Responsibility                                                                 |
| ------------------- | --------------- | ------------------------------------------------------------------------------ |
| `packages/shared`   | `@vta/shared`   | Cross-cutting types and primitives: errors, roles, domain types, secrets, env, logger. Has **no** `@vta` dependencies. |
| `packages/data`     | `@vta/data`     | Drizzle schema, migrations, and course-scoped data access. All DB access is tenant-scoped by `course_id`. |
| `packages/llm`      | `@vta/llm`      | The only package that names concrete models. Resolves logical LLM **roles** (`agent.primary`, `agent.fallback`, `embed`, `rerank`, `guard.judge`) to providers. |

Phase-1 (planned — **not** in this tree yet):

- `apps/*` — runnable entrypoints, starting with the Discord worker.
- `packages/governance` — ingress/egress policy engine (structural, not prompt-based).
- `packages/rag` — retrieval and grounding over course materials.
- `packages/canvas` — Canvas LMS catalog/source integration.
- `packages/tools` — least-privilege agent tools (`retrieve`, `catalog_lookup`, `send`).
- `packages/tenancy` — tenant resolution and isolation helpers.
- `packages/audit` — append-only audit logging across the lifecycle.
- `packages/core` — the orchestrator that wires channel adapters, governance, the Pi-embedded agent, and tools together.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the request lifecycle and
[`docs/PHASE-0.md`](./docs/PHASE-0.md) for exactly what Phase 0 delivers and the
Phase-1 plan.

## Prerequisites

- **Node 22** — the version is pinned in [`.nvmrc`](./.nvmrc).
- **pnpm** — enable via Corepack: `corepack enable` (do not install pnpm globally).
- **Docker** — for local infrastructure (Postgres, Redis) via `pnpm infra:up`.

## Quickstart (WSL)

These steps assume a WSL shell with Docker available.

```bash
# 1. Enable pnpm through Corepack (uses the version pinned in package.json).
corepack enable

# 2. Install all workspace dependencies.
pnpm install

# 3. Create your local environment file and fill in secrets.
cp .env.example .env

# 4. Start local infrastructure (Postgres, Redis) in Docker.
pnpm infra:up

# 5. Push the Drizzle schema to the local database.
pnpm db:push

# 6. Build all packages.
pnpm build

# 7. Type-check and run tests.
pnpm typecheck && pnpm test

# 8. Run the evaluation skeleton.
pnpm eval
```

## Scripts

Run from the repository root.

| Script           | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `pnpm build`     | Build all workspace packages (`tsc -p` per package).                |
| `pnpm typecheck` | Type-check all packages with no emit.                               |
| `pnpm lint`      | Lint the workspace.                                                 |
| `pnpm format`    | Format the workspace.                                               |
| `pnpm test`      | Run the test suite.                                                 |
| `pnpm infra:up`  | Start local infrastructure (Postgres, Redis) via Docker Compose.    |
| `pnpm db:push`   | Push the Drizzle schema to the local database.                      |
| `pnpm eval`      | Run the evaluation skeleton.                                        |

## Language policy

**All code and code comments are written in English.** Conversational and design
documents (chat logs, internal design notes) may be in Chinese, but anything
committed as source — including these top-level docs — is English.

## License

[MIT](./LICENSE) — Copyright (c) 2026 Johns Hopkins University — CDHAI.
