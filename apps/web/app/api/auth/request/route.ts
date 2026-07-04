import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  VERIFY_COOKIE,
  VERIFY_TTL_SECONDS,
  cookieOptions,
  generateCode,
  hashCode,
  isAllowedEmail,
  normalizeEmail,
  signVerifyToken,
} from '@/lib/auth';
import { sendVerificationCode } from '@/lib/email';

// Uses Web Crypto + fetch; runs fine on the Node runtime.
export const runtime = 'nodejs';

/** POST /api/auth/request { email } — email a one-time code to a JHU address. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let email: string;
  try {
    const body: unknown = await req.json();
    email = normalizeEmail(String((body as { email?: unknown }).email ?? ''));
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (!isAllowedEmail(email)) {
    return NextResponse.json(
      { error: 'Please use your JHU email address (e.g. name@jhu.edu or name@jh.edu).' },
      { status: 400 },
    );
  }

  const code = generateCode();
  const token = await signVerifyToken(email, await hashCode(code));

  try {
    await sendVerificationCode(email, code);
  } catch {
    return NextResponse.json(
      { error: 'Could not send the code right now. Please try again shortly.' },
      { status: 502 },
    );
  }

  const res = NextResponse.json({ ok: true, email });
  res.cookies.set(VERIFY_COOKIE, token, cookieOptions(VERIFY_TTL_SECONDS));
  return res;
}
