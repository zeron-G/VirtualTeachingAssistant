/**
 * Pi-backed chat provider — the ONLY file in this package that imports pi-ai.
 *
 * All Pi specifics are quarantined here. The rest of `@vta/llm` depends on the
 * provider-agnostic {@link LlmProvider} interface, so if pi-ai's API differs
 * from what is assumed below, this is the only file that needs to change.
 *
 * TODO(verify-at-install): "@mariozechner/pi-ai" — the exact npm package name,
 * version, and especially its runtime API are UNVERIFIED. The import and the
 * `PiAiClient`/`PiCompletion` shapes below are a small ASSUMED surface. At
 * install time: (1) confirm the package resolves, (2) confirm the entry point
 * and method names, (3) adjust `toPiMessages` / `callPi` / `fromPiResult`
 * accordingly. Everything Pi-specific lives in those three helpers.
 */

// TODO(verify-at-install): confirm this import path/specifier exists.
// Imported as a namespace so a wrong/missing named export fails loudly here
// rather than silently producing `undefined`.
import * as PiAi from '@earendil-works/pi-ai';
import { LlmUnavailableError, toError } from '@vta/shared';
import type { LlmProvider } from '../provider.js';
import type { LlmMessage, LlmRequest, LlmResult, Usage } from '../types.js';

/**
 * Assumed minimal shape of pi-ai. Kept deliberately small and local.
 * TODO(verify-at-install): replace with the real pi-ai types/signature.
 */
interface PiAiClientLike {
  complete(input: {
    model: string;
    messages: { role: string; content: string }[];
    temperature?: number;
    maxTokens?: number;
    baseUrl?: string;
    apiKey?: string;
    bearerToken?: string;
    responseSchema?: unknown;
  }): Promise<PiCompletionLike>;
}

/** Assumed pi-ai completion result shape. */
interface PiCompletionLike {
  text?: string;
  content?: string;
  usage?: { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number };
}

/**
 * How this provider obtains credentials at call time. The router supplies one
 * of these so the Pi adapter stays agnostic about apiKey-vs-oauth resolution.
 */
export type PiCredential =
  | { readonly kind: 'apiKey'; readonly apiKey: string }
  | { readonly kind: 'bearer'; readonly getToken: () => Promise<string> };

export interface PiProviderOptions {
  /** Concrete model id (e.g. "gpt-5.4-mini", "deepseek-v4-flash"). */
  readonly model: string;
  /** Provider family label, used only for `id`/usage (e.g. "openai"). */
  readonly providerLabel: string;
  /** Optional base URL override (DeepSeek / Azure / OpenAI-compatible). */
  readonly endpoint?: string;
  /** Credential strategy resolved by the router. */
  readonly credential: PiCredential;
}

/** Build the assumed pi-ai client. Isolated so the construction call is swappable. */
function makePiClient(): PiAiClientLike {
  // TODO(verify-at-install): the real constructor/factory is unknown. We probe
  // a couple of plausible shapes and fail loudly if none match, instead of
  // crashing with an opaque "X is not a function".
  const mod = PiAi as unknown as {
    PiAi?: new () => PiAiClientLike;
    Client?: new () => PiAiClientLike;
    createClient?: () => PiAiClientLike;
    complete?: PiAiClientLike['complete'];
  };

  if (typeof mod.createClient === 'function') return mod.createClient();
  if (typeof mod.PiAi === 'function') return new mod.PiAi();
  if (typeof mod.Client === 'function') return new mod.Client();
  if (typeof mod.complete === 'function') {
    // Module exposes a bare `complete` function rather than a client object.
    return { complete: mod.complete.bind(mod) };
  }

  throw new LlmUnavailableError(
    'pi-ai client could not be constructed — its API does not match the assumed surface. ' +
      'TODO(verify-at-install): fix makePiClient() in piProvider.ts.',
  );
}

/** Map our messages to pi-ai's. Trivial today; isolated for future drift. */
function toPiMessages(messages: LlmMessage[]): { role: string; content: string }[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

/** Normalise a pi-ai result into our {@link LlmResult}. */
function fromPiResult(
  raw: PiCompletionLike,
  model: string,
  provider: string,
): LlmResult {
  const text = raw.text ?? raw.content ?? '';
  const usage: Usage = {
    inputTokens: raw.usage?.inputTokens ?? raw.usage?.promptTokens ?? 0,
    outputTokens: raw.usage?.outputTokens ?? raw.usage?.completionTokens ?? 0,
  };
  return { text, usage, model, provider };
}

/**
 * A chat provider whose backend is pi-ai. Works for any pi-ai-supported model
 * (OpenAI, DeepSeek, OpenAI-compatible) — the difference is just `model`,
 * `endpoint`, and the credential the router injects.
 */
export class PiProvider implements LlmProvider {
  readonly id: string;
  private readonly client: PiAiClientLike;

  constructor(private readonly options: PiProviderOptions) {
    this.id = `${options.providerLabel}:${options.model}`;
    this.client = makePiClient();
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const { model, providerLabel, endpoint, credential } = this.options;

    // Resolve credentials immediately before the call (tokens may refresh).
    const auth =
      credential.kind === 'apiKey'
        ? { apiKey: credential.apiKey }
        : { bearerToken: await credential.getToken() };

    try {
      const raw = await this.client.complete({
        model,
        messages: toPiMessages(req.messages),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
        ...(endpoint !== undefined ? { baseUrl: endpoint } : {}),
        ...(req.jsonSchema !== undefined ? { responseSchema: req.jsonSchema } : {}),
        ...auth,
      });
      return fromPiResult(raw, model, providerLabel);
    } catch (err) {
      // Surface all backend failures as a uniform availability error so the
      // router's failover logic can react. Never include the credential.
      throw new LlmUnavailableError(`pi-ai completion failed for ${this.id}`, {
        provider: providerLabel,
        model,
        cause: toError(err).message,
      });
    }
  }
}
