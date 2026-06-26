import { and, eq } from "drizzle-orm";
import type { CourseId } from "@vta/shared";
import type { Db } from "../client.js";
import { materials, chunks } from "../schema/materials.js";
import type {
  MaterialRow,
  NewMaterialRow,
  NewChunkRow,
} from "../schema/materials.js";
import { guardCourse } from "./guard.js";

/**
 * Input shape for replacing a material's chunks. The caller supplies the chunk
 * bodies; `courseId` and `materialId` are filled in by the repository so they
 * cannot drift from the scoped values.
 */
export type ChunkInput = Omit<NewChunkRow, "courseId" | "materialId">;

/**
 * Course-scoped access to materials and their chunks. Every method takes an
 * explicit `courseId` and refuses to touch rows belonging to another course.
 */
export class MaterialRepository {
  constructor(private readonly db: Db) {}

  /**
   * Insert or update a material, scoped to `courseId`. Conflict key is
   * (courseId, sourceType, externalId) when an `externalId` is present; for
   * uploads without an external id we always insert a new row.
   *
   * The `courseId` carried in `input` must equal the explicit `courseId`.
   */
  async upsertMaterial(
    courseId: CourseId,
    input: NewMaterialRow,
  ): Promise<MaterialRow> {
    guardCourse(courseId, input.courseId);

    const values: NewMaterialRow = { ...input, courseId };

    // Idempotent on (course_id, source_type, external_id) — see the unique index
    // in schema/materials.ts. Re-syncing the same source reuses the SAME row id,
    // so its chunks (keyed by material_id) are never orphaned and rows do not
    // accumulate across syncs.
    const rows = await this.db
      .insert(materials)
      .values(values)
      .onConflictDoUpdate({
        target: [materials.courseId, materials.sourceType, materials.externalId],
        set: {
          title: values.title,
          kind: values.kind,
          contentHash: values.contentHash,
          uri: values.uri ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    const row = rows[0];
    if (row === undefined) {
      throw new Error("MaterialRepository.upsertMaterial: expected a returned row");
    }
    return row;
  }

  /** Fetch a material by id, scoped to a course. Returns `undefined` if absent. */
  async getById(
    courseId: CourseId,
    materialId: string,
  ): Promise<MaterialRow | undefined> {
    const rows = await this.db
      .select()
      .from(materials)
      .where(and(eq(materials.id, materialId), eq(materials.courseId, courseId)))
      .limit(1);
    return rows[0];
  }

  /**
   * Fetch the single material for a source key, scoped to a course. With the
   * unique index on (course_id, source_type, external_id) there is at most one.
   * Used by ingestion to detect change (compare stored contentHash) and to reuse
   * the stable row id across re-syncs.
   */
  async findByExternalKey(
    courseId: CourseId,
    sourceType: string,
    externalId: string,
  ): Promise<MaterialRow | undefined> {
    const rows = await this.db
      .select()
      .from(materials)
      .where(
        and(
          eq(materials.courseId, courseId),
          eq(materials.sourceType, sourceType),
          eq(materials.externalId, externalId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Atomically replace ALL chunks of a material with a new set. Verifies the
   * material belongs to `courseId` before deleting, and stamps every new chunk
   * with the scoped `courseId`/`materialId`. Runs in a single transaction.
   */
  async replaceChunks(
    courseId: CourseId,
    materialId: string,
    newChunks: readonly ChunkInput[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Confirm the material exists AND belongs to this course before mutating.
      const owner = await tx
        .select({ courseId: materials.courseId })
        .from(materials)
        .where(eq(materials.id, materialId))
        .limit(1);
      const ownerRow = owner[0];
      if (ownerRow !== undefined) {
        guardCourse(courseId, ownerRow.courseId);
      }
      // If the material does not exist we still scope the delete by courseId,
      // so this is a no-op rather than a cross-tenant action.

      await tx
        .delete(chunks)
        .where(
          and(eq(chunks.materialId, materialId), eq(chunks.courseId, courseId)),
        );

      if (newChunks.length === 0) return;

      const rows: NewChunkRow[] = newChunks.map((c) => ({
        ...c,
        courseId,
        materialId,
      }));
      await tx.insert(chunks).values(rows);
    });
  }
}
