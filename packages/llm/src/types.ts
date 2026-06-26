/**
 * Wire-level types for the swappable LLM layer.
 *
 * These types are intentionally provider-agnostic: nothing here names a
 * concrete model or SDK. Callers build an {@link LlmRequest}; the router and
 * providers translate it to/from whatever underlying SDK is configured for the
 * requested logical role.
 */

/** A single chat turn. `system` is the steering/instruction channel. */
export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/**
 * A provider-agnostic completion request.
 *
 * `jsonSchema` is an optional structured-output hint. It is typed as `unknown`
 * on purpose: each provider validates/translates it to its own structured
 * output mechanism (OpenAI `response_format`, etc.). Phase-1 governance code
 * supplies the concrete schema.
 */
export interface LlmRequest {
  readonly messages: LlmMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly jsonSchema?: unknown;
}

/** Token accounting for one completion, used for cost tracking and quotas. */
export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Estimated cost in USD, if the provider/router can compute it. */
  readonly costUsd?: number;
}

/**
 * The result of a completion. `model` and `provider` are the *concrete* values
 * that actually served the request — recorded for auditing and so failover is
 * observable downstream.
 */
export interface LlmResult {
  readonly text: string;
  readonly usage: Usage;
  readonly model: string;
  readonly provider: string;
}
