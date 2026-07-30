/**
 * Student ("participant") sessions for the debate module.
 *
 * DELIBERATELY SEPARATE from the professor session in `lib/auth.ts`: that one's
 * role is the literal 'professor' and is re-checked against ADMIN_EMAILS on
 * every read, so a student claim must never travel in it.
 *
 * A participant token is a signed, HttpOnly cookie scoped to ONE debate session.
 * It is an identity-of-convenience for a classroom game — students type their
 * own name — not an authentication claim. The `deviceId` inside lets a refresh,
 * a backgrounded tab, or a Wi-Fi drop resume the same seat.
 */

import { SignJWT, jwtVerify } from 'jose';

export const PARTICIPANT_COOKIE = 'vta_participant';
/** A classroom activity plus slack for a long session. */
export const PARTICIPANT_TTL_SECONDS = 8 * 60 * 60;

export interface ParticipantClaims {
  readonly sessionId: string;
  readonly participantId: string;
  readonly deviceId: string;
}

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (s !== undefined && s !== '') return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production');
  }
  return new TextEncoder().encode('dev-insecure-session-secret-change-me');
}

export async function signParticipantToken(claims: ParticipantClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${PARTICIPANT_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function readParticipantToken(
  token: string | undefined,
): Promise<ParticipantClaims | null> {
  if (token === undefined || token === '') return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    const { sessionId, participantId, deviceId } = payload as Record<string, unknown>;
    if (
      typeof sessionId === 'string' &&
      typeof participantId === 'string' &&
      typeof deviceId === 'string'
    ) {
      return { sessionId, participantId, deviceId };
    }
    return null;
  } catch {
    return null;
  }
}

export function participantCookieOptions(maxAgeSeconds: number): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** Crockford base32 without I/L/O/U — unambiguous when read off a projector. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateJoinCode(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export function generateDeviceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
