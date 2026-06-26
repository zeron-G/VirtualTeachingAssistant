import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/**
 * `courses` — the tenant table. A course is the unit of multi-tenancy: every
 * other tenant-scoped table carries a `courseId` foreign key back to here.
 *
 * `orgId` is reserved for a future "college / department" layer that would group
 * courses; it is nullable today and unused by Phase-0/Phase-1 logic.
 */
export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** Canvas LMS course identifier this VTA course mirrors (string form). */
  canvasCourseId: text("canvas_course_id"),
  /** Reserved for a future college/department grouping layer. Nullable today. */
  orgId: uuid("org_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CourseRow = typeof courses.$inferSelect;
export type NewCourseRow = typeof courses.$inferInsert;
