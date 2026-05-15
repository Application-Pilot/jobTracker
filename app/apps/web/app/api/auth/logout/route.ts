/**
 * /api/auth/logout — clears local session + bounces to Cognito logout.
 *
 * Two layers of session state we have to clear:
 *
 *   1. Our cookie (so subsequent requests to our app fail auth).
 *   2. Cognito's hosted-UI session cookie (so the user is asked to sign
 *      in again, instead of being silently re-authenticated).
 *
 * Cognito's logout endpoint, when given `client_id` and `logout_uri`,
 * clears its session and redirects to logout_uri (registered as an
 * allowed logout URL on the user pool client — wired in Terraform).
 */
import { NextResponse } from 'next/server';
import { getLogoutUrl } from '@/lib/cognito';
import { clearSessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const res = NextResponse.redirect(getLogoutUrl());
  clearSessionCookie(res);
  return res;
}
