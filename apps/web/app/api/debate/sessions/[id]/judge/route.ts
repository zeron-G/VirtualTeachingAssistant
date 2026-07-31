import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { SESSION_COOKIE, readSessionToken } from '@/lib/auth';
import { debateRepo } from '@/lib/db';
import { publish } from '@/lib/hub';
import { analyzeDiscussion } from '@/lib/judge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The analysis reads the whole transcript; give it room beyond the default. */
export const maxDuration = 120;

/**
 * POST /api/debate/sessions/:id/judge — read the discussion back to the class.
 * Professor-only, repeatable: each run is stored, so the professor can ask again
 * as the discussion develops. This does NOT rank the groups or pick a winner,
 * and nothing here writes a grade.
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
  let result;
  try {
    result = await analyzeDiscussion(session.topic, turns, session.teams);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'The assistant could not analyse the discussion.';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Reuses the judgements table: `scores` carries the structured insight and
  // `rationale` the read-aloud summary.
  const judgement = await repo.addJudgement({
    sessionId: id,
    scores: result.insight,
    rationale: result.summary,
    model: result.model,
  });

  publish(id);
  return NextResponse.json({ ok: true, judgement });
}
