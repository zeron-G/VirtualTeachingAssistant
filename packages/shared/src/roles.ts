/**
 * Role vocabularies shared across the system.
 *
 * There are two unrelated notions of "role":
 *   1. LlmRole   — a *logical* model slot. Business code asks for a role
 *      (e.g. "agent.primary"); the LLM layer resolves it to a concrete
 *      provider + model. No other package may hard-code a model name.
 *   2. CourseRole — a *user's* membership tier WITHIN a single course. Roles
 *      are tenant-scoped: a person can be a TA in one course and a student in
 *      another, so roles are always resolved per (user, course).
 */

/** Logical model slots. The only place concrete models are named is the LLM layer. */
export const LLM_ROLES = [
  'agent.primary',
  'agent.fallback',
  'embed',
  'rerank',
  'guard.judge',
] as const;

export type LlmRole = (typeof LLM_ROLES)[number];

/** A user's membership tier within a course. */
export const COURSE_ROLES = ['admin', 'privileged', 'standard'] as const;

export type CourseRole = (typeof COURSE_ROLES)[number];

/**
 * Human meaning of each course role:
 *   admin      — the course owner / professor
 *   privileged — teaching assistant
 *   standard   — enrolled student (the default)
 */
export const DEFAULT_COURSE_ROLE: CourseRole = 'standard';
