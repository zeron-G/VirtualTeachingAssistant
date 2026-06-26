import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { ConfigError } from "@vta/shared";
import * as schema from "./schema/index.js";

const { Pool } = pg;

/**
 * The concrete database handle type used throughout the data layer. It carries
 * the full schema so every repository gets typed `db.query.*` and table access.
 */
export type Db = NodePgDatabase<typeof schema>;

/**
 * Create a Drizzle database handle backed by a node-postgres connection pool.
 *
 * Each call creates its OWN pool, so callers are responsible for the pool's
 * lifetime. In practice the app composes one `Db` at startup and shares it.
 *
 * @param connectionString a Postgres `DATABASE_URL`.
 */
export function createDb(connectionString: string): Db {
  if (!connectionString) {
    throw new ConfigError("createDb requires a non-empty connection string");
  }
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}

/**
 * Lazily-constructed default handle built from `process.env.DATABASE_URL`.
 *
 * The pool is only created on first access, so importing this module has no
 * side effects and does not require DATABASE_URL to be set (e.g. during tests
 * that inject their own `Db` via `createDb`). Accessing `db` without
 * DATABASE_URL throws a `ConfigError`.
 */
let _defaultDb: Db | undefined;

export function getDefaultDb(): Db {
  if (_defaultDb === undefined) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new ConfigError(
        "DATABASE_URL is not set; cannot build the default Db. Use createDb(url) instead.",
      );
    }
    _defaultDb = createDb(url);
  }
  return _defaultDb;
}

/**
 * Convenience proxy that resolves to the lazy default `Db` on first property
 * access. Lets callers `import { db } from "@vta/data"` and use it directly,
 * while still deferring pool creation until actually used.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const real = getDefaultDb();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
}) as Db;
