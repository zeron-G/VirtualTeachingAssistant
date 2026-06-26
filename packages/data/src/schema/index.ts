/**
 * Schema barrel. drizzle-kit's `schema` points here, and `createDb` passes the
 * full namespace to `drizzle(pool, { schema })`. Re-export every table (and its
 * row types) so the generator and the query builder see all of them.
 */

export * from "./courses.js";
export * from "./users.js";
export * from "./memberships.js";
export * from "./courseConfig.js";
export * from "./materials.js";
export * from "./audit.js";
