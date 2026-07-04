import { NextResponse } from 'next/server';

import { SESSION_COOKIE, cookieOptions } from '@/lib/auth';

/** POST /api/auth/logout — clear the session cookie. */
export function POST(): NextResponse {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', cookieOptions(0));
  return res;
}
