/**
 * The narrow capability interfaces every concrete provider implements.
 *
 * The router depends only on these interfaces, never on a concrete SDK. This is
 * the seam that makes the LLM layer swappable: add a new backend by writing a
 * class that satisfies one of these, then map a role to it in config.
 */

import type { LlmRequest, LlmResult } from './types.js';

/** A chat/completion-capable backend (one concrete provider + model). */
export interface LlmProvider {
  /** Stable identifier for logs/usage, e.g. "openai:gpt-5.4-mini". */
  readonly id: string;
  complete(req: LlmRequest): Promise<LlmResult>;
}

/** A text-embedding backend. */
export interface Embedder {
  /**
   * Embed a batch of texts. Returns one vector per input, in input order.
   * Implementations should preserve order and length: `out.length === texts.length`.
   */
  embed(texts: string[]): Promise<number[][]>;
}

/** A reranking backend that scores documents against a query. */
export interface Reranker {
  /**
   * Rerank `docs` against `query` and return the top `topK` as
   * `{ index, score }` referring back into the original `docs` array,
   * sorted by descending score.
   */
  rerank(query: string, docs: string[], topK: number): Promise<{ index: number; score: number }[]>;
}
