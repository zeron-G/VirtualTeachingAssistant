import { pgTable, uuid, text, primaryKey } from "drizzle-orm/pg-core";
import { courses } from "./courses.js";
import { users } from "./users.js";

/**
 * `course_memberships` — resolves a (user, course) pair to a `CourseRole`.
 *
 * Roles are intentionally per-(user, course): the same person can be a TA
 * ("privileged") in one course and a student ("standard") in another. The
 * composite primary key (courseId, userId) enforces one row per pair.
 *
 * The `role` column stores a `CourseRole` value ('admin' | 'privileged' |
 * 'standard') from `@vta/shared`. It is kept as plain text rather than a PG
 * enum so the role vocabulary can evolve without a schema migration; the
 * repository layer is responsible for validating/normalizing values.
 */
export const courseMemberships = pgTable(
  "course_memberships",
  {
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** A `CourseRole`: 'admin' | 'privileged' | 'standard'. Defaults to standard. */
    role: text("role").notNull().default("standard"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.courseId, table.userId] }),
  }),
);

export type CourseMembershipRow = typeof courseMemberships.$inferSelect;
export type NewCourseMembershipRow = typeof courseMemberships.$inferInsert;
