/**
 * OpenAI-backed embedder.
 *
 * Isolates the `openai` SDK for the embedding path (text-embedding-3-small by
 * default). Supports both credential strategies: a static API key, or a Codex
 * OAuth bearer token resolved lazily per call.
 *
 * TODO(verify-at-install): confirm the `openai` v4 SDK constructor options and
 * `embeddings.create` response shape against the pinned version (^4.77.0).
 */

import OpenAI from 'openai';
import { LlmUnavailableError, toError } from '@vta/shared';
import type { Embedder } from '../provider.js';
import type { PiCredential } from './piProvider.js';

export interface OpenAiEmbedderOptions {
  /** Embedding model id (default: text-embedding-3-small). */
  readonly model: string;
  /** Optional base URL override (Azure / OpenAI-compatible gateways). */
  readonly endpoint?: string;
  /** Credential strategy resolved by the router. */
  readonly credential: PiCredential;
}

export class OpenAiEmbedder implements Embedder {
  constructor(private readonly options: OpenAiEmbedderOptions) {}

  /**
   * Build a per-call client. OAuth tokens may rotate, so we resolve the token
   * and construct the client at call time rather than caching it.
   */
  private async makeClient(): Promise<OpenAI> {
    const { credential, endpoint } = this.options;
    const apiKey =
      credential.kind === 'apiKey' ? credential.apiKey : await credential.getToken();

    return new OpenAI({
      apiKey,
      ...(endpoint !== undefined ? { baseURL: endpoint } : {}),
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const client = await this.makeClient();
    try {
      const response = await client.embeddings.create({
        model: this.options.model,
        input: texts,
      });

      // The SDK returns data in input order, but we sort defensively by `index`
      // and validate the count so a partial response surfaces as an error.
      const sorted = [...response.data].sort((a, b) => a.index - b.index);
      if (sorted.length !== texts.length) {
        throw new LlmUnavailableError('OpenAI embeddings returned an unexpected count', {
          expected: texts.length,
          received: sorted.length,
        });
      }
      return sorted.map((d) => d.embedding as number[]);
    } catch (err) {
      if (err instanceof LlmUnavailableError) throw err;
      throw new LlmUnavailableError(`OpenAI embedding failed for model ${this.options.model}`, {
        model: this.options.model,
        cause: toError(err).message,
      });
    }
  }
}
