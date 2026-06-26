import { and, eq } from "drizzle-orm";
import { DEFAULT_COURSE_ROLE, COURSE_ROLES } from "@vta/shared";
import type { CourseId, CourseRole, UserId } from "@vta/shared";
import type { Db } from "../client.js";
import { courseMemberships } from "../schema/memberships.js";

/** Narrow an arbitrary stored string to a known `CourseRole`. */
function asCourseRole(value: string): CourseRole {
  return (COURSE_ROLES as readonly string[]).includes(value)
    ? (value as CourseRole)
    : DEFAULT_COURSE_ROLE;
}

/**
 * Membership/role resolution, always scoped to a single (course, user) pair.
 * Roles are per-course: the same user may hold different roles in different
 * courses, so every method requires an explicit `courseId`.
 */
export class MembershipRepository {
  constructor(private readonly db: Db) {}

  /**
   * Resolve the user's role within a course. Defaults to `'standard'` when no
   * membership row exists (an unknown user is treated as a baseline student).
   */
  async resolveRole(courseId: CourseId, userId: UserId): Promise<CourseRole> {
    const rows = await this.db
      .select({ role: courseMemberships.role })
      .from(courseMemberships)
      .where(
        and(
          eq(courseMemberships.courseId, courseId),
          eq(courseMemberships.userId, userId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? DEFAULT_COURSE_ROLE : asCourseRole(row.role);
  }

  /**
   * Set (insert or update) a user's role within a course. Idempotent on the
   * (courseId, userId) composite key.
   */
  async setRole(
    courseId: CourseId,
    userId: UserId,
    role: CourseRole,
  ): Promise<void> {
    await this.db
      .insert(courseMemberships)
      .values({ courseId, userId, role })
      .onConflictDoUpdate({
        target: [courseMemberships.courseId, courseMemberships.userId],
        set: { role },
      });
  }
}
