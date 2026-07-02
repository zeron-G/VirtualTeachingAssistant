/**
 * Shared transport-resilience defaults for every OpenAI-SDK client in this
 * package (chat, embeddings, moderation, web search).
 *
 * These are RESILIENCE guards, not a cost budget: they bound how long a single
 * upstream call may hang and how large a single completion may grow, so one
 * stalled or runaway request can never wedge a worker replica. The OpenAI SDK's
 * own default request timeout is 10 minutes — far too long for an interactive
 * Discord bot running a single replica, where one wedged reply blocks everyone.
 */

/**
 * Abort a single upstream HTTP request after this long (ms). Covers slow but
 * legitimate work (tool-using completions, `:online` web search) while still
 * bailing out of a black-holed connection well within a human's patience.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/**
 * SDK-level automatic retries on transient (network / 429 / 5xx / timeout)
 * failures. Kept at 1 (below the SDK default of 2) so worst-case latency is
 * bounded — the app already has its own failover (router primary→fallback model,
 * then the static fallback agent) on top of this.
 */
export const DEFAULT_MAX_RETRIES = 1;

// NOTE: we deliberately do NOT impose a default max_tokens output cap. The
// request timeout above already bounds a runaway generation (an endless stream
// aborts at the deadline), and a fixed token ceiling would silently TRUNCATE
// long, fully-cited TA answers — a real quality regression. A caller may still
// pass `req.maxTokens` explicitly when it wants a bound.
