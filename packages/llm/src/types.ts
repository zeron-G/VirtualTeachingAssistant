/**
 * Wire-level types for the swappable LLM layer.
 *
 * These types are intentionally provider-agnostic: nothing here names a
 * concrete model or SDK. Callers build an {@link LlmRequest}; the router and
 * providers translate it to/from whatever underlying SDK is configured for the
 * requested logical role.
 */

/**
 * A tool call the model wants the caller to execute.
 *
 * `arguments` is the *parsed* JSON the model wants to pass to the tool. It is
 * typed as `unknown` because the model may emit anything: providers parse a
 * JSON-string payload into an object when possible, but on a parse failure the
 * raw string is preserved here for the caller to validate.
 */
export interface LlmToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

/**
 * A tool the model may call. `parameters` is a JSON-Schema object describing the
 * tool's argument shape. It is `Record<string, unknown>` so callers can build it
 * freely; each provider translates it to its own tool/function-calling format.
 */
export interface LlmTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/**
 * A single chat turn.
 *
 * Modelled as a discriminated union on `role` so the type system enforces which
 * fields are valid per turn:
 *  - `system` / `user`: plain `content`.
 *  - `assistant`: `content` plus optional `toolCalls` (a tool-calling turn).
 *  - `tool`: the result of executing a tool, tied back via `toolCallId`.
 *
 * Existing callers that build `{ role: 'system' | 'user' | 'assistant', content }`
 * continue to typecheck: `toolCalls` is optional on the assistant variant.
 */
export type LlmMessage =
  | { readonly role: 'system' | 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly content: string; readonly toolCalls?: LlmToolCall[] }
  | { readonly role: 'tool'; readonly toolCallId: string; readonly content: string };

/**
 * A provider-agnostic completion request.
 *
 * `jsonSchema` is an optional structured-output hint. It is typed as `unknown`
 * on purpose: each provider validates/translates it to its own structured
 * output mechanism (OpenAI `response_format`, etc.). Phase-1 governance code
 * supplies the concrete schema.
 *
 * `tools` advertises callable tools to the model; `toolChoice` steers whether
 * the model may call them (`'auto'`) or must answer in text (`'none'`).
 */
export interface LlmRequest {
  readonly messages: LlmMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly jsonSchema?: unknown;
  readonly tools?: LlmTool[];
  readonly toolChoice?: 'auto' | 'none';
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
  /**
   * Tool calls the model requested, if any. Present (and typically non-empty)
   * when `finishReason === 'tool_calls'`. The caller executes these and feeds
   * the results back as `{ role: 'tool', ... }` messages on the next request.
   */
  readonly toolCalls?: LlmToolCall[];
  /**
   * Why the model stopped: `'stop'` (natural end), `'tool_calls'` (wants tools
   * run), `'length'` (hit `maxTokens`), or `'other'` (anything else/unknown).
   */
  readonly finishReason?: 'stop' | 'tool_calls' | 'length' | 'other';
}
