import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import QRCode from 'qrcode';

import { SESSION_COOKIE, readSessionToken } from '@/lib/auth';
import { debateRepo } from '@/lib/db';
import { secondsUntilRotate, signJoinTicket } from '@/lib/joinTicket';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/debate/sessions/:id/ticket — a fresh rotating QR for the projector.
 * Professor-only: handing this out freely would defeat the point of rotation.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const prof = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (prof === null) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { id } = await ctx.params;
  const session = await debateRepo().getSession(id);
  if (session === undefined) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const ticket = await signJoinTicket(id);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000';
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const joinUrl = `${proto}://${host}/j/${session.joinCode}?t=${encodeURIComponent(ticket)}`;
  const qrDataUrl = await QRCode.toDataURL(joinUrl, { width: 480, margin: 1 });

  return NextResponse.json({
    ok: true,
    qrDataUrl,
    joinUrl,
    rotateInSeconds: secondsUntilRotate(),
  });
}
