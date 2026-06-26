/**
 * `@vta/rag` — owns retrieval quality end-to-end for the Virtual Teaching
 * Assistant.
 *
 * Two responsibilities:
 *   - INGESTION (`RagIngestor`): pull course materials from Canvas (or accept a
 *     professor upload), normalize → chunk → embed → store as course-scoped
 *     `chunks`, re-embedding only what changed. Quiz questions and enrollments
 *     are never ingested.
 *   - RETRIEVAL (`RagRetriever`): hybrid dense+sparse search fused with
 *     Reciprocal Rank Fusion, always scoped to a single course, returning
 *     grounded chunks plus deduped citations.
 *
 * This package does NOT depend on `@vta/llm`. The caller injects an
 * `EmbeddingProvider`; the LLM router is structurally compatible.
 */

// Types.
export type {
  EmbeddingProvider,
  RetrievedChunk,
  RetrievalResult,
  IngestStats,
} from './types.js';

// Chunking.
export { chunkMarkdown, approximateTokenCount } from './chunking.js';
export type { Chunk, ChunkOptions } from './chunking.js';

// Ingestion.
export { RagIngestor } from './ingest.js';
export type { RagIngestorDeps } from './ingest.js';

// Retrieval.
export { RagRetriever } from './retrieve.js';
export type { RagRetrieverDeps, RetrieveOptions } from './retrieve.js';
