/**
 * OpenAI-backed content moderation.
 *
 * Wraps OpenAI's hosted moderation endpoint (`omni-moderation-latest`) — a real
 * ML safety classifier — behind a tiny `moderate(text) -> { flagged, categories }`
 * surface. It is structurally compatible with `@vta/governance`'s `Moderator`
 * port, so `@vta/core` can inject an instance into the egress governor without
 * `@vta/llm` importing the governance package.
 *
 * The moderation endpoint is free and fast; it runs as a backstop AFTER the
 * deterministic + judge content rails at egress.
 */

import OpenAI from 'openai';
import { LlmUnavailableError, toError } from '@vta/shared';
import type { PiCredential } from './piProvider.js';

/** Result of a moderation pass (matches the governance `ModerationResult` shape). */
export interface ModerationOutcome {
  readonly flagged: boolean;
  readonly categories: string[];
}

export interface OpenAiModeratorOptions {
  /** Moderation model id (default: omni-moderation-latest). */
  readonly model?: string;
  /** Optional base URL override (must be OpenAI-compatible for /moderations). */
  readonly endpoint?: string;
  /** Credential strategy resolved by the caller. */
  readonly credential: PiCredential;
}

const DEFAULT_MODEL = 'omni-moderation-latest';

export class OpenAiModerator {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAiModeratorOptions) {
    this.client = new OpenAI({
      apiKey: options.credential.apiKey,
      ...(options.endpoint !== undefined ? { baseURL: options.endpoint } : {}),
    });
    this.model = options.model ?? DEFAULT_MODEL;
  }

  /** Classify `text`; returns whether it is flagged and which categories fired. */
  async moderate(text: string): Promise<ModerationOutcome> {
    if (text.trim() === '') return { flagged: false, categories: [] };
    try {
      const response = await this.client.moderations.create({ model: this.model, input: text });
      const result = response.results[0];
      if (result === undefined) return { flagged: false, categories: [] };
      const categories = Object.entries(result.categories)
        .filter(([, on]) => on === true)
        .map(([name]) => name);
      return { flagged: result.flagged, categories };
    } catch (err) {
      // Propagate; the egress moderation backstop is fail-open and records it.
      throw new LlmUnavailableError('moderation request failed', {
        model: this.model,
        cause: toError(err).message,
      });
    }
  }
}
