import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { DEFAULT_TEAMS, TEAM_PALETTE } from '@vta/data';
import type { DiscussionTeam } from '@vta/data';
import { SESSION_COOKIE, readSessionToken } from '@/lib/auth';
import { debateRepo } from '@/lib/db';
import { generateJoinCode } from '@/lib/participant';

/** Ids are fixed and positional so colours/labels stay stable if renamed. */
const TEAM_IDS = ['red', 'blue', 'green', 'amber'] as const;

const MAX_TEAMS = 4;

/**
 * Accept 2-4 group labels from the professor. Omitting `teams` entirely means
 * "use the default For/Against pair"; sending a bad list is an error rather
 * than something to quietly coerce — silently dropping a fifth group would
 * leave those students with nowhere to sit and no indication why.
 */
function parseTeams(raw: unknown): DiscussionTeam[] | { error: string } {
  if (raw === undefined || raw === null) return DEFAULT_TEAMS;
  if (!Array.isArray(raw)) return { error: 'Groups must be a list of names.' };
  const labels = raw.map((x) => String(x ?? '').trim()).filter((x) => x !== '');
  if (labels.length !== raw.length) return { error: 'Group names cannot be blank.' };
  if (labels.length < 2 || labels.length > MAX_TEAMS) {
    return { error: `A discussion needs between 2 and ${MAX_TEAMS} groups.` };
  }
  if (labels.some((l) => l.length > 32)) {
    return { error: 'Group names are limited to 32 characters.' };
  }
  const lowered = labels.map((l) => l.toLowerCase());
  if (new Set(lowered).size !== lowered.length) {
    return { error: 'Group names must be different from one another.' };
  }
  return labels.map((label, i) => ({
    id: TEAM_IDS[i] ?? `team${i}`,
    label,
    color: TEAM_PALETTE[i] ?? '#5b6672',
  }));
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/debate/sessions { courseId, topic } — professor creates an activity. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const prof = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (prof === null) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  let courseId: string;
  let topic: string;
  let parsed: DiscussionTeam[] | { error: string };
  try {
    const body = (await req.json()) as Record<string, unknown>;
    courseId = String(body.courseId ?? '').trim();
    topic = String(body.topic ?? '').trim();
    parsed = parseTeams(body.teams);
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (courseId === '' || topic === '') {
    return NextResponse.json(
      { error: 'A course and a discussion question are required.' },
      { status: 400 },
    );
  }
  if (!Array.isArray(parsed)) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const teams = parsed;

  const repo = debateRepo();
  // Retry on the (vanishingly unlikely) join-code collision.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const session = await repo.createSession({
        courseId,
        createdBy: prof.email,
        topic,
        teams,
        joinCode: generateJoinCode(),
      });
      return NextResponse.json({ ok: true, session });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('join_code') && !msg.toLowerCase().includes('unique')) {
        return NextResponse.json({ error: 'Could not create the activity.' }, { status: 500 });
      }
    }
  }
  return NextResponse.json({ error: 'Could not allocate a join code.' }, { status: 500 });
}

/** GET /api/debate/sessions?courseId=… — list recent activities for a course. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const prof = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (prof === null) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const courseId = req.nextUrl.searchParams.get('courseId');
  if (courseId === null || courseId === '') {
    return NextResponse.json({ error: 'courseId is required.' }, { status: 400 });
  }
  const sessions = await debateRepo().listSessions(courseId);
  return NextResponse.json({ ok: true, sessions });
}
