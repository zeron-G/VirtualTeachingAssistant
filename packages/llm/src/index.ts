/**
 * `@vta/llm` — the swappable LLM layer.
 *
 * CARDINAL RULE: no other package names a concrete model. Callers ask the
 * {@link ModelRouter} for a logical {@link LlmRole} (from `@vta/shared`); this
 * layer resolves it to a concrete provider + model, authenticates with API keys,
 * fails over primary→fallback, and records usage.
 *
 * All external-SDK usage is isolated in `providers/piProvider.ts` (chat, via the
 * OpenAI SDK — also serves OpenAI-compatible gateways like OpenRouter/DeepSeek)
 * and `providers/openaiEmbedder.ts` (embeddings).
 */

// Core wire types
export type {
  LlmMessage,
  LlmRequest,
  Usage,
  LlmResult,
  LlmTool,
  LlmToolCall,
} from './types.js';

// Capability interfaces
export type { LlmProvider, Embedder, Reranker } from './provider.js';

// Role → model mapping
export type { ProviderKind, AuthKind, ModelSpec, RoleMapping } from './roles.js';

// Profiles / config
export { PROFILES, loadProfile } from './config.js';
export type { LlmProfileName } from './config.js';

// Auth helpers
export { resolveApiKey } from './auth/apiKey.js';

// Usage accounting
export { LoggingUsageSink, NullUsageSink } from './usage.js';
export type { UsageSink, UsageRecord } from './usage.js';

// Providers (exported for advanced/standalone use; the router uses them internally)
export { PiProvider } from './providers/piProvider.js';
export type { PiProviderOptions, PiCredential } from './providers/piProvider.js';
export { OpenAiEmbedder } from './providers/openaiEmbedder.js';
export type { OpenAiEmbedderOptions } from './providers/openaiEmbedder.js';

// The router — primary public surface
export { ModelRouter } from './router.js';
export type { ModelRouterOptions } from './router.js';

// Web search (a tool capability, not a chat role) via OpenRouter's `:online`.
export { OpenRouterWebSearch } from './webSearch.js';
export type { OpenRouterWebSearchOptions, WebSearchResult } from './webSearch.js';
