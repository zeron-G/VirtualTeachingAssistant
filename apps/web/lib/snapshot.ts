import type { DebateSnapshot } from '@vta/data';
import { debateRepo } from './db';

/**
 * Shared, in-flight-deduped snapshot reads.
 *
 * A single `publish()` fans out to every connected client, and each snapshot is
 * 4 queries against a 5-connection pool — with 30 phones that stampedes the
 * pool and queues for seconds. Concurrent readers of the same session therefore
 * share ONE query: the first caller starts it, everyone else awaits the same
 * promise. Cached on globalThis so Next dev HMR doesn't create a second map.
 */
const globalForSnap = globalThis as unknown as {
  __vtaSnapInflight?: Map<string, Promise<DebateSnapshot | undefined>>;
};

function inflight(): Map<string, Promise<DebateSnapshot | undefined>> {
  globalForSnap.__vtaSnapInflight ??= new Map();
  return globalForSnap.__vtaSnapInflight;
}

export function sharedSnapshot(sessionId: string): Promise<DebateSnapshot | undefined> {
  const map = inflight();
  const existing = map.get(sessionId);
  if (existing !== undefined) return existing;

  const p = debateRepo()
    .snapshot(sessionId)
    .finally(() => {
      map.delete(sessionId);
    });
  map.set(sessionId, p);
  return p;
}
