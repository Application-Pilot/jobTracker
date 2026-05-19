/**
 * /api/gmail/callback — finishes direct Google OAuth for Gmail.
 *
 * Google redirects here with an authorization code. We verify signed state,
 * exchange the code directly with Google's token endpoint, KMS-encrypt the
 * refresh token, and store only the encrypted blob on the user's row.
 */
import { NextRequest, NextResponse } from 'next/server';
import { encryptRefreshToken } from '@/lib/crypto';
import {
  exchangeGmailCodeForTokens,
  GMAIL_READONLY_SCOPE,
} from '@/lib/gmail-oauth';
import { verifyState } from '@/lib/state';
import { connectGmailAccount } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const userId = req.headers.get('x-user-sub');

  if (error) {
    return new NextResponse(
      `Gmail connection failed: ${error}. <a href="/api/gmail/connect">Try again</a>`,
      { status: 400, headers: { 'Content-Type': 'text/html' } },
    );
  }

  if (!userId) {
    return new NextResponse('Missing authenticated user', { status: 401 });
  }

  if (!code || !state) {
    return new NextResponse('Missing code or state parameter', { status: 400 });
  }

  const stateValid = await verifyState(state);
  if (!stateValid) {
    console.warn('gmail callback: state verification failed', {
      hasStateParam: Boolean(state),
      stateLength: state.length,
    });
    return new NextResponse('Invalid state — possible CSRF or stale link', {
      status: 400,
    });
  }

  const tokens = await exchangeGmailCodeForTokens(code);
  if (!tokens) {
    return new NextResponse('Gmail token exchange failed', { status: 500 });
  }

  if (!tokens.refresh_token) {
    return new NextResponse(
      'Google did not return a refresh token. Please try connecting Gmail again.',
      { status: 500 },
    );
  }

  const encryptedRefreshToken = await encryptRefreshToken(
    tokens.refresh_token,
    userId,
  );
  const scopes = tokens.scope?.split(/\s+/).filter(Boolean) ?? [
    GMAIL_READONLY_SCOPE,
  ];

  await connectGmailAccount({
    userId,
    encryptedRefreshToken,
    scopes,
  });

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    return new NextResponse('APP_URL env var not set', { status: 500 });
  }
  return NextResponse.redirect(`${appUrl}/`);
}
