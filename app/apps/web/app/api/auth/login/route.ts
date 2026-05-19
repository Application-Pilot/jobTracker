/**
 * /api/auth/login — kicks off the Google sign-in flow.
 *
 * Uses a "signed state" approach instead of a state cookie:
 *
 *   1. Generate a random nonce and a server-issued timestamp.
 *   2. HMAC-sign the nonce+timestamp with SESSION_SECRET.
 *   3. Encode `{nonce}.{timestamp}.{sig}` as the `state` parameter in
 *      the Cognito redirect URL.
 *   4. On the callback, recompute the HMAC and verify timestamp freshness.
 *
 * Why not a state cookie? Because modern Chrome (and Brave, and Safari
 * with cross-site cookie blocking) increasingly drops cross-site cookies
 * even with SameSite=None; Secure. The OAuth round-trip via Cognito
 * counts as cross-site. A signed URL parameter survives the round-trip
 * without needing the browser to cooperate on cookies — and is
 * actually more robust than the cookie approach: even if the state cookie
 * leaks, an attacker can't forge a valid state without SESSION_SECRET.
 */
import { NextResponse } from 'next/server';
import { getLoginUrl } from '@/lib/cognito';
import { signState } from '@/lib/state';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await signState();
  const loginUrl = getLoginUrl(state);
  return NextResponse.redirect(loginUrl);
}
