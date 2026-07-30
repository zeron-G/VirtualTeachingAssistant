import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { CourseRepository } from '@vta/data';
import { SESSION_COOKIE, readSessionToken } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/debate/courses — courses the professor can start an activity for. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const prof = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (prof === null) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const courses = await new CourseRepository(getDb()).list();
  return NextResponse.json({
    ok: true,
    courses: courses.map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
  });
}
