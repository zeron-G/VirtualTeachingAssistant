import { sql } from "drizzle-orm";
import type { CourseId } from "@vta/shared";
import type { Db } from "../client.js";
import { EMBEDDING_DIMENSIONS } from "../schema/materials.js";

/** A single vector-search hit, scoped to the queried course. */
export interface ChunkSearchHit {
  readonly id: string;
  readonly materialId: string;
  readonly ord: number;
  readonly content: string;
  /** Cosine distance (`<=>`): 0 == identical, larger == less similar. */
  readonly distance: number;
}

/**
 * Read-side access to chunks: course-scoped semantic retrieval over pgvector.
 *
 * Tenant isolation is enforced in SQL via the `course_id = ${courseId}`
 * predicate. The vector predicate alone is NOT a tenant boundary, so the
 * `WHERE course_id` clause must never be removed.
 */
export class ChunkRepository {
  constructor(private readonly db: Db) {}

  /**
   * k-NN retrieval of the most similar chunks within ONE course.
   *
   * Uses pgvector's cosine-distance operator `<=>` and orders ascending so the
   * closest chunks come first. The query embedding is bound as a typed
   * `vector` literal.
   *
   * TODO(verify-at-install): the exact drizzle-orm 0.38.x ergonomics for
   * binding a `vector` parameter / interpolating an array into a `::vector`
   * cast are not 100% pinned. This implementation formats the array into the
   * pgvector text form (`[a,b,c]`) and casts it, which is portable across
   * drizzle versions. Revisit once the version is installed; drizzle may offer
   * a first-class `cosineDistance()` helper that is cleaner.
   *
   * @param courseId        tenant scope — REQUIRED.
   * @param queryEmbedding  the query vector; length must equal EMBEDDING_DIMENSIONS.
   * @param k               max number of hits to return.
   */
  async searchByEmbedding(
    courseId: CourseId,
    queryEmbedding: number[],
    k: number,
  ): Promise<ChunkSearchHit[]> {
    if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `searchByEmbedding: expected ${EMBEDDING_DIMENSIONS}-dim embedding, got ${queryEmbedding.length}`,
      );
    }
    const limit = Math.max(1, Math.trunc(k));

    // pgvector accepts a vector literal of the form "[1,2,3]". We build that
    // text form and cast it to `vector` in SQL. This avoids depending on a
    // specific drizzle vector-binding API.
    const vectorLiteral = `[${queryEmbedding.join(",")}]`;

    const result = await this.db.execute<{
      id: string;
      material_id: string;
      ord: number;
      content: string;
      distance: number;
    }>(sql`
      SELECT
        id,
        material_id,
        ord,
        content,
        embedding <=> ${vectorLiteral}::vector AS distance
      FROM chunks
      WHERE course_id = ${courseId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorLiteral}::vector ASC
      LIMIT ${limit}
    `);

    // drizzle's node-postgres `execute` returns a pg `QueryResult`; rows live
    // on `.rows`. Guard the shape defensively for forward-compat.
    const rows = (result as { rows?: unknown }).rows;
    const list = Array.isArray(rows)
      ? (rows as Array<{
          id: string;
          material_id: string;
          ord: number;
          content: string;
          distance: number | string;
        }>)
      : [];

    return list.map((r) => ({
      id: r.id,
      materialId: r.material_id,
      ord: Number(r.ord),
      content: r.content,
      distance: Number(r.distance),
    }));
  }
}
