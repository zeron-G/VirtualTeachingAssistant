import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { debateRepo } from '@/lib/db';
import { heldFloorRecently, publish } from '@/lib/hub';
import { PARTICIPANT_COOKIE, readParticipantToken } from '@/lib/participant';
import { transcribe } from '@/lib/openrouter';
import { allow } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Guard against a runaway upload; a debate turn is minutes, not hours. */
const MAX_CLIP_BYTES = 25 * 1024 * 1024;

/**
 * POST /api/debate/turns  (multipart: audio=<clip>)
 *
 * THE ATTRIBUTION GUARANTEE: the speaker is taken from the participant cookie,
 * and the upload is refused unless that participant currently HOLDS THE FLOOR.
 * The clip therefore belongs to exactly one known person by construction — no
 * voiceprint, no diarization, no "Speaker 2" to reconcile.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const claims = await readParticipantToken(req.cookies.get(PARTICIPANT_COOKIE)?.value);
  if (claims === null) {
    return NextResponse.json({ error: 'You are not in this activity.' }, { status: 401 });
  }

  const repo = debateRepo();
  const [session, participant] = await Promise.all([
    repo.getSession(claims.sessionId),
    repo.getParticipant(claims.participantId),
  ]);
  if (session === undefined || participant === undefined) {
    return NextResponse.json({ error: 'Activity not found.' }, { status: 404 });
  }
  if (session.status === 'ended') {
    return NextResponse.json({ error: 'That activity has ended.' }, { status: 410 });
  }
  if (participant.consentAt === null) {
    return NextResponse.json({ error: 'Recording consent is required.' }, { status: 403 });
  }
  // Accept from the current holder, OR from whoever just held it — the clip is
  // uploaded after they stop speaking, so a phase change in that instant must
  // not throw the whole speech away. Attribution is unaffected: the speaker is
  // still taken from the authenticated participant, never from the request.
  if (
    session.floorParticipantId !== participant.id &&
    !heldFloorRecently(session.id, participant.id)
  ) {
    return NextResponse.json({ error: 'You do not have the floor.' }, { status: 403 });
  }

  // Every accepted clip is a paid Whisper call on the shared OpenRouter key
  // (which also serves the production Discord bot) — cap the rate per speaker.
  if (!allow(`turn:${participant.id}`, 12, 60_000)) {
    return NextResponse.json({ error: 'Slow down a moment, then try again.' }, { status: 429 });
  }

  // Reject oversized uploads BEFORE buffering the body into memory.
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_CLIP_BYTES) {
    return NextResponse.json({ error: 'That clip is too long.' }, { status: 413 });
  }

  let audio: File | null = null;
  try {
    const form = await req.formData();
    const value = form.get('audio');
    if (value instanceof File) audio = value;
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 });
  }
  if (audio === null || audio.size === 0) {
    return NextResponse.json({ error: 'No audio received.' }, { status: 400 });
  }
  if (audio.size > MAX_CLIP_BYTES) {
    return NextResponse.json({ error: 'That clip is too long.' }, { status: 413 });
  }

  let text: string;
  let seconds: number;
  try {
    const result = await transcribe(audio, audio.name !== '' ? audio.name : 'turn.webm');
    text = result.text;
    seconds = result.seconds;
  } catch {
    return NextResponse.json(
      { error: 'Could not transcribe that clip. Please try again.' },
      { status: 502 },
    );
  }

  // Silence / unintelligible audio: succeed, but store nothing.
  if (text === '') {
    return NextResponse.json({ ok: true, empty: true });
  }

  const turn = await repo.addTurn({
    sessionId: session.id,
    participantId: participant.id,
    speakerName: participant.displayName,
    team: participant.team,
    phase: session.phase,
    text,
    durationSec: Math.round(seconds),
  });

  publish(session.id);
  return NextResponse.json({ ok: true, turn });
}
