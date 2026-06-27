# Phase 1 — Status, Audit & Next Steps

> ⚠️ **Historical snapshot.** This captured the mid-Phase-1 audit. The system has
> since shipped and is **live on Azure**. For the current architecture, deployment,
> and status, see [`README.md`](../README.md) and [`ARCHITECTURE.md`](../ARCHITECTURE.md).

_Last updated: 2026-06-26 · branch `phase-1` (not yet merged to `main`)_

## TL;DR

Phase 1 is **code-complete and build-green** — every planned package and the Discord
app are implemented, and a **clean-room build of the pushed branch passes** install
(frozen) + build + typecheck + lint. Per-package logic is real (no stubs on a required
code path).

It is **not yet runnable end-to-end.** A 5-agent adversarial completeness audit
(2026-06-26) found **2 integration blockers** (identity mapping; no ingestion
entrypoint) plus a few gaps that must be closed in **Wave 7** before a live smoke test.
There are **no automated tests yet**, and the governance eval harness still runs against
a stub target.

> Honest framing: this is a *compiling, reviewed codebase*, not yet a *running service*.
> The gap is the last mile of integration, not missing components.

---

## Build evidence (authoritative)

Clean-room: fresh `git clone` of the pushed `phase-1` branch from GitHub, then:

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ exit 0 — lockfile complete & consistent |
| `pnpm build` (12 targets, 0 cached) | ✅ exit 0 |
| `pnpm typecheck` (23 targets) | ✅ exit 0 |
| `pnpm lint` | ✅ exit 0 |
| `pnpm test` | ✅ exit 0 — **but: no test files (0 automated tests)** |
| `pnpm eval` | ✅ runs — **0/4 cases pass: target is the Phase-0 stub, not wired to `TeachingService`** |

---

## Package inventory

| Package | Purpose | Status |
|---|---|---|
| `@vta/shared` | domain types, errors, config, secrets provider, logging | ✅ implemented |
| `@vta/data` | multi-tenant Drizzle schema (course_id everywhere) + pgvector chunks + course-scoped repositories | ✅ implemented |
| `@vta/llm` | swappable role-based LLM layer over pi-ai + OpenAI; failover; dual auth; tool-calling | ✅ implemented |
| `@vta/canvas` | read-only Canvas LMS client (hard write-guard) + HTML→Markdown normalization | ✅ implemented |
| `@vta/tenancy` | channel→course routing, per-(user,course) roles, ContentRules config shapes | ✅ implemented |
| `@vta/audit` | FERPA §99.32-style disclosure-log writer + GovernanceVerdict vocabulary | ✅ implemented |
| `@vta/rag` | Canvas ingestion → chunk → embed → pgvector; hybrid (vector + FTS) retrieval with RRF + citations | ✅ implemented |
| `@vta/tools` | agent read-only tool set: `retrieve`, `catalog_lookup` (no send/write tool) | ✅ implemented |
| `@vta/governance` | ingress (injection+PII), default-deny toolgate, egress (grounding/content-rules/PII/moderation); pluggable seams | ✅ implemented |
| `@vta/agent` | our bounded tool-calling loop (toolgate inline) + Codex CLI fallback + permission-monotonic FallbackAgent | ✅ implemented |
| `@vta/core` | `TeachingService` pipeline (tenancy→ingress→agent→egress→audit) + composition root + ingestion service | ✅ implemented |
| `apps/discord-worker` | thin discord.js adapter: resolve channel→course, call `handle()`, post governed reply in threads | ✅ implemented |

Architecture details: see [`ARCHITECTURE.md`](../ARCHITECTURE.md). Phase-0 foundations: [`PHASE-0.md`](./PHASE-0.md).

---

## Completeness audit (5-agent adversarial, 2026-06-26)

Severity totals across all dimensions: **ok 24 · deferred 9 · gap 5 · blocker 2.**
What follows is the honest classification.

### 🔴 Blockers — a real student's first message fails until these are fixed (Wave 7)

**B1 — Discord snowflake id is fed into `uuid` columns; no identity resolution.**
`apps/discord-worker/src/discordAdapter.ts` (~lines 69, 85) sets
`userId: message.author.id` — a Discord snowflake string — which flows into
`RoleResolver.resolveRole → MembershipRepository.resolveRole`, querying
`course_memberships.user_id` (a `uuid` column). Postgres throws
`invalid input syntax for type uuid`. The `users` table has the intended mapping column
(`discord_user_id text unique`, `packages/data/src/schema/users.ts:14`) but **nothing
reads or writes it** — there is no "resolve/create internal user from the channel
identity" step.
_Fix:_ add a `UserRepository.upsertByExternalId(channel, externalId, displayName) → users.id`
and have `tenancy.resolveInbound` return the **internal** `userId` (uuid); the adapter
passes the snowflake + username as the external identity.

**B2 — No runnable ingestion/seed entrypoint; a fresh DB can answer nothing.**
`CourseIngestionService` is fully implemented (`packages/core/src/ingestionService.ts`,
exported at `index.ts:27`) but **no app or CLI ever constructs it** (repo-wide grep finds
zero call sites). The only app, `apps/discord-worker`, wires only the *answer* path. On a
fresh DB, `courses`/`course_config`/`chunks` are empty, so `CourseResolver.resolveByChannel`
returns `null` for every message and it is silently dropped.
_Fix:_ add an admin CLI (`apps/admin` or `scripts/`) to create a course, map its Discord
channels, set roles (e.g. the professor = admin), and run `ingestCourse(courseId, canvasCourseId)`.

### 🟠 Gaps — works but weak; address in Wave 7 or note explicitly

- **Dev embedding will likely 401.** `packages/llm/src/config.ts` maps the `embed` role to
  `{ provider:'openai', model:'text-embedding-3-small', auth:'oauth' }`; the Codex/ChatGPT
  OAuth bearer is for the ChatGPT backend, not `api.openai.com`. `RagRetriever.retrieve`
  embeds the query on **every** request, so RAG fails in dev without a real key.
  _Fix:_ dev `embed` role → `auth:'apiKey'` with a real `OPENAI_API_KEY`.
- **pgvector HNSW + FTS GIN indexes are only in comments** (`schema/materials.ts:60-66`,
  `rag/retrieve.ts:151-155`). Sequential scan works for a pilot; add an index migration
  before scale.
- **Egress moderation is a no-op seam** (`packages/governance/src/egress.ts:~345`) — zero
  content-moderation coverage until a classifier (Llama Guard / Azure) is wired. All other
  governance stages are real.
- **Citations not rendered by the Discord adapter** — `OutboundReply.citations` is produced
  by core but the worker posts only `reply.text`. Not a grounding hole (the `retrieve` tool
  inlines a "Sources:" block into model-facing content), but no structured footer is shown.

### 🔌 Verify-at-install seams — external APIs we cannot confirm offline (each isolated to one file)

Each MUST be confirmed against the real service before that path is relied on; each fails
loudly rather than silently if the assumption is wrong.

- **pi-ai** real API — `packages/llm/src/providers/piProvider.ts` (`makePiClient` probes
  client shapes; message/tool/finishReason wire shapes assumed).
- **Codex CLI** flags + JSONL event shape, and that `--sandbox read-only` severs network —
  `packages/agent/src/codexAgent.ts` (fail-closed sandbox assertion present).
- **Codex/ChatGPT OAuth** `auth.json` shape + refresh endpoint — `packages/llm/src/auth/codexOAuth.ts`.
- **Canvas** field shapes — `packages/canvas/src/{client,types}.ts`.
- **OpenAI embeddings** SDK shape — `packages/llm/src/providers/openaiEmbedder.ts`.

### ⚠️ Deferred by design — intentional, not oversights

Automated tests (beyond Wave-7 first batch), `KeyVaultSecretsProvider` implementation
(env provider used in dev), **email** channel (Phase 1.5), **web** frontend (Phase 2),
rate-limiting (intentionally off), Azure deployment, professor self-serve onboarding,
binary (PDF/PPTX) upload extraction, a dedicated reranker (hybrid RRF used instead).

---

## Wave 7 — "make it runnable" (the plan)

Ordered so each step unblocks the next; target = a live end-to-end smoke test on one course.

1. **B1 · Identity resolution** — `UserRepository.upsertByExternalId` in `@vta/data`; extend
   `@vta/tenancy` `resolveInbound` to return the internal `userId` (uuid); adapter passes the
   external snowflake + username.
2. **B2 · Admin CLI** (`apps/admin`) — `course:add`, `course:map-channel`, `course:set-role`,
   `course:ingest` (drives `CourseIngestionService`). Makes onboarding + Canvas sync runnable.
3. **Dev embedding creds** — `embed` role → real `OPENAI_API_KEY` (apiKey auth) in the dev profile; document it.
4. **Index migration** — create the pgvector HNSW index + FTS GIN index (SQL run after `db:push`).
5. **Eval wiring + first tests** — point the eval target at a real/configured `TeachingService`;
   add the first unit tests for pure logic (toolgate default-deny, egress fail-safe, RRF,
   chunking, tenancy + identity resolution).
6. **(Optional polish)** — render a "Sources" footer from `OutboundReply.citations` in the adapter.

Then: clean-room rebuild + a **local end-to-end smoke test** (Postgres up, seed one course,
verify a real question round-trips through ingress→agent→egress→audit) → merge `phase-1` → `main`
→ pilot on the first course.

---

## Local run (intended path; where it breaks **today**, pre-Wave-7)

```bash
corepack enable                 # provides pnpm@9.15.0
pnpm install                    # in WSL (not the Windows install)
cp .env.example .env            # set DATABASE_URL, DISCORD_BOT_TOKEN, etc.
pnpm infra:up                   # Postgres+pgvector + Redis via docker compose
pnpm db:push                    # create schema (NOTE: pgvector extension via infra/postgres/init.sql)
pnpm build && pnpm typecheck    # ✅ works today
pnpm --filter @vta/discord-worker dev
```

Today this **boots** but cannot answer: with no seed/ingest entrypoint (B2) every message
resolves to no course and is dropped; once a course is hand-seeded, the snowflake→uuid
mismatch (B1) throws at role resolution; and dev embeddings need a real OpenAI key. Wave 7
closes all three.
