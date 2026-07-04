import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  VERIFY_COOKIE,
  cookieOptions,
  hashCode,
  hashesEqual,
  readVerifyToken,
  roleFor,
  signSessionToken,
} from '@/lib/auth';

export const runtime = 'nodejs';

/** POST /api/auth/verify { code } — check the code and open a session. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let code: string;
  try {
    const body: unknown = await req.json();
    code = String((body as { code?: unknown }).code ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const claims = await readVerifyToken(req.cookies.get(VERIFY_COOKIE)?.value);
  if (claims === null) {
    return NextResponse.json(
      { error: 'Your code expired or is missing. Request a new one.' },
      { status: 400 },
    );
  }

  if (!hashesEqual(await hashCode(code), claims.codeHash)) {
    return NextResponse.json({ error: 'Incorrect code. Please try again.' }, { status: 400 });
  }

  const role = roleFor(claims.email);
  const session = await signSessionToken({ email: claims.email, role });

  const res = NextResponse.json({ ok: true, role });
  res.cookies.set(SESSION_COOKIE, session, cookieOptions(SESSION_TTL_SECONDS));
  // Burn the verification cookie now that it's been used.
  res.cookies.set(VERIFY_COOKIE, '', cookieOptions(0));
  return res;
}
