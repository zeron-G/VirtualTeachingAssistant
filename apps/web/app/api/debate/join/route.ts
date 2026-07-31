import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { debateRepo } from '@/lib/db';
import { publish } from '@/lib/hub';
import { allow, clientIp } from '@/lib/rateLimit';
import { verifyJoinTicket } from '@/lib/joinTicket';
import {
  PARTICIPANT_COOKIE,
  PARTICIPANT_TTL_SECONDS,
  generateDeviceId,
  participantCookieOptions,
  readParticipantToken,
  signParticipantToken,
} from '@/lib/participant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_NAME = 40;
const TEAMS = new Set(['red', 'blue', 'observer']);

/**
 * POST /api/debate/join { code, name, team, consent }
 *
 * Students type their own name — this is a classroom game, not an authentication
 * claim. `consent` must be true: nothing is recorded for a participant without
 * a consent timestamp (Maryland is an all-party-consent state, and the
 * push-to-talk design means a student only ever records themselves).
 *
 * Re-joining from the same device resumes the existing seat instead of creating
 * a duplicate, so a refresh or a dropped connection is harmless.
 */
/** A classroom is tens of people, not thousands. */
const MAX_PARTICIPANTS = 200;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // The join code is projected on a screen; keep one device from spamming the
  // roster (and the SSE fan-out) with it.
  if (!allow(`join:${clientIp(req.headers)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Wait a moment.' }, { status: 429 });
  }

  let code: string;
  let name: string;
  let team: string;
  let consent: boolean;
  let ticket: string;
  try {
    const body: unknown = await req.json();
    const b = body as Record<string, unknown>;
    code = String(b.code ?? '').trim().toUpperCase();
    name = String(b.name ?? '').trim().slice(0, MAX_NAME);
    team = String(b.team ?? 'observer').trim();
    consent = b.consent === true;
    ticket = String(b.ticket ?? '');
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (code === '' || name === '') {
    return NextResponse.json({ error: 'A join code and your name are required.' }, { status: 400 });
  }
  if (!TEAMS.has(team)) team = 'observer';
  if (!consent) {
    return NextResponse.json(
      { error: 'You must agree to the recording notice to take part.' },
      { status: 400 },
    );
  }

  const repo = debateRepo();
  const session = await repo.getSessionByJoinCode(code);
  if (session === undefined) {
    return NextResponse.json({ error: 'No activity found for that code.' }, { status: 404 });
  }
  if (session.status === 'ended') {
    return NextResponse.json({ error: 'That activity has ended.' }, { status: 410 });
  }

  // Resume the same seat if this device already joined this session.
  const existing = await readParticipantToken(req.cookies.get(PARTICIPANT_COOKIE)?.value);
  let participant =
    existing !== null && existing.sessionId === session.id
      ? await repo.findParticipantByDevice(session.id, existing.deviceId)
      : undefined;

  // CHECK-IN GATE: a NEW seat needs a fresh ticket from the rotating QR, which
  // is only obtainable by scanning the projector while it is displayed. An
  // already-seated device (a refresh mid-debate) is exempt — it checked in once.
  if (participant === undefined && session.requireTicket) {
    if (!(await verifyJoinTicket(session.id, ticket))) {
      return NextResponse.json(
        {
          error:
            'This code has expired. Scan the QR on the screen again — it changes every 30 seconds.',
          needsTicket: true,
        },
        { status: 403 },
      );
    }
  }

  const deviceId = participant?.deviceId ?? existing?.deviceId ?? generateDeviceId();

  if (participant === undefined) {
    if ((await repo.listParticipants(session.id)).length >= MAX_PARTICIPANTS) {
      return NextResponse.json({ error: 'This activity is full.' }, { status: 409 });
    }
    try {
      participant = await repo.addParticipant({
        sessionId: session.id,
        displayName: name,
        team,
        deviceId,
        consentAt: new Date(),
      });
    } catch {
      // Lost a race against a concurrent join from the same device — the unique
      // index on (session_id, device_id) is the source of truth; adopt the row.
      participant = await repo.findParticipantByDevice(session.id, deviceId);
      if (participant === undefined) {
        return NextResponse.json({ error: 'Could not join. Try again.' }, { status: 500 });
      }
    }
  } else {
    participant =
      (await repo.updateParticipant(participant.id, {
        displayName: name,
        team,
        consentAt: participant.consentAt ?? new Date(),
      })) ?? participant;
  }

  const token = await signParticipantToken({
    sessionId: session.id,
    participantId: participant.id,
    deviceId,
  });

  publish(session.id);
  const res = NextResponse.json({
    ok: true,
    sessionId: session.id,
    participant,
    topic: session.topic,
  });
  res.cookies.set(PARTICIPANT_COOKIE, token, participantCookieOptions(PARTICIPANT_TTL_SECONDS));
  return res;
}
