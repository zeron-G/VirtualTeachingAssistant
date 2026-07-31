import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { debateRepo } from '@/lib/db';
import { publish } from '@/lib/hub';
import { PARTICIPANT_COOKIE, readParticipantToken } from '@/lib/participant';
import { allow } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/debate/hand { raised: boolean } — a student asks for (or withdraws)
 * a turn to speak. Without this a student has no way to get the microphone
 * except the professor noticing them, which makes the activity unusable.
 *
 * Raising a hand does NOT open a mic — the professor still grants the floor.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const claims = await readParticipantToken(req.cookies.get(PARTICIPANT_COOKIE)?.value);
  if (claims === null) {
    return NextResponse.json({ error: 'You are not in this activity.' }, { status: 401 });
  }
  if (!allow(`hand:${claims.participantId}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Slow down a moment.' }, { status: 429 });
  }

  let raised: boolean;
  try {
    const body: unknown = await req.json();
    raised = (body as { raised?: unknown }).raised === true;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const repo = debateRepo();
  const updated = await repo.updateParticipant(claims.participantId, {
    handRaisedAt: raised ? new Date() : null,
  });
  if (updated === undefined) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  publish(claims.sessionId);
  return NextResponse.json({ ok: true, raised });
}
