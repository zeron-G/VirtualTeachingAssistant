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
 * Classroom discussion module — see `docs/DESIGN-CLASSROOM-DISCUSSION.md`.
 * Tables keep the `debate_` prefix: renaming them on a live pilot buys nothing.
 *
 * ATTRIBUTION MODEL (load-bearing): speech is attributed by DEVICE IDENTITY,
 * never by a voiceprint. A clip is uploaded by the phone that recorded it, and
 * that phone already claimed a named seat, so the clip is that person's by
 * construction. No biometric data is collected or stored anywhere in this
 * schema. See `openFloor` below for who is allowed to open a microphone.
 *
 * Participants are session-scoped and are deliberately NOT rows in `users`
 * (which requires a Discord id). A pilot roster is 20-60 people who type their
 * own name; identity here is "good enough for a classroom activity", not an
 * authentication claim.
 */

/**
 * One group in a discussion. A session has 2-4 of them (for/against, or several
 * perspectives) plus the implicit "observer" bucket for anyone not taking a side.
 */
export interface DiscussionTeam {
  /** Stable id stored on participants and turns. */
  readonly id: string;
  /** What students see, e.g. "For", "Against", "Regulators". */
  readonly label: string;
  /** Hex colour used consistently across the console, room and transcript. */
  readonly color: string;
}

/** Default two-sided setup; the professor can rename these or add up to four. */
export const DEFAULT_TEAMS: DiscussionTeam[] = [
  { id: "red", label: "For", color: "#c0392b" },
  { id: "blue", label: "Against", color: "#1f6feb" },
];

/** Palette used when a session adds a third / fourth group. */
export const TEAM_PALETTE = ["#c0392b", "#1f6feb", "#1a7f37", "#b8860b"] as const;

/** Lifecycle of one classroom activity. */
export const DEBATE_STATUSES = ["lobby", "live", "judging", "ended"] as const;
export type DebateStatus = (typeof DEBATE_STATUSES)[number];

/** One classroom discussion activity, owned by a course. */
export const debateSessions = pgTable(
  "debate_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    /** Email of the professor who created it (from the dashboard session). */
    createdBy: text("created_by").notNull(),
    /** The question / motion under discussion, shown to students. */
    topic: text("topic").notNull(),
    status: text("status").notNull().default("lobby"),
    /** The 2-4 groups taking part. See {@link DiscussionTeam}. */
    teams: jsonb("teams").$type<DiscussionTeam[]>().notNull().default(DEFAULT_TEAMS),
    /**
     * Optional free-text label the professor can set (e.g. "Round 2"). Purely a
     * tag stamped onto turns — it enforces nothing. There is no fixed running
     * order: this is a discussion, not a formal debate format.
     */
    phase: text("phase").notNull().default("Discussion"),
    /** Monotonic counter — optimistic concurrency on session updates. */
    phaseSeq: integer("phase_seq").notNull().default(0),
    /** Optional countdown the professor can set. Unused by default. */
    phaseEndsAt: timestamp("phase_ends_at", { withTimezone: true }),
    /** Who was handed the microphone. Only meaningful when `openFloor` is off. */
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
     * turn-taking format, in which case only `floorParticipantId` may record.
     */
    openFloor: boolean("open_floor").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => ({
    courseIdx: index("debate_sessions_course_idx").on(t.courseId),
  }),
);

/** A student who joined one session by typing their name and picking a group. */
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
 * An AI reading of the discussion so far: what each group argued, where they
 * agree, where they genuinely differ, and what nobody has raised. It does NOT
 * rank the groups or declare a winner, and nothing here writes a grade —
 * the professor can run it as many times as they like as the talk develops.
 */
export const debateJudgements = pgTable(
  "debate_judgements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => debateSessions.id, { onDelete: "cascade" }),
    /** The structured insight (per-group points, agreements, gaps, next question). */
    scores: jsonb("scores").notNull().default({}),
    /** Short prose summary the professor can read out. */
    rationale: text("rationale").notNull(),
    model: text("model").notNull(),
    // NOTE: `is_final` / `confirmed_by` still exist in Postgres from the earlier
    // "professor confirms the verdict" design. There is no verdict to confirm
    // now, so they are omitted here rather than dropped — the column defaults
    // keep inserts working, and dropping them buys nothing on a live pilot.
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
