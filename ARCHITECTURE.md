# Architecture (deep dive)

This is the internal design reference for the Virtual Teaching Assistant. For the
high-level overview, diagrams, packages, and deployment, start with the
[README](./README.md). This document goes deeper on the **invariants** that make
the system trustworthy.

## Guiding principles

1. **Governance is structural, not prompt-based.** Safety properties are enforced
   by code at chokepoints — a default-deny tool allow-list, `course_id`-filtered
   queries, and gates that run regardless of what the model emits. A prompt can be
   ignored; a removed capability and a scoped query cannot.
2. **Fail-safe / default-deny.** Every detector, judge, and gate treats its own
   failure as **deny/refuse**, never as allow. "Unknown" is distinct from "no".
3. **Channel-agnostic core.** Adapters normalize to `InboundRequest` and render
   `OutboundReply`; `TeachingService` never knows the channel.
4. **Swappable brain.** Only `@vta/llm` names a model; everyone else asks for a
   logical role.
5. **Multi-tenant by construction.** `course_id` is on every request, row, and
   query, derived server-side and carried in the `GovernanceContext` — never taken
   from user- or model-controlled input.

## The orchestrator pipeline (`@vta/core` · `TeachingService.handle`)

A **fixed, never-reordered** sequence. The whole body is wrapped so any throw
becomes a neutral `error` reply *and* a best-effort audit entry — a crash can
never deliver an ungoverned answer.

1. **Resolve course config → `GovernanceContext`.** The context is the *sole*
   carrier of tenant + caller identity (`courseId`, `role`, `ContentRules`,
   `requestId`).
2. **Ingress.** Inspect the untrusted text. A block short-circuits to a refusal
   **without ever calling the agent**.
3. **Agent.** Answer the *redacted* question within the governance context.
4. **Egress (mandatory).** The reply's `text` / `status` / `citations` come from
   the `EgressDecision` — **never** the raw agent text.
5. **Audit.** Exactly one append-only record on **every** terminal path (ingress
   block, success, and error), storing the *redacted* question and *egress-scanned*
   answer plus all verdicts.

**Load-bearing invariants:** (a) egress runs before every non-ingress-blocked
reply and the reply is built from its decision; (b) audit runs on every terminal
path including errors; (c) the stored question/answer are the redacted /
egress-scanned versions (FERPA redaction invariant).

## The three gates (`@vta/governance`)

All gates are fail-safe and emit verdicts for the audit log.

### Ingress
Runs over untrusted text *before the model*. Order: (1) prompt-injection /
jailbreak detection — positive → block; detector **throws → block** (`flag`); (2)
PII redaction of the allowed text — redactor **throws → block** (never forward raw
text). A swapped detector's `reason` is itself PII-redacted before it enters the
audit log.

### Tool-gate
A pure, synchronous, **default-deny** check run inline before *every* tool
execution. A tool not on the allow-list (`retrieve`, `catalog_lookup`,
`web_search`) is blocked — a hallucinated or newly-added tool name cannot run
until policy is updated. Optional per-tool argument validators can turn an
allowed call into a denial.

### Egress
The last gate, in fixed order:
1. **Grounding.** When the course's `requireCitations` is true and there are no
   citations → refuse. (When false, grounding is *flagged* as waived, not silently
   skipped.)
2. **Content boundaries** — grades, full homework solutions, off-topic. Each axis
   combines deterministic regex patterns with an optional **LLM-as-judge**. The
   judge is **tri-state** (`yes` / `no` / `unknown`); `unknown` (a throw or
   unparseable reply) is *not* a pass:
   - grades / homework have a deterministic floor → `unknown` falls back to the
     patterns and emits a `flag`;
   - off-topic has **no** deterministic floor → `unknown` (or `yes`) **refuses**.
3. **Output PII scan** — a redactor error refuses rather than emit unscanned text.
4. **Moderation** — a no-op seam today (`TODO(swap)`).

Default detectors are dependency-free heuristics (regex injection signatures,
regex PII) with `TODO(swap)` seams for Azure AI Content Safety / Prompt Shields,
Microsoft Presidio, and Llama Guard. Swapping any is a wiring change behind the
`@vta/governance` ports — no rewrite.

## The agent loop (`@vta/agent`)

`PiAgent` is **our own** bounded tool-calling loop over `@vta/llm` (it is *not* a
third-party agent framework). Three invariants are load-bearing:

1. **No tool runs unless the tool-gate allowed it** — the gate is consulted inline
   before each call (functionally a `beforeToolCall` hook, but in our code so it is
   certain and unit-testable). Tenant scope for execution comes only from
   `govContext`, never from model-supplied arguments.
2. **The loop is hard-bounded** (`MAX_ITERATIONS = 6`) — it can never spin
   forever. If it bounds out, it forces **one** final answer with tools disabled.
3. **Grounding citations are captured** from the `retrieve` tool and surfaced so
   the egress grounding gate can verify them.

Per call the gate validates the model's tool args against the tool's own Zod
schema; a bad shape (or a hallucinated tool name) is reported back to the model
rather than executed. If the primary agent path is unavailable, a
**`StaticFallbackAgent`** returns a fixed, no-I/O "temporarily unavailable" reply
(permission-monotonic: strictly less capability than the primary, and its output
still flows through egress).

## The LLM layer (`@vta/llm`)

The only model-naming package. A `ModelRouter` resolves a logical role to a
concrete provider+model, builds the provider lazily (caching per role), calls it,
records usage, and — for the agent path — fails over `agent.primary` →
`agent.fallback`. Failover is only attempted for *transient* errors
(availability / network); deterministic errors (bad config / missing secret) do
not waste a fallback call.

The chat transport is the **OpenAI-compatible Chat Completions API** via the
OpenAI SDK — it serves OpenAI natively and **DeepSeek** through its
OpenAI-compatible endpoint (base URL injected by the router). Embeddings use the
OpenAI SDK; **web search** uses OpenAI's hosted Responses-API `web_search` tool,
reusing the same OpenAI key. All auth is API-key only.

## Retrieval (`@vta/rag`)

Hybrid retrieval scoped to one course per call: **dense** (pgvector cosine over
HNSW) + **sparse** (Postgres full-text search over a GIN index), fused with
**Reciprocal Rank Fusion**. Query embeddings come from the `embed` role
(`text-embedding-3-small`, 1536-dim). Retrieved chunks carry citations
(title + locator) that flow back through the agent to the egress grounding gate.
Course materials are ingested from Canvas (read-only) via `@vta/canvas` and the
core ingestion service.

## Data & multi-tenancy (`@vta/data`)

PostgreSQL 16 + `pgvector`, accessed through Drizzle. Every tenant-owned table has
a `course_id` column and `@vta/data` exposes **course-scoped access only**, so a
query that forgets the tenant boundary is not expressible. A user's external
Discord snowflake is mapped to an internal `users.id` UUID (`upsertByDiscordId`);
roles and the audit log key on the UUID, never the snowflake.

## Audit (`@vta/audit`)

Append-only, FERPA-aware disclosure log. Exactly one record per request, written
on every terminal path, carrying the *redacted* question, the *egress-scanned*
answer, the final status, and the ordered verdicts from ingress + tool-gate +
egress. Raw PII never reaches the log (the redaction invariant extends even to
detector `reason` strings).

## Deployment

See the [README → Deployment](./README.md#deployment-azure) and
[CI/CD](./README.md#cicd) sections, and `infra/azure/*.bicep`, for the Azure
topology, the subscription quirks (Postgres region restriction, pgvector
extension creation, blocked ACR Tasks / service-principal creation), and the
build-on-CI / roll-out-locally model.
