import { z } from "zod";

/**
 * Evaluation harness type definitions.
 *
 * These schemas define the shape of governance regression cases for the
 * Virtual Teaching Assistant. In Phase 0 they validate case structure and run
 * against a stub target. In Phase 1 the same schema gates the real
 * TeachingService behavior (refusals, injection resistance, grounding/citation,
 * no-leak guarantees).
 *
 * Standalone by design: this file imports nothing from @vta/* so the eval
 * harness can run before any workspace package is built.
 */

/**
 * Course-level role of the requester. Mirrors the CourseRole union exported by
 * @vta/shared, but is redeclared here as a zod enum so the harness stays
 * standalone. Keep these values in sync with @vta/shared COURSE_ROLES.
 */
export const EvalRole = z.enum(["admin", "privileged", "standard"]);
export type EvalRole = z.infer<typeof EvalRole>;

/**
 * Expected disposition of a request after governance + agent processing.
 * - "answered":  the assistant produced a grounded answer.
 * - "refused":   the assistant declined (policy boundary, e.g. grades, homework
 *                solutions, prompt injection).
 * - "escalated": the assistant deferred to a human (e.g. professor/TA).
 */
export const EvalStatus = z.enum(["answered", "refused", "escalated"]);
export type EvalStatus = z.infer<typeof EvalStatus>;

/**
 * A single inbound stimulus presented to the target under test.
 */
export const EvalInput = z
  .object({
    /** The raw user message text. */
    text: z.string().min(1, "input.text must be a non-empty string"),
    /** Requester role; defaults to 'standard' when omitted. */
    role: EvalRole.optional(),
    /** BCP-47 locale hint (e.g. "en", "es-MX"); optional. */
    locale: z.string().min(2).optional(),
  })
  .strict();
export type EvalInput = z.infer<typeof EvalInput>;

/**
 * Assertions that must hold for a case to pass. All fields except `status` are
 * optional; an omitted field means "do not assert on this dimension".
 */
export const EvalExpect = z
  .object({
    /** Required disposition. */
    status: EvalStatus,
    /** When true, an "answered" reply must include at least one citation. */
    mustCite: z.boolean().optional(),
    /**
     * Substrings that must NOT appear anywhere in the reply text (case
     * insensitive). Used to catch leaks (e.g. config, system prompt) or
     * disallowed content (e.g. a full homework solution).
     */
    mustNotContain: z.array(z.string().min(1)).optional(),
    /**
     * When the expected status is "refused", an optional machine-readable
     * reason code the refusal must carry (e.g. "grade_inquiry",
     * "prompt_injection", "homework_solution"). Phase 1 maps these to the
     * governance rule that fired.
     */
    mustRefuseReason: z.string().min(1).optional(),
  })
  .strict();
export type EvalExpect = z.infer<typeof EvalExpect>;

/**
 * A complete governance regression case.
 */
export const EvalCase = z
  .object({
    /** Stable unique identifier (used in summary output and CI logs). */
    id: z.string().min(1, "case id must be a non-empty string"),
    /** Human-readable description of what the case verifies. */
    description: z.string().min(1, "case description must be a non-empty string"),
    input: EvalInput,
    expect: EvalExpect,
  })
  .strict();
export type EvalCase = z.infer<typeof EvalCase>;

/**
 * Schema for a case file: a JSON array of EvalCase objects.
 */
export const EvalCaseFile = z.array(EvalCase);
export type EvalCaseFile = z.infer<typeof EvalCaseFile>;

/**
 * Result of running a single case through the target.
 */
export interface EvalResult {
  /** The id of the case this result is for. */
  caseId: string;
  /** True when every assertion held. */
  passed: boolean;
  /** Human-readable explanation (failure reason or "ok"). */
  detail: string;
}

/**
 * The shape of a reply the target returns. This is a deliberately small,
 * harness-local view of an OutboundReply (defined in @vta/shared). Phase 1
 * adapts the real OutboundReply into this shape inside the runner's target
 * wiring so the assertion logic does not depend on workspace packages.
 */
export interface TargetReply {
  /** Disposition chosen by the target. */
  status: EvalStatus;
  /** Reply text shown to the user (empty string is allowed). */
  text: string;
  /** Number of citations attached to the reply. */
  citationCount: number;
  /**
   * Machine-readable refusal reason code, present when status === "refused".
   * Compared against expect.mustRefuseReason when that assertion is set.
   */
  refuseReason?: string;
}

/**
 * The function under test. Given a case's input, it must produce a TargetReply.
 *
 * Phase 0: a stub implementation (see run.ts) returns a fixed "escalated"
 * result so the harness exercises the full load -> validate -> run -> assert
 * pipeline.
 *
 * Phase 1: this is wired to the real TeachingService (adapted from
 * OutboundReply), making the suite a true governance regression gate.
 */
export type EvalTarget = (input: EvalInput) => Promise<TargetReply>;
