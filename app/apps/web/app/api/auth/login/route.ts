/**
 * /api/auth/login — kicks off the Google sign-in flow.
 *
 * Steps:
 *   1. Generate a random `state` value for CSRF protection.
 *   2. Store it in a short-lived cookie.
 *   3. Redirect the user to Cognito's hosted UI with `state` in the URL.
 *
 * When Cognito redirects back to /api/auth/callback, that handler
 * compares the state in the URL to the state in the cookie and rejects
 * mismatches. This prevents an attacker from completing the OAuth flow
 * on someone else's behalf via a forged callback URL.
 */
import { NextResponse } from 'next/server';
import { getLoginUrl } from '@/lib/cognito';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'jobtracker_oauth_state';

export async function GET() {
  // 16 bytes → 32 hex chars. Plenty of entropy to prevent collisions.
  const stateBytes = crypto.getRandomValues(new Uint8Array(16));
  const state = Array.from(stateBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const loginUrl = getLoginUrl(state);

  const res = NextResponse.redirect(loginUrl);
  // Short-lived cookie just for the round-trip. 10 minutes is generous
  // for users who take a while at the Google consent screen.
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10,
  });
  return res;
}
