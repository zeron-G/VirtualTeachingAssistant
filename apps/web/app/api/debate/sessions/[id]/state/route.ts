import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { SESSION_COOKIE, readSessionToken } from '@/lib/auth';
import { debateRepo } from '@/lib/db';
import { noteFloorHeld, publish } from '@/lib/hub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/debate/sessions/:id/state — professor-only control surface.
 * Body: { phase?, status?, floorParticipantId?: string|null, phaseSeq }
 *
 * `phaseSeq` is the caller's expected value; the update is a compare-and-set, so
 * a double-tapped button or a duplicate timer is idempotent rather than racing.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const prof = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (prof === null) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { id } = await ctx.params;
  let body: {
    phase?: unknown;
    status?: unknown;
    floorParticipantId?: unknown;
    phaseSeq?: unknown;
    endNow?: unknown;
    requireTicket?: unknown;
    openFloor?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const repo = debateRepo();
  const session = await repo.getSession(id);
  if (session === undefined) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const expected = typeof body.phaseSeq === 'number' ? body.phaseSeq : session.phaseSeq;

  const patch: {
    phase?: string;
    status?: string;
    floorParticipantId?: string | null;
    endedAt?: Date | null;
    requireTicket?: boolean;
    openFloor?: boolean;
  } = {};
  if (typeof body.requireTicket === 'boolean') patch.requireTicket = body.requireTicket;
  if (typeof body.openFloor === 'boolean') patch.openFloor = body.openFloor;
  if (typeof body.phase === 'string' && body.phase.trim() !== '') patch.phase = body.phase.trim();
  if (typeof body.status === 'string' && ['lobby', 'live', 'judging', 'ended'].includes(body.status)) {
    patch.status = body.status;
  }
  // `null` explicitly clears the floor (nobody may record).
  if (body.floorParticipantId === null || typeof body.floorParticipantId === 'string') {
    patch.floorParticipantId = body.floorParticipantId as string | null;
  }
  if (body.endNow === true) {
    patch.status = 'ended';
    patch.endedAt = new Date();
    patch.floorParticipantId = null;
  }

  // Whoever is losing the floor keeps a short grace window to upload the clip
  // they just finished recording (see heldFloorRecently in lib/hub.ts).
  if (
    patch.floorParticipantId !== undefined &&
    session.floorParticipantId !== null &&
    session.floorParticipantId !== patch.floorParticipantId
  ) {
    noteFloorHeld(id, session.floorParticipantId);
  }

  // Granting the floor answers the request — lower that student's hand.
  if (typeof patch.floorParticipantId === 'string') {
    await repo.updateParticipant(patch.floorParticipantId, { handRaisedAt: null });
  }

  const updated = await repo.updateSessionState(id, expected, patch);
  if (updated === undefined) {
    return NextResponse.json(
      { error: 'The activity changed in another tab — reload and try again.', conflict: true },
      { status: 409 },
    );
  }
  publish(id);
  return NextResponse.json({ ok: true, session: updated });
}
