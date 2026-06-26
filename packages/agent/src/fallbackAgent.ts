/**
 * FallbackAgent — composes a primary and a fallback `CourseAgent`.
 *
 * It tries the primary; on ANY error (especially `LlmUnavailableError` raised
 * when both LLM roles are down, or a Codex spawn failure) it logs and delegates
 * to the fallback.
 *
 * PERMISSION-MONOTONIC: the fallback must never have MORE capability than the
 * primary. In our wiring the primary is the tool-using `PiAgent` and the
 * fallback is the no-tools, read-only `CodexAgent`, so falling back strictly
 * narrows capability. Either agent's output still flows through the caller's
 * egress governance — degrading the model never bypasses the gates.
 */

import { createLogger, toError } from '@vta/shared';
import type { Logger } from '@vta/shared';

import type { AgentInput, AgentOutput, CourseAgent } from './types.js';

/** Constructor dependencies for {@link FallbackAgent}. */
export interface FallbackAgentDeps {
  readonly primary: CourseAgent;
  readonly fallback: CourseAgent;
  readonly logger?: Logger;
}

export class FallbackAgent implements CourseAgent {
  private readonly primary: CourseAgent;
  private readonly fallback: CourseAgent;
  private readonly log: Logger;

  constructor(deps: FallbackAgentDeps) {
    this.primary = deps.primary;
    this.fallback = deps.fallback;
    this.log = deps.logger ?? createLogger({ name: 'fallback-agent' });
  }

  async answer(input: AgentInput): Promise<AgentOutput> {
    try {
      return await this.primary.answer(input);
    } catch (err) {
      this.log.warn(
        { requestId: input.govContext.requestId, cause: toError(err).message },
        'primary agent failed; falling back to degraded agent',
      );
      // The fallback is permission-monotonic (no more capability than primary)
      // and its output still passes through the caller's egress governance.
      return this.fallback.answer(input);
    }
  }
}
