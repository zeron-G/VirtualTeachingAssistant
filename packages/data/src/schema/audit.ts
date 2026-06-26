import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { courses } from "./courses.js";

/**
 * Governance verdicts attached to an audited interaction. Phase-1 populates this
 * with the decisions made by the policy/guard layers (allow/deny, grounding
 * result, refusal reason, etc.). Kept loose here; tightened in Phase-1.
 */
export interface AuditVerdicts {
  // TODO(phase-1): define the concrete governance decision record shape.
  readonly [key: string]: unknown;
}

/**
 * `audit_log` — the FERPA §99.32-style disclosure record. One row per handled
 * request, written regardless of outcome.
 *
 * IMPORTANT: `question` and `answer` MUST be stored REDACTED of PII by the
 * writer (the repository does not redact for you — it persists what it is
 * given). This log is the system of record for "who asked what, what was
 * disclosed, and why" and must be append-only in practice.
 */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  /** Acting user, if known. Null for system-originated entries. */
  userId: uuid("user_id"),
  /** Channel kind the request arrived on, e.g. 'discord'. */
  channel: text("channel").notNull(),
  /** Correlates this entry with logs/traces for the same request. */
  requestId: text("request_id").notNull(),
  /** REDACTED question text. */
  question: text("question").notNull(),
  /** REDACTED answer text. */
  answer: text("answer").notNull(),
  /** Final `ReplyStatus` for the interaction. */
  status: text("status").notNull(),
  /** Structured governance decisions. */
  verdicts: jsonb("verdicts").$type<AuditVerdicts>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
