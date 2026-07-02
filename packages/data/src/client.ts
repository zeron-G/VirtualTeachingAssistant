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

/** Options for {@link createDb}. All fields are optional resilience tunables. */
export interface CreateDbOptions {
  /** Max pooled connections (default {@link POOL_MAX}). */
  readonly maxConnections?: number;
  /**
   * Server-side per-statement timeout in ms (default {@link STATEMENT_TIMEOUT_MS}).
   * Pass `0` to DISABLE — appropriate for the trusted, unattended ingestion path,
   * whose bulk vector inserts on a small DB instance can legitimately run long.
   * The interactive answer path keeps the default so a runaway query can't wedge
   * a worker.
   */
  readonly statementTimeoutMs?: number;
  /**
   * Client-side per-query timeout in ms (default {@link QUERY_TIMEOUT_MS}). Pass
   * `0` to DISABLE (see {@link statementTimeoutMs}).
   */
  readonly queryTimeoutMs?: number;
  /**
   * Called when the pool emits an `error` on an IDLE client — a backend
   * connection dropped out-of-band (server restart, network blip). Attaching a
   * listener is REQUIRED for safety: without one, Node treats the pool's
   * `error` event as unhandled and CRASHES the process. Defaults to a
   * console.error; the app passes a logger-backed handler.
   */
  readonly onPoolError?: (err: Error) => void;
}

/** Bounded pool size — prevents unbounded connection growth under load. */
const POOL_MAX = 10;
/** Fail fast if a connection can't be acquired from the pool (ms). */
const CONNECTION_TIMEOUT_MS = 10_000;
/** Reap a pooled connection after this long idle (ms). */
const IDLE_TIMEOUT_MS = 30_000;
/** Server-side: cancel any single query running longer than this (ms). Default for the answer path. */
const STATEMENT_TIMEOUT_MS = 30_000;
/** Client-side: stop waiting on a query after this long (ms). Default for the answer path. */
const QUERY_TIMEOUT_MS = 30_000;

/**
 * Maps a Drizzle `Db` handle back to its underlying pool so {@link closeDb} can
 * drain it at shutdown. A `WeakMap` keyed on the handle avoids leaking pools and
 * avoids depending on Drizzle internals to recover the pool.
 */
const poolByDb = new WeakMap<object, pg.Pool>();

/**
 * Create a Drizzle database handle backed by a hardened node-postgres pool.
 *
 * Each call creates its OWN pool, so callers are responsible for the pool's
 * lifetime — call {@link closeDb} at shutdown. In practice the app composes one
 * `Db` at startup, shares it, and closes it once. The pool is configured with
 * connection/idle/statement/query timeouts, a bounded size, and a mandatory
 * `error` listener so a dropped backend connection degrades gracefully instead
 * of crashing the process.
 *
 * @param connectionString a Postgres `DATABASE_URL`.
 * @param options optional resilience tunables.
 */
export function createDb(connectionString: string, options: CreateDbOptions = {}): Db {
  if (!connectionString) {
    throw new ConfigError("createDb requires a non-empty connection string");
  }
  // `?? default` (not `|| default`) so an explicit 0 disables the timeout.
  const statementTimeout = options.statementTimeoutMs ?? STATEMENT_TIMEOUT_MS;
  const queryTimeout = options.queryTimeoutMs ?? QUERY_TIMEOUT_MS;
  const pool = new Pool({
    connectionString,
    max: options.maxConnections ?? POOL_MAX,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    // pg treats statement_timeout=0 as "no limit"; query_timeout is only armed
    // when truthy — so 0 disables both, as the ingestion path requests.
    statement_timeout: statementTimeout,
    query_timeout: queryTimeout,
    keepAlive: true,
  });
  // MANDATORY: a pooled backend connection can drop at any time. node-postgres
  // emits `error` on the idle client; with no listener Node treats it as an
  // unhandled `error` event and terminates the process. Swallow-and-log so the
  // pool can transparently replace the dead connection.
  pool.on("error", (err) => {
    if (options.onPoolError !== undefined) options.onPoolError(err);
    else console.error("[data] idle postgres client error (pool will recover):", err.message);
  });
  const database = drizzle(pool, { schema });
  poolByDb.set(database as object, pool);
  return database;
}

/**
 * Gracefully close the connection pool backing `db`: in-flight queries finish,
 * then every socket is closed. Idempotent and safe to call once at shutdown; a
 * no-op if `db` was not produced by {@link createDb} (e.g. an injected test
 * double), so callers never need to special-case that.
 */
export async function closeDb(db: Db): Promise<void> {
  const pool = poolByDb.get(db as object);
  if (pool === undefined) return;
  poolByDb.delete(db as object);
  await pool.end();
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
