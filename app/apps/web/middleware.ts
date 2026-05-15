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
  matcher: ['/((?!api/auth|_next|favicon\\.ico).*)'],
};

export async function middleware(req: NextRequest) {
  const idToken = await readSession(req);

  if (!idToken) {
    // No cookie or HMAC failed — bounce to login.
    return NextResponse.redirect(new URL('/api/auth/login', req.url));
  }

  const claims = await verifyToken(idToken);
  if (!claims) {
    // Cookie was real but the ID token is expired or invalid — clear the
    // cookie and bounce to login.
    const res = NextResponse.redirect(new URL('/api/auth/login', req.url));
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
