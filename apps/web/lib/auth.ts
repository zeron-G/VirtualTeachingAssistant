/**
 * Auth core for the VTA dashboard: JHU educational-email verification.
 *
 * The flow is STATELESS — there is no database. Two signed, HttpOnly JWT cookies
 * carry all state:
 *   - `vta_verify`  (short-lived, 10 min): set when a user requests a code; holds
 *                   the target email + a hash of the emailed code. Verified when
 *                   the user submits the code.
 *   - `vta_session` (7 days): set after a successful verification; holds the
 *                   authenticated email + role. This is what gates the dashboard.
 *
 * Access is restricted to Johns Hopkins educational domains (jhu.edu / jh.edu and
 * their subdomains); everything else is rejected at the request-code step.
 */

import { SignJWT, jwtVerify } from 'jose';

export const VERIFY_COOKIE = 'vta_verify';
export const SESSION_COOKIE = 'vta_session';

/** Verification code lifetime (seconds). */
export const VERIFY_TTL_SECONDS = 10 * 60;
/** Session lifetime (seconds). */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type Role = 'student' | 'professor';

export interface SessionClaims {
  readonly email: string;
  readonly role: Role;
}

interface VerifyClaims {
  readonly email: string;
  /** SHA-256(code + secret), hex. Never store the raw code in the cookie. */
  readonly codeHash: string;
}

/* -------------------------------------------------------------------------- */
/* Secret + config                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The signing secret. Required in production; in development we fall back to a
 * fixed, clearly-insecure value so the app runs without setup (sessions won't
 * survive a secret change, which is fine locally).
 */
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

/** Allowed educational domains (comma-separated env override; JHU by default). */
export function allowedDomains(): string[] {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS;
  const list = (raw !== undefined && raw !== '' ? raw : 'jhu.edu,jh.edu')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d !== '');
  return list;
}

/** Lowercase + trim an email for consistent comparison/signing. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True if `email` belongs to an allowed JHU educational domain (or a subdomain). */
export function isAllowedEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return false;
  const domain = email.slice(at + 1);
  if (!/^[a-z0-9.-]+$/.test(domain)) return false;
  return allowedDomains().some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** Professors are an explicit allowlist (env, comma-separated); everyone else is a student. */
export function roleFor(email: string): Role {
  const raw = process.env.PROFESSOR_EMAILS ?? '';
  const profs = new Set(
    raw
      .split(',')
      .map((e) => normalizeEmail(e))
      .filter((e) => e !== ''),
  );
  return profs.has(normalizeEmail(email)) ? 'professor' : 'student';
}

/* -------------------------------------------------------------------------- */
/* Verification codes                                                         */
/* -------------------------------------------------------------------------- */

/** A cryptographically-random 6-digit code, zero-padded. */
export function generateCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String((buf[0] ?? 0) % 1_000_000).padStart(6, '0');
}

/** SHA-256 of the code peppered with the signing secret; hex string. */
export async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(`${code}:${secretString()}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time-ish comparison of two hex hashes of equal length. */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* -------------------------------------------------------------------------- */
/* Tokens (jose)                                                              */
/* -------------------------------------------------------------------------- */

export async function signVerifyToken(email: string, codeHash: string): Promise<string> {
  return new SignJWT({ email, codeHash } satisfies VerifyClaims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${VERIFY_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function readVerifyToken(token: string | undefined): Promise<VerifyClaims | null> {
  if (token === undefined || token === '') return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.email === 'string' && typeof payload.codeHash === 'string') {
      return { email: payload.email, codeHash: payload.codeHash };
    }
    return null;
  } catch {
    return null;
  }
}

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
    const { payload } = await jwtVerify(token, secretKey());
    const role = payload.role;
    if (typeof payload.email === 'string' && (role === 'student' || role === 'professor')) {
      return { email: payload.email, role };
    }
    return null;
  } catch {
    return null;
  }
}

/** Cookie options shared by both auth cookies. Secure only over HTTPS (prod). */
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
