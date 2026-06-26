/**
 * CodexAgent — the DEGRADED-BUT-SAFE fallback `CourseAgent`.
 *
 * When the primary (Pi) path is unavailable, we fall back to the Codex CLI.
 * Codex here has NO tools and NO RAG of its own, so this agent does the
 * grounding itself: it retrieves course context up front via the injected
 * `RagRetriever`, injects those chunks into the prompt, and instructs Codex to
 * answer ONLY from that context and cite — or say it does not know.
 *
 * SAFETY: Codex is spawned read-only with no network access. The prompt is
 * delivered on STDIN (never on argv, so it cannot leak via the process table or
 * be misparsed as flags). Any non-zero exit, spawn error, or error event is
 * treated as failure and surfaced as `LlmUnavailableError` so the caller's
 * `FallbackAgent` can react.
 *
 * ALL Codex-specific assumptions (the exact CLI flags and the JSONL event
 * shape) are ISOLATED to this file and marked `TODO(verify-at-install)`. They
 * must be confirmed against the installed Codex CLI before this path is relied
 * upon in production.
 */

import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createLogger, LlmUnavailableError, toError } from '@vta/shared';
import type { Citation, Logger } from '@vta/shared';
import type { RagRetriever, RetrievalResult } from '@vta/rag';

import type { AgentInput, AgentOutput, CourseAgent } from './types.js';

/**
 * TODO(verify-at-install): exact Codex CLI argument vector.
 *   - `exec`                 — non-interactive one-shot execution.
 *   - `--json`               — emit JSONL events on stdout (parsed below).
 *   - `--sandbox read-only`  — REQUIRED: no filesystem writes.
 *   - `--skip-git-repo-check`— do not require a git repo in cwd.
 * Network access must also be disabled (read-only sandbox is expected to imply
 * no network; verify the flag/default at install). These are degraded-but-safe
 * defaults; confirm them against the installed `codex` version.
 */
const CODEX_ARGS: readonly string[] = [
  'exec',
  '--json',
  '--sandbox',
  'read-only',
  '--skip-git-repo-check',
];

/**
 * Sandbox modes that grant write and/or network access. The fallback must NEVER
 * run under these: it answers with student data + retrieved course material in
 * the prompt, so any outbound network would be an exfiltration path. We
 * hard-assert read-only before every spawn (fail-closed) — the args are a const,
 * but this guards against any future edit that relaxes them.
 *
 * TODO(verify-at-install): confirm on the PINNED Codex version that
 * `--sandbox read-only` also severs NETWORK (read-only is Codex's most
 * restrictive mode and is expected to). If a version decouples them, add the
 * explicit network-off flag to CODEX_ARGS and keep this assertion.
 */
const FORBIDDEN_SANDBOX_TOKENS: readonly string[] = ['danger-full-access', 'workspace-write'];

/** Fail-closed: refuse to spawn unless the read-only (no-network) sandbox is set. */
function assertNetworkIsolated(args: readonly string[]): void {
  const hasReadOnly =
    args.includes('--sandbox=read-only') ||
    args.some((a, i) => a === '--sandbox' && args[i + 1] === 'read-only');
  const hasForbidden = args.some((a) => FORBIDDEN_SANDBOX_TOKENS.some((t) => a.includes(t)));
  if (!hasReadOnly || hasForbidden) {
    throw new LlmUnavailableError(
      'Codex fallback refused to spawn: read-only (no-network) sandbox is not enforced',
      { args: args.join(' ') },
    );
  }
}

/** Default executable name; overridable via deps for tests / non-PATH installs. */
const DEFAULT_CODEX_BIN = 'codex';

/** Constructor dependencies for {@link CodexAgent}. */
export interface CodexAgentDeps {
  readonly retriever: RagRetriever;
  readonly logger?: Logger;
  /** Path/name of the Codex executable. Defaults to `"codex"` on PATH. */
  readonly codexBin?: string;
}

export class CodexAgent implements CourseAgent {
  private readonly retriever: RagRetriever;
  private readonly log: Logger;
  private readonly codexBin: string;

  constructor(deps: CodexAgentDeps) {
    this.retriever = deps.retriever;
    this.log = deps.logger ?? createLogger({ name: 'codex-agent' });
    this.codexBin = deps.codexBin ?? DEFAULT_CODEX_BIN;
  }

  async answer(input: AgentInput): Promise<AgentOutput> {
    // 1. Retrieve course context ourselves — Codex has no RAG/tools. Tenant
    //    scope comes from govContext.
    const retrieval: RetrievalResult = await this.retriever.retrieve(
      input.govContext.courseId,
      input.question,
    );

    const prompt = buildCodexPrompt(input, retrieval);

    // 2. Run Codex with the prompt on STDIN; parse the JSONL for the final
    //    assistant message.
    const text = await this.runCodex(prompt, input.govContext.requestId);

    return {
      text,
      citations: [...retrieval.citations],
      toolInvocations: [],
      governanceVerdicts: [],
    };
  }

  /**
   * Spawn the Codex CLI, feed `prompt` on STDIN, and resolve with the final
   * assistant message parsed from the JSONL on stdout. Rejects with
   * `LlmUnavailableError` on spawn error, non-zero exit, an error event, or if
   * no assistant message could be parsed.
   */
  private runCodex(prompt: string, requestId: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const fail = (message: string, context?: Record<string, unknown>): void => {
        reject(new LlmUnavailableError(message, { requestId, ...context }));
      };

      // Fail-closed network/sandbox guard BEFORE spawning anything.
      try {
        assertNetworkIsolated(CODEX_ARGS);
      } catch (err) {
        fail(toError(err).message);
        return;
      }

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.codexBin, [...CODEX_ARGS], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        fail('Failed to spawn Codex CLI', { cause: toError(err).message });
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;

      const settleResolve = (value: string): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const settleReject = (message: string, context?: Record<string, unknown>): void => {
        if (settled) return;
        settled = true;
        fail(message, context);
      };

      child.on('error', (err) => {
        settleReject('Codex CLI process error', { cause: toError(err).message });
      });

      const { stdout: out, stderr: errStream, stdin } = child;
      out?.setEncoding('utf8');
      out?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      errStream?.setEncoding('utf8');
      errStream?.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('close', (code) => {
        if (code !== 0) {
          this.log.error({ requestId, code, stderr: stderr.slice(0, 2000) }, 'codex exited non-zero');
          settleReject('Codex CLI exited with a non-zero status', { code });
          return;
        }
        let finalText: string;
        try {
          finalText = parseFinalMessage(stdout);
        } catch (err) {
          this.log.error({ requestId, err }, 'failed to parse codex output');
          settleReject('Codex CLI produced no parseable assistant message', {
            cause: toError(err).message,
          });
          return;
        }
        settleResolve(finalText);
      });

      // Deliver the prompt on STDIN, never argv.
      if (stdin === null) {
        settleReject('Codex CLI stdin is unavailable');
        return;
      }
      stdin.on('error', (err) => {
        settleReject('Failed to write prompt to Codex stdin', { cause: toError(err).message });
      });
      stdin.end(prompt, 'utf8');
    });
  }
}

/**
 * Compose the Codex prompt: a strict grounding instruction followed by the
 * retrieved course context and the student's question. Because Codex cannot
 * retrieve anything itself, the injected context is the ONLY material it may
 * use; the instruction makes that explicit and tells it to cite or admit it
 * does not know.
 */
function buildCodexPrompt(input: AgentInput, retrieval: RetrievalResult): string {
  const locale = input.locale?.trim();
  const languageDirective =
    locale !== undefined && locale !== ''
      ? `Reply in the student's language (BCP-47 hint: "${locale}"); default to English if unclear.`
      : "Reply in the student's language; default to English if unclear.";

  const context = formatContext(retrieval);

  return [
    'You are a Virtual Teaching Assistant for a single university course.',
    'You have NO tools and NO ability to search. The ONLY course material available to you is the CONTEXT block below.',
    'Answer ONLY using that context. Cite the sources you use by their bracketed numbers. If the context does not contain the answer, say plainly that you could not find it in the course materials — do NOT use outside knowledge or guess.',
    'Do not provide full solutions to graded work; redirect grade or off-topic questions to course staff.',
    languageDirective,
    '',
    '=== CONTEXT (retrieved course material) ===',
    context,
    '=== END CONTEXT ===',
    '',
    'STUDENT QUESTION:',
    input.question,
  ].join('\n');
}

/** Render the retrieved chunks + citations into a numbered context block. */
function formatContext(retrieval: RetrievalResult): string {
  if (retrieval.chunks.length === 0) {
    return '(No course material was found for this question.)';
  }
  const excerpts = retrieval.chunks.map((chunk, i) => {
    const label = chunk.title ?? chunk.materialId;
    const where = chunk.locator !== undefined ? ` (${chunk.locator})` : '';
    return `[${i + 1}] ${label}${where}\n${chunk.content.trim()}`;
  });
  const sources = formatSources(retrieval.citations);
  return sources !== undefined ? `${excerpts.join('\n\n')}\n\n${sources}` : excerpts.join('\n\n');
}

/** Render the citation list into a "Sources" block, or `undefined` when empty. */
function formatSources(citations: readonly Citation[]): string | undefined {
  if (citations.length === 0) return undefined;
  const lines = citations.map((citation, i) => {
    const locator = citation.locator !== undefined ? ` — ${citation.locator}` : '';
    return `[${i + 1}] ${citation.title}${locator} (source: ${citation.sourceId})`;
  });
  return ['Sources:', lines.join('\n')].join('\n');
}

/**
 * Parse the JSONL events Codex prints on stdout and return the final assistant
 * message's text.
 *
 * TODO(verify-at-install): the exact JSONL event shape. This parser is written
 * defensively against several plausible shapes and MUST be confirmed against
 * the installed Codex CLI:
 *   - An error event (`type`/`event` containing "error", or a top-level
 *     `error` field) → throw, so the caller maps it to `LlmUnavailableError`.
 *   - The final assistant message is taken as the LAST event that looks like an
 *     assistant/agent message with text content. Recognised text locations:
 *       `msg.text`, `msg.message`, `msg.content` (string), or
 *       `msg.content` (array of `{ type: 'text', text }` parts).
 * Lines that are not valid JSON are skipped (Codex may interleave plain logs).
 */
function parseFinalMessage(stdout: string): string {
  const lines = stdout.split(/\r?\n/);
  let finalText: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      // Not JSON — Codex may interleave human-readable logs. Skip.
      continue;
    }

    if (typeof event !== 'object' || event === null) continue;
    const record = event as Record<string, unknown>;

    // Error events fail the whole run.
    if (isErrorEvent(record)) {
      const message = extractErrorMessage(record);
      throw new Error(message ?? 'Codex reported an error event');
    }

    const text = extractAssistantText(record);
    if (text !== undefined && text.trim() !== '') {
      // Keep the last assistant text seen; later events override earlier ones.
      finalText = text;
    }
  }

  if (finalText === undefined) {
    throw new Error('no assistant message found in Codex output');
  }
  return finalText;
}

/** Heuristic: does this event represent an error? (TODO(verify-at-install)) */
function isErrorEvent(record: Record<string, unknown>): boolean {
  if ('error' in record && record.error !== undefined && record.error !== null) return true;
  const kind = typeof record.type === 'string' ? record.type : record.event;
  return typeof kind === 'string' && kind.toLowerCase().includes('error');
}

/** Best-effort error message extraction. */
function extractErrorMessage(record: Record<string, unknown>): string | undefined {
  const err = record.error;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === 'string') return msg;
  }
  if (typeof record.message === 'string') return record.message;
  return undefined;
}

/**
 * Best-effort extraction of assistant text from a JSONL event. Returns
 * `undefined` when the event is not an assistant message or carries no text.
 * (TODO(verify-at-install): confirm the real shape and tighten this.)
 */
function extractAssistantText(record: Record<string, unknown>): string | undefined {
  // Only consider assistant/agent-flavoured events when a role/type is present.
  const role = typeof record.role === 'string' ? record.role : undefined;
  const kind = typeof record.type === 'string' ? record.type : undefined;
  const looksAssistant =
    role === 'assistant' ||
    (kind !== undefined &&
      (kind.toLowerCase().includes('assistant') ||
        kind.toLowerCase().includes('agent') ||
        kind.toLowerCase().includes('message')));
  // If neither role nor type is present we still attempt text extraction, since
  // some event streams put the answer in a bare `{ text }` final event.
  if (role !== undefined && !looksAssistant) return undefined;

  // Some streams nest the payload under `msg`/`message`/`data`.
  const payload = pickPayload(record);

  return textFromPayload(payload);
}

/** Choose the most likely payload object carrying the message content. */
function pickPayload(record: Record<string, unknown>): Record<string, unknown> {
  for (const key of ['msg', 'message', 'data'] as const) {
    const nested = record[key];
    if (typeof nested === 'object' && nested !== null) {
      return nested as Record<string, unknown>;
    }
  }
  return record;
}

/** Pull a text string out of a payload that may use several content shapes. */
function textFromPayload(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.message === 'string') return payload.message;

  const content = payload.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === 'string') {
        parts.push(part);
        continue;
      }
      if (typeof part === 'object' && part !== null) {
        const partText = (part as Record<string, unknown>).text;
        if (typeof partText === 'string') parts.push(partText);
      }
    }
    if (parts.length > 0) return parts.join('');
  }
  return undefined;
}
