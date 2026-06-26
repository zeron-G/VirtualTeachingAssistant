/**
 * `routerJudge` — the application-layer bridge that lets the egress
 * content-boundary judge run on the configured `guard.judge` model.
 *
 * `@vta/governance` deliberately does NOT depend on `@vta/llm`: its
 * {@link LlmJudge} port is a minimal `judge(system, user) -> string` contract so
 * the policy engine never imports a provider SDK. This adapter — living in the
 * composition layer (`@vta/core`), the ONLY place allowed to know both halves —
 * satisfies that port by routing the judge prompt through the `ModelRouter`'s
 * `guard.judge` logical role. The router resolves that role to whatever concrete
 * guard model the active profile names; no model name appears here.
 *
 * The judge prompt is delivered as a system + user message pair, exactly the
 * shape `EgressGovernor.judgeBoundary` builds, and the model's completion text is
 * returned verbatim for the governor to parse (it expects a leading yes/no).
 */

import type { LlmJudge } from '@vta/governance';
import type { ModelRouter } from '@vta/llm';

/**
 * Build an {@link LlmJudge} backed by the router's `guard.judge` role.
 *
 * The returned judge is intentionally thin: it forwards the governor's system
 * and user prompts to `router.complete('guard.judge', ...)` and returns the raw
 * completion text. Any provider/availability error PROPAGATES — the
 * {@link import('@vta/governance').EgressGovernor} treats a throwing judge as
 * `unknown` and fails safe per axis, so this adapter must not swallow errors
 * into a misleading empty string.
 */
export function routerJudge(router: ModelRouter): LlmJudge {
  return {
    async judge(system: string, user: string): Promise<string> {
      const result = await router.complete('guard.judge', {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      return result.text;
    },
  };
}
