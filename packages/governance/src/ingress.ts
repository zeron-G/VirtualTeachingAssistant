/**
 * Ingress chokepoint (governance stage `ingress`).
 *
 * This is the first of three gates. It runs over the UNTRUSTED inbound text
 * BEFORE the model ever sees it, and enforces both halves of the dual
 * requirement at the input boundary:
 *   1. Never let an attacker steer the assistant — detect prompt injection /
 *      jailbreak attempts and block them.
 *   2. Never let PII reach the model — redact it out of whatever text is
 *      allowed through.
 *
 * FAIL-SAFE: if the injection detector THROWS, we treat the request as blocked
 * (default-deny) and emit a `flag` verdict; we never let a detector failure
 * become an implicit "allow". A PII redactor failure likewise blocks rather
 * than forwarding un-redacted text to the model.
 */

import { makeVerdict } from '@vta/audit';
import type { GovernanceVerdict } from '@vta/audit';
import { toError } from '@vta/shared';

import type { GovernanceContext } from './context.js';
import type { InjectionDetector, PiiRedactor } from './ports.js';

/** Neutral, non-leaky refusal shown when input is blocked at ingress. */
export const INGRESS_REFUSAL =
  'I can only help with genuine questions about this course. Please rephrase your request.';

/** Dependencies injected into {@link IngressGovernor}. */
export interface IngressGovernorDeps {
  /**
   * LOCAL injection detector, run on the RAW text. Must be in-process (e.g. the
   * regex heuristic) — it sees un-redacted input, so it must never forward text
   * to an external service. Running on raw text preserves signature accuracy
   * (redaction can widen a signature's char gaps and cause a miss).
   */
  readonly injection: InjectionDetector;
  readonly pii: PiiRedactor;
  /**
   * OPTIONAL injection detector run on the REDACTED text — for model-backed
   * detectors that MUST NOT see raw PII (e.g. the OpenRouter guard.judge). On
   * error it degrades to the local `injection` result (fail-open for this arm)
   * rather than blocking every request during a model outage.
   */
  readonly redactedInjection?: InjectionDetector;
}

/** Outcome of an ingress inspection. */
export interface IngressDecision {
  /** `true` when the (now-redacted) text may proceed to the model. */
  readonly allow: boolean;
  /**
   * The text to forward to the model. PII-redacted when allowed; the original
   * text is NEVER returned here when `allow` is false (callers must not forward
   * a blocked request anyway).
   */
  readonly redactedText: string;
  /** Present when `allow` is false: the neutral message to return to the user. */
  readonly refusal?: string;
  /** Verdicts to append to the audit log. Always at least one. */
  readonly verdicts: GovernanceVerdict[];
}

const STAGE = 'ingress';

export class IngressGovernor {
  private readonly injection: InjectionDetector;
  private readonly pii: PiiRedactor;
  private readonly redactedInjection: InjectionDetector | undefined;

  constructor(deps: IngressGovernorDeps) {
    this.injection = deps.injection;
    this.pii = deps.pii;
    this.redactedInjection = deps.redactedInjection;
  }

  /**
   * Inspect untrusted inbound text.
   *
   * Order:
   *   1. PII redaction. On a THROWN error -> block + `flag` (never forward raw PII).
   *   2. LOCAL injection detection over the RAW text (in-process; raw never leaves
   *      the process). Run on raw — not redacted — because redaction can widen a
   *      signature's char-bounded gap and cause a miss. Positive -> block; THROW
   *      -> block (default-deny).
   *   3. OPTIONAL model-backed injection detection over the REDACTED text (so an
   *      external classifier never sees raw PII). Positive -> block; THROW ->
   *      degrade to step 2's result (flag + allow), not block-everything.
   */
  // `_ctx` is reserved for future per-course injection sensitivity / rules.
  async inspect(text: string, _ctx: GovernanceContext): Promise<IngressDecision> {
    const verdicts: GovernanceVerdict[] = [];

    // (1) Redact PII FIRST, so anything sent to an EXTERNAL service (step 3, the
    // model-backed detector, and the answering model downstream) is redacted.
    let redacted: string;
    try {
      const result = await this.pii.redact(text);
      redacted = result.redacted;
      verdicts.push(
        makeVerdict(
          STAGE,
          'pii.ingress',
          result.foundCount > 0 ? 'flag' : 'allow',
          result.foundCount > 0 ? `redacted ${result.foundCount} PII span(s) from input` : undefined,
        ),
      );
    } catch (err) {
      const reason = `PII redactor error (blocking to avoid leaking raw input): ${toError(err).message}`;
      verdicts.push(makeVerdict(STAGE, 'pii.ingress', 'flag', reason));
      return { allow: false, redactedText: '', refusal: INGRESS_REFUSAL, verdicts };
    }

    // (2) LOCAL injection detection on the RAW text (accurate; stays in-process).
    try {
      const result = await this.injection.detect(text);
      if (result.injection) {
        const reason = await this.safeReason(result.reason);
        verdicts.push(makeVerdict(STAGE, 'injection', 'block', reason));
        return { allow: false, redactedText: '', refusal: INGRESS_REFUSAL, verdicts };
      }
      verdicts.push(makeVerdict(STAGE, 'injection', 'allow'));
    } catch (err) {
      // FAIL-SAFE: a local detector failure must default-deny, not silently pass.
      const reason = `injection detector error (default-deny): ${toError(err).message}`;
      verdicts.push(makeVerdict(STAGE, 'injection', 'flag', reason));
      return { allow: false, redactedText: '', refusal: INGRESS_REFUSAL, verdicts };
    }

    // (3) OPTIONAL model-backed injection detection on the REDACTED text.
    if (this.redactedInjection !== undefined) {
      try {
        const result = await this.redactedInjection.detect(redacted);
        if (result.injection) {
          const reason = await this.safeReason(result.reason);
          verdicts.push(makeVerdict(STAGE, 'injection.llm', 'block', reason));
          return { allow: false, redactedText: '', refusal: INGRESS_REFUSAL, verdicts };
        }
        verdicts.push(makeVerdict(STAGE, 'injection.llm', 'allow'));
      } catch (err) {
        // Degrade to the local heuristic (already passed) rather than block all.
        const reason = `llm injection detector error (degraded to heuristic): ${toError(err).message}`;
        verdicts.push(makeVerdict(STAGE, 'injection.llm', 'flag', reason));
      }
    }

    return { allow: true, redactedText: redacted, verdicts };
  }

  /**
   * Redact PII from already-trusted text — e.g. prior conversation turns that
   * were governed when first handled and are now replayed to the model as
   * context. Unlike {@link inspect} this runs ONLY the PII redactor, not
   * injection detection (the turn is context, not a fresh untrusted request).
   * Propagates a redactor error so the caller can fail safe (drop the turn).
   */
  async redactText(text: string): Promise<string> {
    const { redacted } = await this.pii.redact(text);
    return redacted;
  }

  /**
   * Redact a detector's reason string before it enters the audit log, capped to
   * a sane length. Best-effort: on any redactor error, fall back to a fixed,
   * PII-free label rather than risk logging raw text.
   */
  private async safeReason(reason: string | undefined): Promise<string> {
    if (reason === undefined || reason === '') return 'prompt-injection detected';
    try {
      const { redacted } = await this.pii.redact(reason);
      return redacted.slice(0, 200);
    } catch {
      return 'prompt-injection detected';
    }
  }
}
