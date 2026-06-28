/**
 * Public contract for `@vta/agent` — the governed, bounded tool-calling loop.
 *
 * The agent is OUR OWN orchestration on top of `@vta/llm`, with the governance
 * tool-gate enforced INLINE before every tool execution (functionally identical
 * to a `beforeToolCall` hook, but in our code so it is certain and testable).
 *
 * The cardinal invariant lives in the implementation, but the types here make
 * the result auditable: every `ToolInvocation` records whether the tool-gate
 * allowed the call and whether it then succeeded, and `citations` surfaces the
 * grounding so the caller's egress grounding gate can inspect it.
 */

import type { Citation, ConversationTurn } from '@vta/shared';
import type { GovernanceContext } from '@vta/governance';
import type { GovernanceVerdict } from '@vta/audit';

/**
 * One question to answer.
 *   - `govContext` is the SOLE source of tenant + caller identity (courseId,
 *     role, rules, requestId). Tool tenant scope is derived from it, never from
 *     model-supplied arguments.
 *   - `question` is the student's natural-language question.
 *   - `locale` is an optional BCP-47 language hint; the agent mirrors the
 *     student's language and defaults to English.
 */
export interface AgentInput {
  readonly govContext: GovernanceContext;
  readonly question: string;
  readonly locale?: string;
  /**
   * Prior conversation turns (oldest first), already PII-redacted by the caller.
   * Supplied for follow-up context; the loop prepends them before the current
   * question. Tenant scope still comes ONLY from `govContext`, never from history.
   */
  readonly history?: readonly ConversationTurn[];
}

/**
 * An audit record of a single tool call the model requested.
 *   - `name`    — the tool name the model asked for.
 *   - `allowed` — whether the tool-gate permitted the call. `false` means the
 *                 tool DID NOT execute.
 *   - `ok`      — whether execution succeeded. Always `false` when `allowed` is
 *                 `false`; otherwise `false` on validation/execution failure.
 */
export interface ToolInvocation {
  readonly name: string;
  readonly allowed: boolean;
  readonly ok: boolean;
}

/**
 * The agent's answer.
 *   - `text`            — the model's final natural-language reply.
 *   - `citations`       — deduped grounding citations captured from retrieval
 *                         tool calls. MUST be surfaced so the egress grounding
 *                         gate (the caller's job) can verify the answer is
 *                         grounded before it is delivered.
 *   - `toolInvocations` — the ordered audit trail of every tool call attempted.
 */
export interface AgentOutput {
  readonly text: string;
  readonly citations: Citation[];
  readonly toolInvocations: ToolInvocation[];
  /**
   * Tool-gate verdicts (allow/deny) captured during the loop, for the audit log.
   * Only the agent sees the tool calls, so it surfaces these for the core to record.
   */
  readonly governanceVerdicts: GovernanceVerdict[];
}

/**
 * A course teaching-assistant agent. Implementations answer a single question
 * within one course's governance context. The interface is deliberately narrow
 * so the primary (Pi) and fallback (Codex) agents are interchangeable behind a
 * permission-monotonic `FallbackAgent`.
 */
export interface CourseAgent {
  answer(input: AgentInput): Promise<AgentOutput>;
}
