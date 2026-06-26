/**
 * `@vta/data` — the multi-tenant database layer (Drizzle ORM + Postgres +
 * pgvector). A COURSE is the tenant unit: every tenant table carries a
 * `courseId`, and every repository method is course-scoped. Queries that would
 * cross courses throw `TenantMismatchError` from `@vta/shared`.
 *
 * Public surface:
 *   - client:       `createDb`, `getDefaultDb`, `db`, and the `Db` type.
 *   - schema:       all table definitions + their inferred row types.
 *   - repositories: course-scoped repositories + the `guardCourse` helper.
 */

// Client / connection.
export { createDb, getDefaultDb, db } from "./client.js";
export type { Db } from "./client.js";

// Schema (tables + row types).
export * from "./schema/index.js";

// Repositories.
export * from "./repositories/index.js";
