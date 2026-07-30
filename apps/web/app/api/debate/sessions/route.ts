import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { SESSION_COOKIE, readSessionToken } from '@/lib/auth';
import { debateRepo } from '@/lib/db';
import { generateJoinCode } from '@/lib/participant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/debate/sessions { courseId, topic } — professor creates an activity. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const prof = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (prof === null) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  let courseId: string;
  let topic: string;
  try {
    const body: unknown = await req.json();
    courseId = String((body as { courseId?: unknown }).courseId ?? '').trim();
    topic = String((body as { topic?: unknown }).topic ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (courseId === '' || topic === '') {
    return NextResponse.json({ error: 'A course and a debate motion are required.' }, { status: 400 });
  }

  const repo = debateRepo();
  // Retry on the (vanishingly unlikely) join-code collision.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const session = await repo.createSession({
        courseId,
        createdBy: prof.email,
        topic,
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
