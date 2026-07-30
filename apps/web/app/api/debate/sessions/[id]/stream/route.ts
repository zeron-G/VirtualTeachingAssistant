import type { NextRequest } from 'next/server';

import { debateRepo } from '@/lib/db';
import { subscribe } from '@/lib/hub';
import { sharedSnapshot } from '@/lib/snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/debate/sessions/:id/stream — Server-Sent Events.
 *
 * SSE (not WebSocket) because the traffic is ~99% server→client, it works
 * through Container Apps ingress with no extra infrastructure, and the browser
 * reconnects on its own. Each event carries a FULL snapshot, so a reconnect
 * needs no replay log — the next snapshot is the whole truth.
 *
 * Readable by anyone with the session id: the transcript is on the classroom
 * projector anyway. All WRITE paths are authenticated.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  // Resolve BEFORE opening a stream: an unknown/garbage id must 404 rather than
  // pin an open socket, a timer and a subscription on the single replica.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response('Not found', { status: 404 });
  }
  const exists = await debateRepo().getSession(id);
  if (exists === undefined) {
    return new Response('Not found', { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let cleanup = (): void => {
    closed = true;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Registered FIRST and idempotent: a client that disconnects during the
      // very first snapshot query must not leak the subscription or the timer.
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        unsubscribe = undefined;
        if (keepalive !== undefined) clearInterval(keepalive);
        keepalive = undefined;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener('abort', cleanup);

      const send = (event: string, payload: unknown): boolean => {
        if (closed) return false;
        try {
          // Backpressure: if the socket isn't draining, skip this frame — the
          // next full snapshot supersedes it (that's the point of snapshots).
          if (controller.desiredSize !== null && controller.desiredSize <= 0) return false;
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
          );
          return true;
        } catch {
          cleanup();
          return false;
        }
      };

      // Real coalescer WITH a trailing edge: a publish that lands while a query
      // is in flight sets `again`, and the loop re-reads once it completes.
      // (The previous boolean guard silently DROPPED those events, leaving
      // clients permanently stale with nothing to recover them.)
      let running = false;
      let again = false;
      const push = async (): Promise<void> => {
        if (closed) return;
        if (running) {
          again = true;
          return;
        }
        running = true;
        try {
          do {
            again = false;
            const snapshot = await sharedSnapshot(id);
            if (closed) return;
            if (snapshot === undefined) {
              send('gone', { error: 'session not found' });
              cleanup();
              return;
            }
            send('snapshot', snapshot);
          } while (again && !closed);
        } catch {
          // Transient DB hiccup — retry on the next publish or keepalive.
          again = false;
        } finally {
          running = false;
        }
      };

      // Subscribe BEFORE the first read so nothing committed during that query
      // is missed (it just queues a trailing re-read).
      unsubscribe = subscribe(id, () => {
        void push();
      });
      void push();

      // Comment frames stop proxies idling the connection out.
      keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          cleanup();
        }
      }, 20_000);

      if (req.signal.aborted) cleanup();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
