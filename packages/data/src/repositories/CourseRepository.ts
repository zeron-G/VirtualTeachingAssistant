import { eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { courses } from "../schema/courses.js";
import type { CourseRow, NewCourseRow } from "../schema/courses.js";

/**
 * Repository for the tenant table itself. Unlike the other repositories, course
 * lookups are not course-scoped (this IS the course registry); however nothing
 * here ever returns rows from more than one course in a single record.
 */
export class CourseRepository {
  constructor(private readonly db: Db) {}

  /** Resolve a course by its unique slug, or `undefined` if none. */
  async getBySlug(slug: string): Promise<CourseRow | undefined> {
    const rows = await this.db
      .select()
      .from(courses)
      .where(eq(courses.slug, slug))
      .limit(1);
    return rows[0];
  }

  /** Resolve a course by id, or `undefined` if none. */
  async getById(id: string): Promise<CourseRow | undefined> {
    const rows = await this.db
      .select()
      .from(courses)
      .where(eq(courses.id, id))
      .limit(1);
    return rows[0];
  }

  /** List all courses, ordered by slug for stable output. */
  async list(): Promise<CourseRow[]> {
    return this.db.select().from(courses).orderBy(courses.slug);
  }

  /**
   * Insert a course, or update its mutable fields when the slug already exists.
   * Returns the resulting row. `slug` is the natural conflict key.
   */
  async upsert(input: NewCourseRow): Promise<CourseRow> {
    const rows = await this.db
      .insert(courses)
      .values(input)
      .onConflictDoUpdate({
        target: courses.slug,
        set: {
          name: input.name,
          canvasCourseId: input.canvasCourseId,
          orgId: input.orgId,
          updatedAt: new Date(),
        },
      })
      .returning();
    // `returning()` on a single-row upsert always yields exactly one row.
    const row = rows[0];
    if (row === undefined) {
      throw new Error("CourseRepository.upsert: expected a returned row");
    }
    return row;
  }
}
