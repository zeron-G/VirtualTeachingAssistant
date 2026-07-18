import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  checkAdminCredentials,
  cookieOptions,
  normalizeEmail,
  signSessionToken,
} from '@/lib/auth';

export const runtime = 'nodejs';

/** POST /api/auth/login { email, password } — professor/admin sign-in. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let email: string;
  let password: string;
  try {
    const body: unknown = await req.json();
    email = normalizeEmail(String((body as { email?: unknown }).email ?? ''));
    password = String((body as { password?: unknown }).password ?? '');
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (!checkAdminCredentials(email, password)) {
    // Deliberately vague — don't reveal whether the email or the password was wrong.
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  }

  const session = await signSessionToken({ email, role: 'professor' });
  const res = NextResponse.json({ ok: true, role: 'professor' });
  res.cookies.set(SESSION_COOKIE, session, cookieOptions(SESSION_TTL_SECONDS));
  return res;
}
