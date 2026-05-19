/**
 * gmail-oauth.ts — direct Google OAuth helpers for Gmail readonly access.
 *
 * This flow is intentionally separate from Cognito. Cognito handles app
 * sign-in; this helper asks Google directly for gmail.readonly and returns
 * the refresh token that Session C's sync worker will use.
 */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GMAIL_READONLY_SCOPE =
  'https://www.googleapis.com/auth/gmail.readonly';

interface GmailOAuthEnv {
  clientId: string;
  clientSecret: string;
  appUrl: string;
}

export interface GmailTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

function getEnv(): GmailOAuthEnv {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;

  if (!clientId || !clientSecret || !appUrl) {
    throw new Error(
      'gmail oauth env vars missing: need GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, APP_URL',
    );
  }

  return { clientId, clientSecret, appUrl };
}

function callbackUrl(): string {
  const { appUrl } = getEnv();
  return `${appUrl}/api/gmail/callback`;
}

export function getGmailLoginUrl(state: string): string {
  const { clientId } = getEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: GMAIL_READONLY_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export async function exchangeGmailCodeForTokens(
  code: string,
): Promise<GmailTokenResponse | null> {
  const { clientId, clientSecret } = getEnv();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: callbackUrl(),
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Google Gmail token exchange failed', res.status, text);
    return null;
  }

  return (await res.json()) as GmailTokenResponse;
}
