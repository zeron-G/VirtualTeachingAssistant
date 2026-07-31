/**
 * In-process fan-out hub for debate SSE streams.
 *
 * Postgres is the source of truth; this hub only tells connected clients
 * "something changed, re-read the snapshot". That keeps the wire format trivial
 * and makes reconnect free (a fresh connect just fetches the snapshot again).
 *
 * Correct ONLY because the web Container App runs min=max=1 replica. Scaling out
 * requires a shared backplane (Redis pub/sub) — see docs/DESIGN-CLASSROOM-DISCUSSION.md.
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

/* -------------------------------------------------------------------------- */
/* Recently-held floor                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A student's clip is uploaded only AFTER they stop speaking, so a professor who
 * advances the phase in that instant would otherwise get the upload rejected and
 * the entire speech thrown away. We therefore remember who just held the floor
 * for a short grace period and still accept their clip.
 *
 * In-memory and single-replica (same constraint as the hub); losing it on
 * restart degrades to the old behaviour — a 403 — never to mis-attribution,
 * because the key is still the authenticated participant.
 */
const GRACE_MS = 120_000;

const globalForFloor = globalThis as unknown as {
  __vtaRecentFloor?: Map<string, number>;
};

function recent(): Map<string, number> {
  globalForFloor.__vtaRecentFloor ??= new Map();
  return globalForFloor.__vtaRecentFloor;
}

/** Record that `participantId` held the floor in `sessionId` up to now. */
export function noteFloorHeld(sessionId: string, participantId: string): void {
  const map = recent();
  map.set(`${sessionId}:${participantId}`, Date.now() + GRACE_MS);
  // Opportunistic sweep so the map cannot grow without bound.
  if (map.size > 500) {
    const now = Date.now();
    for (const [k, exp] of map) if (exp < now) map.delete(k);
  }
}

/** True if this participant holds, or very recently held, the floor. */
export function heldFloorRecently(sessionId: string, participantId: string): boolean {
  const exp = recent().get(`${sessionId}:${participantId}`);
  return exp !== undefined && exp > Date.now();
}
