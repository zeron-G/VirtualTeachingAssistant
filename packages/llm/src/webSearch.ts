/**
 * Web search via OpenRouter's `:online` mechanism.
 *
 * Appending `:online` to a chat model id makes OpenRouter run a web search
 * server-side and return a synthesised answer with `url_citation` annotations,
 * reusing the SAME OpenRouter key as the rest of the model traffic — no
 * third-party search API and no separate credential.
 *
 * It is deliberately standalone (not a chat `LlmProvider`/role): web search is a
 * TOOL capability, not a logical chat role. `@vta/core` builds one of these from
 * the resolved OpenRouter key and injects its `search` into the web_search tool.
 */

import OpenAI from 'openai';
import { LlmUnavailableError, toError } from '@vta/shared';
import type { Citation } from '@vta/shared';

import { DEFAULT_MAX_RETRIES, DEFAULT_REQUEST_TIMEOUT_MS } from './transport.js';

/** The result of a web search: a synthesised answer plus source citations. */
export interface WebSearchResult {
  readonly text: string;
  readonly citations: Citation[];
}

/** One `url_citation` annotation on an OpenRouter chat message. */
interface ChatUrlAnnotation {
  readonly type?: string;
  readonly url_citation?: { readonly url?: string; readonly title?: string };
}

const OPENROUTER_DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1';
const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o-mini';

export interface OpenRouterWebSearchOptions {
  /** OpenRouter API key. */
  readonly apiKey: string;
  /** Base model id; `:online` is appended to enable OpenRouter's web plugin. */
  readonly model?: string;
  /** Base URL override (defaults to OpenRouter). */
  readonly endpoint?: string;
}

/**
 * Web search via OpenRouter's `:online` mechanism: appending `:online` to a
 * chat model id makes OpenRouter run a web search and inject the results, then
 * return a synthesised answer with `url_citation` annotations. Uses the SAME
 * OpenRouter key as the rest of the model traffic — no OpenAI dependency.
 */
export class OpenRouterWebSearch {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenRouterWebSearchOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.endpoint ?? OPENROUTER_DEFAULT_ENDPOINT,
      timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      maxRetries: DEFAULT_MAX_RETRIES,
    });
    this.model = `${options.model ?? OPENROUTER_DEFAULT_MODEL}:online`;
  }

  async search(query: string): Promise<WebSearchResult> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content:
              'Search the web and answer concisely with the key facts. Always ' +
              'include the source URLs you used.\n\nQuery: ' +
              query,
          },
        ],
      });
      const message = completion.choices[0]?.message;
      const text = message?.content ?? '';
      const annotations =
        (message as { annotations?: ChatUrlAnnotation[] } | undefined)?.annotations ?? [];
      return { text, citations: fromChatAnnotations(annotations) };
    } catch (err) {
      throw new LlmUnavailableError('web search failed', {
        model: this.model,
        cause: toError(err).message,
      });
    }
  }
}

/** Pull deduped `url_citation` annotations off an OpenRouter chat message. */
function fromChatAnnotations(annotations: readonly ChatUrlAnnotation[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const ann of annotations) {
    const url = ann.type === 'url_citation' ? ann.url_citation?.url : undefined;
    if (typeof url === 'string' && url !== '' && !seen.has(url)) {
      seen.add(url);
      const title = ann.url_citation?.title;
      citations.push({
        sourceId: url,
        title: title !== undefined && title !== '' ? title : url,
        locator: url,
      });
    }
  }
  return citations;
}
