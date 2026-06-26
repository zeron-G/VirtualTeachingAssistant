import { pgTable, uuid, text, integer, timestamp, vector, uniqueIndex } from "drizzle-orm/pg-core";
import { courses } from "./courses.js";

/**
 * `materials` — a course-scoped source document (a Canvas page/file, or an
 * uploaded file). One material fans out into many `chunks` for retrieval.
 *
 * `contentHash` lets the ingestion pipeline detect unchanged sources and skip
 * re-chunking/re-embedding. `externalId` ties an item back to its Canvas id.
 */
export const materials = pgTable("materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  /** Origin of the material: 'canvas' (synced) | 'upload' (manual). */
  sourceType: text("source_type").notNull(),
  /** Source-system id (e.g. Canvas file/page id). Null for ad-hoc uploads. */
  externalId: text("external_id"),
  title: text("title").notNull(),
  /** Free-form material kind, e.g. 'page' | 'pdf' | 'slides' | 'syllabus'. */
  kind: text("kind").notNull(),
  /** Hash of source content for change detection / idempotent ingestion. */
  contentHash: text("content_hash").notNull(),
  /** Canonical location of the source, if any (URL / storage uri). */
  uri: text("uri"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Idempotent ingestion: at most one material row per (course, source, external
  // id). Lets `upsertMaterial`'s ON CONFLICT reuse the same row across re-syncs,
  // so chunks (keyed by material_id) never orphan and rows never accumulate.
  // Rows with a NULL externalId (ad-hoc uploads) are exempt — Postgres treats
  // NULLs as distinct, so they simply always insert.
  uniqueIndex("materials_course_source_external_uq").on(
    t.courseId,
    t.sourceType,
    t.externalId,
  ),
]);

export type MaterialRow = typeof materials.$inferSelect;
export type NewMaterialRow = typeof materials.$inferInsert;

/**
 * The embedding dimensionality. 1536 matches OpenAI `text-embedding-3-small`
 * and is the contract between the ingestion (embed) side and the query side.
 * Changing it requires re-embedding every chunk + a new pgvector index.
 */
export const EMBEDDING_DIMENSIONS = 1536 as const;

/**
 * `chunks` — a retrievable slice of a material plus its embedding.
 *
 * `courseId` is DENORMALIZED here (it is derivable via `materialId -> material`)
 * specifically so tenant filtering on vector search is a single indexed
 * predicate on this table, with no join. EVERY retrieval query MUST filter by
 * `courseId` to preserve tenant isolation.
 *
 * pgvector notes (handled by infra, NOT by drizzle-kit generate):
 *   - The `vector` extension must exist: `CREATE EXTENSION IF NOT EXISTS vector;`
 *   - An ANN index (HNSW or IVFFlat) on `embedding` must be created in a
 *     follow-up migration, e.g.:
 *       CREATE INDEX chunks_embedding_hnsw
 *         ON chunks USING hnsw (embedding vector_cosine_ops);
 *     plus a btree index on `course_id` (and ideally a composite/partial
 *     strategy) so the tenant filter stays cheap. See `drizzle/` follow-ups.
 */
export const chunks = pgTable("chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** DENORMALIZED tenant key — always filter retrieval by this. */
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  materialId: uuid("material_id")
    .notNull()
    .references(() => materials.id, { onDelete: "cascade" }),
  /** Ordinal position of this chunk within its material. */
  ord: integer("ord").notNull(),
  content: text("content").notNull(),
  /** Token count for budgeting context windows; null if not yet computed. */
  tokenCount: integer("token_count"),
  /** pgvector embedding. Dimensions are fixed by EMBEDDING_DIMENSIONS. */
  embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
});

export type ChunkRow = typeof chunks.$inferSelect;
export type NewChunkRow = typeof chunks.$inferInsert;
