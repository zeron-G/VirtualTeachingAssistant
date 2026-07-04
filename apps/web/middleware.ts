import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { SESSION_COOKIE, readSessionToken } from '@/lib/auth';

/**
 * Route gate: every page requires a valid JHU-verified session EXCEPT the login
 * page and the auth API. No session → redirect to /login. Runs on the edge
 * runtime; session verification is pure `jose` (Web Crypto), which is edge-safe.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  if (pathname === '/login' || pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  const session = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (session === null) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Gate everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
