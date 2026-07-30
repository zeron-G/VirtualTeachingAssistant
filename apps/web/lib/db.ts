/**
 * Process-wide database handle for the web app.
 *
 * `createDb` opens a NEW pool on every call, and Next.js dev HMR re-evaluates
 * modules on each edit — so the handle is cached on `globalThis` to avoid
 * leaking one pool per reload. The pool is also deliberately SMALL: the
 * production Postgres is a Burstable B1ms with ~35 total connections, shared
 * with the Discord worker.
 */

import { createDb, DebateRepository } from '@vta/data';
import type { Db } from '@vta/data';

const globalForDb = globalThis as unknown as { __vtaWebDb?: Db };

export function getDb(): Db {
  if (globalForDb.__vtaWebDb === undefined) {
    const url = process.env.DATABASE_URL;
    if (url === undefined || url === '') {
      throw new Error('DATABASE_URL is not set — the debate module needs a database.');
    }
    globalForDb.__vtaWebDb = createDb(url, {
      maxConnections: 5,
      onPoolError: (err) => {
        // eslint-disable-next-line no-console
        console.error('[web] postgres pool error (pool will recover):', err.message);
      },
    });
  }
  return globalForDb.__vtaWebDb;
}

export function debateRepo(): DebateRepository {
  return new DebateRepository(getDb());
}
