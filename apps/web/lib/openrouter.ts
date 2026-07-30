/**
 * OpenRouter calls for the debate module: speech-to-text and the AI judge.
 *
 * Both go through the SAME `openrouter.api-key` the rest of the system already
 * uses — verified end-to-end: `openai/whisper-1` on
 * `POST /api/v1/audio/transcriptions` returns `{ text, usage:{seconds,cost} }`
 * (~$0.0015 per 15s ≈ $0.36/audio-hour). Because capture is floor-controlled,
 * one speaking turn is one clip is one request — no streaming STT needed.
 *
 * This is a small, self-contained client rather than `@vta/llm`'s ModelRouter:
 * the web app has no SecretsProvider wiring, and the debate path only needs two
 * calls. Usage is still recorded to `usage_records` so debate spend shows up in
 * the same `usage:report` as everything else.
 */

import { UsageRepository } from '@vta/data';
import { getDb } from './db';

const BASE = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

/** Transcription model. Batch (per-clip), which is exactly what push-to-talk produces. */
export const STT_MODEL = 'openai/whisper-1';
/** Judge model — same primary the Discord agent uses. */
export const JUDGE_MODEL = 'anthropic/claude-opus-4.8';

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (key === undefined || key === '') {
    throw new Error('OPENROUTER_API_KEY is not set');
  }
  return key;
}

/** Fire-and-forget usage accounting; never blocks or breaks the request path. */
function recordUsage(role: string, model: string, inputTokens: number, outputTokens: number, latencyMs: number): void {
  try {
    void new UsageRepository(getDb())
      .record({ role, provider: 'openrouter', model, inputTokens, outputTokens, latencyMs })
      .catch(() => undefined);
  } catch {
    /* usage accounting must never break the feature */
  }
}

export interface TranscriptionResult {
  readonly text: string;
  readonly seconds: number;
}

/** Transcribe one speaking turn. `audio` is the raw clip from MediaRecorder. */
export async function transcribe(audio: Blob, filename: string): Promise<TranscriptionResult> {
  const started = Date.now();
  const form = new FormData();
  form.append('file', audio, filename);
  form.append('model', STT_MODEL);

  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`transcription failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { text?: string; usage?: { seconds?: number } };
  const seconds = data.usage?.seconds ?? 0;
  recordUsage('debate.stt', STT_MODEL, 0, 0, Date.now() - started);
  return { text: (data.text ?? '').trim(), seconds };
}

/** One chat completion (used by the AI judge). Returns the assistant text. */
export async function chat(
  system: string,
  user: string,
  opts: { model?: string; maxTokens?: number; role?: string } = {},
): Promise<string> {
  const model = opts.model ?? JUDGE_MODEL;
  const started = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      // Always bound the output — a runaway judge on a shared key would also
      // degrade the production Discord bot.
      max_tokens: opts.maxTokens ?? 2000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`chat failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  recordUsage(
    opts.role ?? 'debate.judge',
    model,
    data.usage?.prompt_tokens ?? 0,
    data.usage?.completion_tokens ?? 0,
    Date.now() - started,
  );
  return data.choices?.[0]?.message?.content ?? '';
}
