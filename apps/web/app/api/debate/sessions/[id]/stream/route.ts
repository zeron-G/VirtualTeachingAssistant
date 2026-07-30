import type { NextRequest } from 'next/server';

import { debateRepo } from '@/lib/db';
import { subscribe } from '@/lib/hub';

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
 * Readable by anyone with the session id: the transcript is shown to the whole
 * classroom on the projector anyway. Write paths are all authenticated.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const repo = debateRepo();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, payload: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          /* client went away between checks */
        }
      };

      // Coalesce bursts (e.g. a turn insert + a floor change) into one push.
      let pending = false;
      const pushSnapshot = async (): Promise<void> => {
        if (closed || pending) return;
        pending = true;
        try {
          const snapshot = await repo.snapshot(id);
          if (snapshot === undefined) {
            send('gone', { error: 'session not found' });
            return;
          }
          send('snapshot', snapshot);
        } catch {
          /* transient DB hiccup — the next event or keepalive retries */
        } finally {
          pending = false;
        }
      };

      await pushSnapshot();
      unsubscribe = subscribe(id, () => {
        void pushSnapshot();
      });

      // Comment frames keep proxies from idling the connection out.
      keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          /* ignore */
        }
      }, 20_000);

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (keepalive !== undefined) clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (keepalive !== undefined) clearInterval(keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Defensive: stop any intermediary from buffering the stream.
      'X-Accel-Buffering': 'no',
    },
  });
}
