import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { SESSION_COOKIE, readSessionToken } from '@/lib/auth';
import { debateRepo } from '@/lib/db';
import { publish } from '@/lib/hub';
import { judgeDebate } from '@/lib/judge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The judge reads the whole transcript; give it room beyond the default. */
export const maxDuration = 120;

/**
 * POST /api/debate/sessions/:id/judge — run the ADVISORY AI judge.
 * Professor-only. The verdict is stored with isFinal=false and must be
 * confirmed by a human; nothing here writes a grade.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const prof = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (prof === null) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { id } = await ctx.params;
  const repo = debateRepo();
  const session = await repo.getSession(id);
  if (session === undefined) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const turns = await repo.listTurns(id);
  let verdict;
  try {
    verdict = await judgeDebate(session.topic, turns);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The judge could not produce a verdict.';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const judgement = await repo.addJudgement({
    sessionId: id,
    scores: verdict.scores,
    rationale: verdict.rationale,
    model: verdict.model,
    isFinal: false,
  });

  publish(id);
  return NextResponse.json({ ok: true, judgement });
}

/** PATCH — professor confirms the advisory verdict. Body: { judgementId }. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const prof = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (prof === null) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { id } = await ctx.params;
  let judgementId: string;
  try {
    const body: unknown = await req.json();
    judgementId = String((body as { judgementId?: unknown }).judgementId ?? '');
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (judgementId === '') {
    return NextResponse.json({ error: 'judgementId is required.' }, { status: 400 });
  }

  await debateRepo().confirmJudgement(judgementId, prof.email);
  publish(id);
  return NextResponse.json({ ok: true });
}
