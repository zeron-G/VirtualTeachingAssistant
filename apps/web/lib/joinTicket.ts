/**
 * Rotating join tickets — the "you had to be in the room" proof.
 *
 * The projected QR encodes `/j/<code>?t=<ticket>` where the ticket is a signed
 * JWS bound to the session and to a 30-second time window. The console redraws
 * the QR every 30s, so a photograph taken earlier stops working.
 *
 * What this DOES give you: check-in semantics. Someone who was not in the room
 * while the code was on screen cannot join.
 * What it does NOT give you: protection against a classmate live-forwarding a
 * screenshot within the window. Closing the roster (and, ultimately, real
 * identity via Canvas/SSO) are the answers to that — see the design doc.
 */

import { SignJWT, jwtVerify } from 'jose';

/** How often the displayed QR changes. */
export const TICKET_WINDOW_SECONDS = 30;
/**
 * How long a scanned ticket stays redeemable. Deliberately longer than one
 * window so a student who scans just as it flips still gets in; short enough
 * that a forwarded screenshot goes stale quickly.
 */
export const TICKET_TTL_SECONDS = 90;

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (s !== undefined && s !== '') return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production');
  }
  return new TextEncoder().encode('dev-insecure-session-secret-change-me');
}

/** Mint a ticket for the CURRENT window of this session. */
export async function signJoinTicket(sessionId: string): Promise<string> {
  const window = Math.floor(Date.now() / 1000 / TICKET_WINDOW_SECONDS);
  return new SignJWT({ sid: sessionId, w: window })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TICKET_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** True if `ticket` is a valid, unexpired ticket for this session. */
export async function verifyJoinTicket(
  sessionId: string,
  ticket: string | undefined | null,
): Promise<boolean> {
  if (ticket === undefined || ticket === null || ticket === '') return false;
  try {
    const { payload } = await jwtVerify(ticket, secretKey(), { algorithms: ['HS256'] });
    // `exp` is enforced by jwtVerify; binding to the session id stops a ticket
    // from one activity being replayed into another.
    return payload.sid === sessionId;
  } catch {
    return false;
  }
}

/** Seconds until the current window flips — lets the console schedule its redraw. */
export function secondsUntilRotate(): number {
  const now = Date.now() / 1000;
  return Math.max(1, Math.ceil(TICKET_WINDOW_SECONDS - (now % TICKET_WINDOW_SECONDS)));
}
