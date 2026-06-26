# Architecture

This document describes the **target** architecture of the Virtual Teaching
Assistant (VTA). Sections are marked **[Phase 0]** where the foundation exists
today and **[Phase 1]** where the behavior is planned but not yet implemented.

## Guiding principles

1. **Governance is structural, not prompt-based.** Constraints are enforced by
   code paths, tool allow-lists, and tenant scoping — not by asking the model
   nicely in a system prompt. A prompt can be ignored or jailbroken; a removed
   tool and a `course_id`-filtered query cannot.
2. **Channel-agnostic core.** The orchestrator does not know whether a request
   came from Discord, email, or the web. Channel adapters normalize input to a
   common `InboundRequest` and render a common `OutboundReply`.
3. **Swappable brain.** No package except `@vta/llm` names a concrete model.
   The agent asks for a logical **role**; `@vta/llm` resolves it. Primary brain
   is **DeepSeek-V4-Flash**, fallback is **GPT-5.4-mini**, with a **Codex CLI**
   fallback path for resilience.
4. **Multi-tenant by construction.** A **course is a tenant**. `course_id` is
   present on every request, every row, and every query — structural isolation
   rather than a filter someone might forget.

## Request lifecycle

```
                                                            ┌─────────────────┐
 inbound channel        INGRESS           agent core        │  least-privilege │
 (Discord/email/web)    governance        (Pi embedded)     │      tools       │
        │                   │                   │           │                  │
        ▼                   ▼                   ▼            │  • retrieve      │
  ┌───────────┐       ┌───────────┐       ┌───────────┐     │  • catalog_lookup│
  │  adapter  │─────▶ │  policy   │─────▶ │  Pi loop  │────▶│  • send          │
  │ normalize │       │  (block / │       │  Bash     │     └────────┬─────────┘
  │ → Inbound │       │  allow /  │       │  removed; │              │
  │  Request  │       │  rewrite) │       │ beforeTool│              ▼
  └───────────┘       └───────────┘       │ Call →    │       ┌───────────┐
                                          │ policy)   │       │  EGRESS   │
                                          └───────────┘       │ governance│
                                                              │ • grounded│
                                                              │ • citation│
                                                              │ • content │
                                                              │   rails   │
                                                              │ • out PII │
                                                              │ • moderate│
                                                              └─────┬─────┘
                                                                    ▼
                                                            ┌───────────┐
                                                            │ outbound  │
                                                            │  reply    │
                                                            └───────────┘

      ───────────────────  audit log spans the entire lifecycle  ───────────────────
```

1. **Inbound channel adapter** — Receives a platform message and normalizes it
   into a shared `InboundRequest` (carrying `course_id`, `user_id`, channel
   kind, text, attachments). **[Phase 1]**
2. **Ingress governance** — Resolves the tenant and the user's course role,
   then applies ingress policy: block disallowed requests, allow, or rewrite.
   Structural, not prompt-based. **[Phase 1]**
3. **Agent core (Pi embedded)** — The Pi harness runs the reasoning loop with
   the **Bash tool removed**. Every tool invocation is gated by a
   `beforeToolCall` hook that consults the policy engine before the tool runs.
   Pi usage is isolated behind a single adapter so the upstream package name and
   version can be verified at install time. **[Phase 1]**
4. **Least-privilege tools** — The agent may only call a small, explicit set:
   `retrieve` (grounded course-material lookup), `catalog_lookup` (course
   catalog / Canvas metadata), and `send` (emit the reply). No general file,
   network, or shell access. **[Phase 1]**
5. **Egress governance** — Before anything leaves the system, the candidate
   reply is checked for **groundedness and citation** (claims must be supported
   by retrieved sources), **content-boundary rails** (stay within course
   scope), **output PII**, and **moderation**. **[Phase 1]**
6. **Outbound** — The approved `OutboundReply` (with citations and a
   `ReplyStatus`) is handed back to the channel adapter for rendering. **[Phase 1]**
7. **Audit log** — Every stage emits structured, append-only audit events so a
   request can be reconstructed end to end. **[Phase 1]**

## The swappable brain (LLM role layer)

`@vta/llm` is the **only** package that may reference a concrete model. Callers
request a logical role and receive a configured client:

| Role            | Purpose                                  | Target model (initial)        |
| --------------- | ---------------------------------------- | ----------------------------- |
| `agent.primary` | Main reasoning / answer generation       | DeepSeek-V4-Flash             |
| `agent.fallback`| Failover when primary is unavailable     | GPT-5.4-mini                  |
| `embed`         | Embeddings for retrieval                 | (configured in `@vta/llm`)    |
| `rerank`        | Reranking retrieved passages             | (configured in `@vta/llm`)    |
| `guard.judge`   | LLM-as-judge for egress governance       | (configured in `@vta/llm`)    |

A **Codex CLI** fallback provides an additional resilience path when hosted
providers are degraded. Model selection lives entirely behind this layer; the
rest of the system stays model-agnostic. **[Phase 0]** the role layer and
provider resolution exist; **[Phase 1]** wires roles into the agent and
governance.

## Multi-tenancy

A **course is a tenant**. `course_id` is structural, not advisory:

- It is part of every `InboundRequest` and `OutboundReply`.
- It is a column on every tenant-owned table and a predicate on every query
  (`@vta/data` exposes course-scoped access only).
- Ingress governance resolves the tenant up front; tools and retrieval operate
  inside that tenant boundary; a `TenantMismatchError` is raised if anything
  attempts to cross it.

## Package responsibilities

| Package            | Phase   | Responsibility                                                                 |
| ------------------ | ------- | ------------------------------------------------------------------------------ |
| `@vta/shared`      | Phase 0 | Errors, roles, domain types, secrets, env, logger. No `@vta` dependencies.     |
| `@vta/data`        | Phase 0 | Drizzle schema, migrations, course-scoped data access.                         |
| `@vta/llm`         | Phase 0 | Logical LLM roles → concrete providers. The only model-naming package.         |
| `@vta/governance`  | Phase 1 | Ingress/egress policy engine; structural rails; tool-call gating.              |
| `@vta/rag`         | Phase 1 | Retrieval, grounding, and citation over course materials.                      |
| `@vta/canvas`      | Phase 1 | Canvas LMS catalog/source integration.                                         |
| `@vta/tools`       | Phase 1 | Least-privilege agent tools: `retrieve`, `catalog_lookup`, `send`.             |
| `@vta/tenancy`     | Phase 1 | Tenant resolution and isolation helpers.                                       |
| `@vta/audit`       | Phase 1 | Append-only audit logging across the lifecycle.                                |
| `@vta/core`        | Phase 1 | Orchestrator wiring adapters → governance → Pi agent → tools.                  |
| `apps/*`           | Phase 1 | Runnable entrypoints, beginning with the Discord worker.                       |

## Phase summary

- **[Phase 0]** Monorepo, `@vta/shared`, `@vta/data` (schema + migrations),
  `@vta/llm` (role layer), local infra (Docker Compose), CI, eval skeleton.
- **[Phase 1]** Governance engine, RAG, Canvas integration, least-privilege
  tools, Pi-embedded agent, the core orchestrator, the Discord worker, and the
  Codex CLI fallback.
