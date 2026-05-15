/**
 * /api/auth/callback — finishes the OAuth flow.
 *
 * Cognito redirects the user here with `?code=...&state=...` after a
 * successful login. We:
 *
 *   1. Validate the `state` parameter against the cookie we set in
 *      /api/auth/login. Mismatch = abort (CSRF).
 *   2. Exchange the `code` for tokens at Cognito's /oauth2/token endpoint.
 *   3. Sign the resulting id_token into our session cookie.
 *   4. Clear the state cookie.
 *   5. Redirect to /.
 *
 * The id_token is what we store (it contains email + sub claims). The
 * access_token would only matter if we were calling Cognito APIs on the
 * user's behalf. We discard the refresh_token for now — short sessions
 * are fine for Session A; longer sessions are a Session-B+ concern.
 */
import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/cognito';
import { setSessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'jobtracker_oauth_state';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Cognito surfaces user-side errors here (e.g., user clicked "cancel").
  if (error) {
    return new NextResponse(
      `Sign-in failed: ${error}. <a href="/api/auth/login">Try again</a>`,
      { status: 400, headers: { 'Content-Type': 'text/html' } },
    );
  }

  if (!code || !state) {
    return new NextResponse('Missing code or state parameter', { status: 400 });
  }

  const stateCookie = req.cookies.get(STATE_COOKIE)?.value;
  if (!stateCookie || stateCookie !== state) {
    return new NextResponse('Invalid state — possible CSRF', { status: 400 });
  }

  const tokens = await exchangeCodeForTokens(code);
  if (!tokens) {
    return new NextResponse('Token exchange failed', { status: 500 });
  }

  // Send the user back to the home page, now authenticated.
  const res = NextResponse.redirect(new URL('/', req.url));
  await setSessionCookie(res, tokens.id_token);

  // Burn the state cookie so it can't be reused.
  res.cookies.set(STATE_COOKIE, '', { maxAge: 0, path: '/' });

  return res;
}
