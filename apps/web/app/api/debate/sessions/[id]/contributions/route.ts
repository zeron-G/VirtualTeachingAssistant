import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { SESSION_COOKIE, readSessionToken } from '@/lib/auth';
import { assessContributions } from '@/lib/contributions';
import { debateRepo } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Reviewing every speaker over a whole transcript takes longer than a summary. */
export const maxDuration = 180;

/**
 * Per-participant contribution review — PROFESSOR ONLY, both verbs.
 *
 * This deliberately does NOT ride on the session snapshot: that snapshot is
 * broadcast over an unauthenticated SSE stream to every student's phone, so
 * putting participation bands in it would hand every student the whole class's
 * assessment. It is fetched here, by the console, behind the professor cookie.
 *
 * Nothing here writes a grade. See `lib/contributions.ts` for the constraints
 * the prompt enforces and the measurement bias it cannot remove.
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

  const [turns, participants] = await Promise.all([
    repo.listTurns(id),
    repo.listParticipants(id),
  ]);

  let report;
  try {
    report = await assessContributions(session.topic, turns, participants, session.teams);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'The assistant could not review contributions.';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { model, summary, ...payload } = report;
  const row = await repo.addJudgement({
    sessionId: id,
    kind: 'contributions',
    scores: payload,
    rationale: summary,
    model,
  });

  // No publish(): this must not reach the student stream.
  return NextResponse.json({ ok: true, report, createdAt: row.createdAt });
}

/** GET — the last review, so reopening the console doesn't re-run a paid call. */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const prof = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (prof === null) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { id } = await ctx.params;
  const row = await debateRepo().latestJudgement(id, 'contributions');
  if (row === undefined) return NextResponse.json({ ok: true, report: null });

  const stored = row.scores as Record<string, unknown>;
  return NextResponse.json({
    ok: true,
    report: { ...stored, summary: row.rationale, model: row.model },
    createdAt: row.createdAt,
  });
}
