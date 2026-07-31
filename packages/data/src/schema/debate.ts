import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";
import { courses } from "./courses.js";

/**
 * Classroom debate module — see `docs/DESIGN-CLASSROOM-DEBATE.md`.
 *
 * ATTRIBUTION MODEL (load-bearing): speech is attributed by DEVICE IDENTITY +
 * FLOOR CONTROL, never by a voiceprint. Exactly one participant holds the floor
 * at a time (`debate_sessions.floor_participant_id`); only that participant's
 * phone opens a microphone, and the resulting clip is theirs by construction.
 * No biometric data is collected or stored anywhere in this schema.
 *
 * Participants are session-scoped and are deliberately NOT rows in `users`
 * (which requires a Discord id). A pilot roster is 20-60 people who type their
 * own name; identity here is "good enough for a classroom game", not an
 * authentication claim.
 */

/** Two-team red (proposition) vs blue (opposition) format, plus non-debating roles. */
export const DEBATE_TEAMS = ["red", "blue", "observer"] as const;
export type DebateTeam = (typeof DEBATE_TEAMS)[number];

/** Lifecycle of one classroom activity. */
export const DEBATE_STATUSES = ["lobby", "live", "judging", "ended"] as const;
export type DebateStatus = (typeof DEBATE_STATUSES)[number];

/** One classroom debate activity, owned by a course. */
export const debateSessions = pgTable(
  "debate_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    /** Email of the professor who created it (from the dashboard session). */
    createdBy: text("created_by").notNull(),
    /** The debate motion / topic shown to students. */
    topic: text("topic").notNull(),
    status: text("status").notNull().default("lobby"),
    /** Free-form phase label driven by the professor console, e.g. 'Opening — Red'. */
    phase: text("phase").notNull().default("Lobby"),
    /** Monotonic counter — optimistic concurrency for phase transitions. */
    phaseSeq: integer("phase_seq").notNull().default(0),
    /** Optional countdown for the current phase. */
    phaseEndsAt: timestamp("phase_ends_at", { withTimezone: true }),
    /** Who currently holds the microphone. Null = nobody may record. */
    floorParticipantId: uuid("floor_participant_id"),
    /** Short human-typable join code (Crockford base32, no I/L/O/U). */
    joinCode: text("join_code").notNull().unique(),
    /**
     * When true, joining requires a fresh signed ticket from the ROTATING QR —
     * i.e. the join code alone is not enough. This is what gives the QR
     * check-in semantics ("you had to be in the room when it was displayed").
     * The professor can turn it off to let a latecomer in by code.
     */
    requireTicket: boolean("require_ticket").notNull().default(true),
    /**
     * DEFAULT ON: any consented participant may open their own microphone
     * whenever they want. The professor can switch it off to run a strict
     * turn-taking debate, in which case only `floorParticipantId` may record.
     */
    openFloor: boolean("open_floor").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => ({
    courseIdx: index("debate_sessions_course_idx").on(t.courseId),
  }),
);

/** A student who joined one session by typing their name and picking a team. */
export const debateParticipants = pgTable(
  "debate_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => debateSessions.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    team: text("team").notNull().default("observer"),
    /** Random id minted into the participant cookie so a refresh resumes the seat. */
    deviceId: text("device_id").notNull(),
    /** Set when the student accepted the recording notice. Null = never record them. */
    consentAt: timestamp("consent_at", { withTimezone: true }),
    /** Set when the student asks to speak; cleared when the floor is granted or they lower it. */
    handRaisedAt: timestamp("hand_raised_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: index("debate_participants_session_idx").on(t.sessionId),
    // One seat per device per session — makes the resume path atomic and stops
    // a refresh/rejoin from creating duplicate people in the roster.
    deviceUnique: uniqueIndex("debate_participants_session_device_uq").on(
      t.sessionId,
      t.deviceId,
    ),
  }),
);

/** One finalized spoken turn: audio was transcribed and attributed to its speaker. */
export const debateTurns = pgTable(
  "debate_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => debateSessions.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id"),
    /** Denormalized so the transcript survives a participant row being removed. */
    speakerName: text("speaker_name").notNull(),
    team: text("team").notNull(),
    phase: text("phase").notNull(),
    text: text("text").notNull(),
    /** Audio duration in seconds, as reported by the STT provider. */
    durationSec: integer("duration_sec"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: index("debate_turns_session_idx").on(t.sessionId, t.createdAt),
  }),
);

/**
 * An AI judge verdict. ADVISORY ONLY: rows land with `isFinal = false` and a
 * professor must confirm them. Nothing here writes a grade.
 */
export const debateJudgements = pgTable(
  "debate_judgements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => debateSessions.id, { onDelete: "cascade" }),
    /** Rubric scores + per-team totals, shape owned by the judge prompt. */
    scores: jsonb("scores").notNull().default({}),
    rationale: text("rationale").notNull(),
    model: text("model").notNull(),
    isFinal: boolean("is_final").notNull().default(false),
    confirmedBy: text("confirmed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: index("debate_judgements_session_idx").on(t.sessionId),
  }),
);

export type DebateSessionRow = typeof debateSessions.$inferSelect;
export type NewDebateSessionRow = typeof debateSessions.$inferInsert;
export type DebateParticipantRow = typeof debateParticipants.$inferSelect;
export type NewDebateParticipantRow = typeof debateParticipants.$inferInsert;
export type DebateTurnRow = typeof debateTurns.$inferSelect;
export type NewDebateTurnRow = typeof debateTurns.$inferInsert;
export type DebateJudgementRow = typeof debateJudgements.$inferSelect;
export type NewDebateJudgementRow = typeof debateJudgements.$inferInsert;
