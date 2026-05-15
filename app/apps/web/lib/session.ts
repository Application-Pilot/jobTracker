/**
 * session.ts — signed session cookies
 *
 * We store the user's Cognito ID token inside an httpOnly cookie. The
 * cookie value is `{idToken}.{hmac}`, where the HMAC is computed over
 * the idToken with SESSION_SECRET. On every request we recompute the
 * HMAC and reject if it doesn't match — this prevents an attacker who
 * has only read access to the cookie (e.g., a browser extension) from
 * forging arbitrary tokens.
 *
 * Why not encrypt? The ID token itself is a JWT — its claims (email, sub)
 * are already readable by anyone with the cookie. The cookie just needs
 * to be tamper-evident, which signing alone achieves. Encryption would
 * add CPU per request for no real privacy gain.
 *
 * Cookie attributes:
 *   - httpOnly       — JS in the browser can't read it (XSS mitigation)
 *   - Secure         — only sent over HTTPS (set when NODE_ENV=production)
 *   - SameSite=Lax   — sent on top-level navigation, not cross-site POSTs
 *                       (Lax, not Strict, so the OAuth callback redirect works)
 *   - Max-Age=86400  — 24 hours; matches Cognito ID token's typical lifetime
 *
 * 30-day refresh tokens are NOT stored in the cookie. To get a longer
 * session we'd add a server-side store or store the refresh token in a
 * separate sealed cookie. Out of scope for Session A.
 */
import type { NextRequest, NextResponse } from 'next/server';

export const SESSION_COOKIE = 'jobtracker_session';
const ENCODER = new TextEncoder();

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET env var is not set');
  }
  return ENCODER.encode(secret);
}

/**
 * Compute HMAC-SHA256(value) using SESSION_SECRET, returning a hex string.
 * Uses Web Crypto so it works in both Node and Edge runtimes.
 */
async function sign(value: string): Promise<string> {
  // Web Crypto's BufferSource type signature is stricter in Node 22+ TS.
  // Casting through Uint8Array satisfies the BufferSource constraint
  // without changing runtime behavior.
  const keyMaterial = getSecret() as unknown as BufferSource;
  const message = ENCODER.encode(value) as unknown as BufferSource;

  const key = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, message);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Sign + serialize a session cookie value. Format: `{idToken}.{hmacHex}`.
 */
export async function packSessionCookie(idToken: string): Promise<string> {
  const sig = await sign(idToken);
  return `${idToken}.${sig}`;
}

/**
 * Validates and unpacks a session cookie value. Returns the idToken if
 * the signature matches; null otherwise.
 */
export async function unpackSessionCookie(
  cookieValue: string,
): Promise<string | null> {
  // The idToken itself contains dots (JWT format `header.payload.signature`),
  // so we split from the right to find our appended hmac.
  const lastDot = cookieValue.lastIndexOf('.');
  if (lastDot < 0) return null;

  const idToken = cookieValue.slice(0, lastDot);
  const claimedSig = cookieValue.slice(lastDot + 1);

  const expectedSig = await sign(idToken);

  // Constant-time comparison — prevents timing attacks on the HMAC. Both
  // strings are the same length (hex of a 32-byte digest), so length-based
  // early-return is safe.
  if (claimedSig.length !== expectedSig.length) return null;
  let diff = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    diff |= claimedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (diff !== 0) return null;

  return idToken;
}

/**
 * Helper: read the session cookie from a request, validate the signature,
 * and return the idToken. Returns null if missing or invalid.
 */
export async function readSession(req: NextRequest): Promise<string | null> {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  return unpackSessionCookie(cookie);
}

/** Cookie options used for set + clear. */
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24, // 24 hours
};

/** Helper: set the session cookie on a NextResponse. */
export async function setSessionCookie(
  res: NextResponse,
  idToken: string,
): Promise<void> {
  const value = await packSessionCookie(idToken);
  res.cookies.set(SESSION_COOKIE, value, COOKIE_OPTIONS);
}

/** Helper: clear the session cookie on a NextResponse. */
export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
}
