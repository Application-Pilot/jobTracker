/**
 * /api/auth/callback — finishes the OAuth flow.
 *
 * Cognito redirects the user here with `?code=...&state=...` after a
 * successful login. We:
 *
 *   1. Verify the signed `state` parameter using SESSION_SECRET. The
 *      state was minted by /api/auth/login and carries an HMAC + a
 *      timestamp. Verification fails if the HMAC doesn't match (forgery)
 *      or the timestamp is older than 10 minutes (replay).
 *   2. Exchange the `code` for tokens at Cognito's /oauth2/token endpoint.
 *   3. Sign the resulting id_token into our session cookie.
 *   4. Redirect to /.
 *
 * No state cookie — see lib/state.ts for why this approach is more
 * robust than the cookie-based equivalent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/cognito';
import { verifyToken } from '@/lib/auth';
import { setSessionCookie } from '@/lib/session';
import { verifyState } from '@/lib/state';
import { upsertSignedInUser } from '@/lib/users';

export const dynamic = 'force-dynamic';

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

  const stateValid = await verifyState(state);
  if (!stateValid) {
    console.warn('callback: state verification failed', {
      hasStateParam: Boolean(state),
      stateLength: state.length,
    });
    return new NextResponse('Invalid state — possible CSRF or stale link', {
      status: 400,
    });
  }

  const tokens = await exchangeCodeForTokens(code);
  if (!tokens) {
    return new NextResponse('Token exchange failed', { status: 500 });
  }

  const claims = await verifyToken(tokens.id_token);
  if (!claims) {
    return new NextResponse('Token verification failed', { status: 500 });
  }

  await upsertSignedInUser({
    userId: claims.sub,
    email: claims.email,
    name: claims.name,
  });

  // Send the user back to the home page, now authenticated.
  //
  // CRITICAL: Use APP_URL (the canonical CloudFront URL) rather than
  // `new URL('/', req.url)`. When this Lambda runs behind CloudFront,
  // `req.url` resolves to the underlying Lambda Function URL host
  // (e.g., abc.lambda-url.us-east-1.on.aws), and redirecting there
  // sends the user away from the public CloudFront domain.
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    return new NextResponse('APP_URL env var not set', { status: 500 });
  }
  const res = NextResponse.redirect(`${appUrl}/`);
  await setSessionCookie(res, tokens.id_token);

  return res;
}
