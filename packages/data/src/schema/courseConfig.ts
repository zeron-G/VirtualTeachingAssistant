import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { courses } from "./courses.js";

/**
 * Strongly-typed shapes for the JSONB config blobs. These types describe the
 * INTENT of each column; Phase-1 governance logic will read them. Drizzle stores
 * them as opaque JSONB but `.$type<…>()` gives us compile-time safety on
 * read/write without a migration cost when the shapes evolve.
 *
 * NOTE: these are deliberately permissive (index signatures / optional fields).
 * Phase-1 will tighten them and validate with zod at the edge.
 */

/** Maps a channel-native id (e.g. a Discord channel id) to this course. */
export interface ChannelMap {
  readonly discord?: readonly string[];
  readonly email?: readonly string[];
  readonly web?: readonly string[];
  // TODO(phase-1): formalize per-channel routing options.
}

/** Content/governance rules for the course (allowed topics, refusal policy…). */
export interface ContentRules {
  // TODO(phase-1): define the real governance rule shape here.
  readonly [key: string]: unknown;
}

/** Locale configuration: default + the set the assistant may mirror. */
export interface LocaleConfig {
  readonly default?: string;
  readonly allowed?: readonly string[];
}

/** Per-course rate limiting. Disabled for now (column is nullable). */
export interface RateLimitConfig {
  readonly windowSeconds?: number;
  readonly maxRequests?: number;
}

/**
 * `course_config` — one row per course holding all tunable, course-scoped
 * configuration. PK is also the FK to `courses`, so config is 1:1 with a course.
 */
export const courseConfig = pgTable("course_config", {
  courseId: uuid("course_id")
    .primaryKey()
    .references(() => courses.id, { onDelete: "cascade" }),
  /** Channel ids that route to this course. */
  channelMap: jsonb("channel_map").$type<ChannelMap>().notNull().default({}),
  /** Governance/content rules (Phase-1). */
  contentRules: jsonb("content_rules").$type<ContentRules>().notNull().default({}),
  /** Locale policy. */
  locales: jsonb("locales").$type<LocaleConfig>().notNull().default({}),
  /** Rate limiting — nullable and disabled for now. */
  rateLimit: jsonb("rate_limit").$type<RateLimitConfig>(),
  /** Optional greeting text shown on first interaction. */
  welcomeText: text("welcome_text"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CourseConfigRow = typeof courseConfig.$inferSelect;
export type NewCourseConfigRow = typeof courseConfig.$inferInsert;
