/**
 * Auth core for the VTA dashboard.
 *
 * Model:
 *   - Students browse as GUESTS — no login, no session.
 *   - Professors sign in as ADMIN with an email on an allowlist (`ADMIN_EMAILS`)
 *     PLUS a shared admin password (`ADMIN_PASSWORD`). A successful login mints a
 *     signed, HttpOnly session cookie (`vta_session`, jose JWT) carrying the
 *     professor's email + role. Only professors ever hold a session.
 *
 * There is no database and no email delivery: the session cookie is the only
 * state, and it is verified with `jose` (edge-safe Web Crypto).
 */

import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'vta_session';

/** Session lifetime (seconds). */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Only signed-in professors have a role; guests have no session at all. */
export type Role = 'professor';

export interface SessionClaims {
  readonly email: string;
  readonly role: Role;
}

/* -------------------------------------------------------------------------- */
/* Secret + config                                                            */
/* -------------------------------------------------------------------------- */

function secretString(): string {
  const s = process.env.SESSION_SECRET;
  if (s !== undefined && s !== '') return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production');
  }
  return 'dev-insecure-session-secret-change-me';
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(secretString());
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The professor/admin allowlist (comma-separated env). Empty ⇒ nobody can log in. */
function adminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? '';
  return new Set(
    raw
      .split(',')
      .map((e) => normalizeEmail(e))
      .filter((e) => e !== ''),
  );
}

/** Length-safe constant-time string comparison. */
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Compare against max length so the loop count doesn't leak which is longer;
  // a length mismatch still fails.
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i += 1) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/**
 * Validate an admin (professor) login. Requires BOTH: the email is on the
 * allowlist AND the password matches `ADMIN_PASSWORD`. If `ADMIN_PASSWORD` is
 * unset, login is impossible (fail-closed).
 */
export function checkAdminCredentials(email: string, password: string): boolean {
  const configured = process.env.ADMIN_PASSWORD;
  if (configured === undefined || configured === '') return false;
  if (!adminEmails().has(normalizeEmail(email))) return false;
  return constantTimeEqual(password, configured);
}

/* -------------------------------------------------------------------------- */
/* Session token (jose)                                                       */
/* -------------------------------------------------------------------------- */

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function readSessionToken(token: string | undefined): Promise<SessionClaims | null> {
  if (token === undefined || token === '') return null;
  try {
    // Pin the algorithm (defense-in-depth against alg-confusion, though the
    // symmetric key already precludes it).
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    if (typeof payload.email !== 'string' || payload.role !== 'professor') return null;
    // Re-validate against the CURRENT allowlist on every read, so removing an
    // email from ADMIN_EMAILS de-authorizes outstanding sessions immediately
    // rather than waiting up to the 7-day TTL. (To revoke ALL sessions at once,
    // rotate SESSION_SECRET.)
    if (!adminEmails().has(normalizeEmail(payload.email))) return null;
    return { email: payload.email, role: 'professor' };
  } catch {
    return null;
  }
}

/** Cookie options for the session cookie. Secure only over HTTPS (production). */
export function cookieOptions(maxAgeSeconds: number): {
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
