/**
 * middleware.ts — gate every request behind authentication
 *
 * Runs on every request that matches the `config.matcher` below — that's
 * everything except /api/auth/* (the OAuth callback must stay public) and
 * /_next/* (Next.js's static assets).
 *
 * Flow for an unauthenticated user:
 *   1. They hit /
 *   2. Middleware sees no session cookie → 302 redirect to /api/auth/login
 *   3. /api/auth/login generates a state cookie + redirects to Cognito
 *   4. They sign in with Google
 *   5. Cognito redirects to /api/auth/callback?code=...
 *   6. Callback sets the session cookie + redirects to /
 *   7. Middleware sees the valid session, lets the request through
 *
 * Flow for an authenticated user:
 *   1. They hit /
 *   2. Middleware reads the session cookie, validates HMAC, verifies JWT
 *   3. Adds `x-user-email` request header for downstream RSCs to read
 *   4. Forwards to the destination
 *
 * Note: middleware runs in the Edge runtime, which is much more
 * limited than Node. We avoid all AWS SDKs here — just `jose` (Web Crypto)
 * and our own session helpers (also Web Crypto).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { readSession } from '@/lib/session';

export const config = {
  // Run on every path except:
  //   - /api/auth/*    (OAuth callback must be reachable without a session)
  //   - /_next/*       (Next.js static files — public by design)
  //   - /favicon.ico   (browsers request this without cookies)
  //   - /signed-out    (landing page after Cognito logout — no session needed)
  matcher: ['/((?!api/auth|_next|favicon\\.ico|signed-out).*)'],
};

export async function middleware(req: NextRequest) {
  // Defense-in-depth: if someone navigates DIRECTLY to the Lambda Function
  // URL (bypassing CloudFront), the OAuth redirect chain would break (the
  // OAuth redirect target is the CloudFront domain; the Lambda URL is a
  // different origin). Reject early so users get a clear pointer to the
  // canonical URL.
  //
  // Why not Host? AWS rewrites the Host header to the Lambda URL on every
  // CloudFront-proxied request, so checking Host would reject all
  // legitimate traffic. Instead we check for CloudFront-injected headers:
  //   - `x-amz-cf-id`: added by CloudFront on every request, hard to forge
  //   - `via`: contains "CloudFront" for CloudFront-proxied requests
  // Either being present is sufficient evidence.
  const hasCfId = req.headers.has('x-amz-cf-id');
  const via = req.headers.get('via') ?? '';
  const isFromCloudFront = hasCfId || via.includes('CloudFront');
  if (!isFromCloudFront) {
    return new NextResponse(
      'This is an internal endpoint. Please visit https://d2etjfsuqxfql6.cloudfront.net instead.',
      { status: 421, headers: { 'Content-Type': 'text/plain' } },
    );
  }

  // Resolve the canonical base URL once. APP_URL is set by Terraform to
  // the CloudFront URL (never the Lambda Function URL). Always redirect
  // to APP_URL-relative paths — never `new URL(..., req.url)`, which
  // would resolve to the Lambda host and send the user away from the
  // public domain.
  const appUrl = process.env.APP_URL ?? '';
  const loginUrl = `${appUrl}/api/auth/login`;

  const idToken = await readSession(req);

  if (!idToken) {
    // No cookie or HMAC failed — bounce to login.
    return NextResponse.redirect(loginUrl);
  }

  const claims = await verifyToken(idToken);
  if (!claims) {
    // Cookie was real but the ID token is expired or invalid — clear the
    // cookie and bounce to login.
    const res = NextResponse.redirect(loginUrl);
    res.cookies.set('jobtracker_session', '', { maxAge: 0, path: '/' });
    return res;
  }

  // Authenticated. Forward the email + sub to the downstream handler via
  // request headers so server components can render personalized content
  // without re-validating the token.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-user-email', claims.email);
  requestHeaders.set('x-user-sub', claims.sub);
  if (claims.name) requestHeaders.set('x-user-name', claims.name);

  return NextResponse.next({ request: { headers: requestHeaders } });
}
