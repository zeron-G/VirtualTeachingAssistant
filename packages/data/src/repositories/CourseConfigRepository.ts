import { eq } from "drizzle-orm";
import type { CourseId } from "@vta/shared";
import type { Db } from "../client.js";
import { courseConfig } from "../schema/courseConfig.js";
import type {
  CourseConfigRow,
  NewCourseConfigRow,
} from "../schema/courseConfig.js";
import { guardCourse } from "./guard.js";

/**
 * Per-course configuration access. Config is 1:1 with a course (PK == FK), so
 * every method is naturally course-scoped by `courseId`.
 */
export class CourseConfigRepository {
  constructor(private readonly db: Db) {}

  /** Fetch a course's config row, or `undefined` if it has none yet. */
  async get(courseId: CourseId): Promise<CourseConfigRow | undefined> {
    const rows = await this.db
      .select()
      .from(courseConfig)
      .where(eq(courseConfig.courseId, courseId))
      .limit(1);
    return rows[0];
  }

  /**
   * Insert or update a course's config. The `courseId` carried in `input` MUST
   * match the explicit `courseId` argument, otherwise a `TenantMismatchError`
   * is thrown — this prevents writing one course's config under another's id.
   */
  async upsert(
    courseId: CourseId,
    input: NewCourseConfigRow,
  ): Promise<CourseConfigRow> {
    guardCourse(courseId, input.courseId);

    const rows = await this.db
      .insert(courseConfig)
      .values({ ...input, courseId })
      .onConflictDoUpdate({
        target: courseConfig.courseId,
        set: {
          channelMap: input.channelMap,
          contentRules: input.contentRules,
          locales: input.locales,
          rateLimit: input.rateLimit,
          welcomeText: input.welcomeText,
          updatedAt: new Date(),
        },
      })
      .returning();

    const row = rows[0];
    if (row === undefined) {
      throw new Error("CourseConfigRepository.upsert: expected a returned row");
    }
    return row;
  }
}
