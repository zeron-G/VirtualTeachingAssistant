/**
 * In-process fan-out hub for debate SSE streams.
 *
 * Postgres is the source of truth; this hub only tells connected clients
 * "something changed, re-read the snapshot". That keeps the wire format trivial
 * and makes reconnect free (a fresh connect just fetches the snapshot again).
 *
 * Correct ONLY because the web Container App runs min=max=1 replica. Scaling out
 * requires a shared backplane (Redis pub/sub) — see docs/DESIGN-CLASSROOM-DEBATE.md.
 * Cached on globalThis so Next.js dev HMR doesn't create a second hub.
 */

type Listener = () => void;

const globalForHub = globalThis as unknown as {
  __vtaDebateHub?: Map<string, Set<Listener>>;
};

function hub(): Map<string, Set<Listener>> {
  globalForHub.__vtaDebateHub ??= new Map();
  return globalForHub.__vtaDebateHub;
}

/** Subscribe to change notifications for one session. Returns an unsubscribe fn. */
export function subscribe(sessionId: string, listener: Listener): () => void {
  const map = hub();
  let set = map.get(sessionId);
  if (set === undefined) {
    set = new Set();
    map.set(sessionId, set);
  }
  set.add(listener);
  return () => {
    const s = map.get(sessionId);
    if (s === undefined) return;
    s.delete(listener);
    if (s.size === 0) map.delete(sessionId);
  };
}

/** Notify every client watching this session that state changed. */
export function publish(sessionId: string): void {
  const set = hub().get(sessionId);
  if (set === undefined) return;
  for (const listener of set) {
    try {
      listener();
    } catch {
      /* a dead stream must not break the others */
    }
  }
}
