/**
 * cognito.ts — helpers for talking to Cognito's hosted UI + token endpoint
 *
 * Three operations we need:
 *
 *   1. Build the URL we redirect the browser to when the user clicks
 *      "Sign in". Includes a random `state` parameter for CSRF protection.
 *
 *   2. Exchange the OAuth `code` we receive in /api/auth/callback for
 *      a set of tokens (id_token, access_token, refresh_token). This is
 *      a server-side POST to Cognito's /oauth2/token endpoint, signed
 *      with HTTP Basic Auth using the client_id + client_secret.
 *
 *   3. Build the Cognito logout URL so we can clear the user's Cognito
 *      session in addition to our own cookie.
 */

interface CognitoEnv {
  domain: string;
  clientId: string;
  clientSecret: string;
  appUrl: string;
}

function getEnv(): CognitoEnv {
  const domain = process.env.COGNITO_DOMAIN;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const clientSecret = process.env.COGNITO_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;

  if (!domain || !clientId || !clientSecret || !appUrl) {
    throw new Error(
      'cognito env vars missing: need COGNITO_DOMAIN, COGNITO_CLIENT_ID, COGNITO_CLIENT_SECRET, APP_URL',
    );
  }
  return { domain, clientId, clientSecret, appUrl };
}

/** Where Cognito should redirect after a successful sign-in. */
function callbackUrl(): string {
  const { appUrl } = getEnv();
  return `${appUrl}/api/auth/callback`;
}

/**
 * Builds the URL to redirect the user to to start the sign-in flow.
 * Forces Google as the IdP (skipping Cognito's IdP-chooser screen).
 *
 * `prompt=login` forces the upstream IdP (Google, via Cognito) to
 * re-prompt for credentials on every sign-in, even if Cognito or Google
 * already has an active session for the user. Without this parameter,
 * SSO silently re-signs the user in after a logout — which is the
 * correct UX for production but defeats interactive testing.
 *
 * In Stage 3 polish, consider gating prompt=login behind a query
 * parameter (e.g., /api/auth/login?force=1) so returning users get the
 * silent SSO experience by default.
 */
export function getLoginUrl(state: string): string {
  const { domain, clientId } = getEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: callbackUrl(),
    identity_provider: 'Google',
    prompt: 'login',
    state,
  });
  return `${domain}/oauth2/authorize?${params}`;
}

/**
 * Builds the URL to redirect the user to to sign out of Cognito.
 * Cognito will then redirect to logout_uri (must be registered as a
 * logout URL on the user pool client; the dev env wires this up).
 *
 * Logout returns the user to /signed-out — a static page that the
 * middleware allows through without a session, so the user actually
 * sees confirmation instead of being bounced back into sign-in.
 */
export function getLogoutUrl(): string {
  const { domain, clientId, appUrl } = getEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    logout_uri: `${appUrl}/signed-out`,
  });
  return `${domain}/logout?${params}`;
}

/**
 * Exchanges the OAuth `code` from the callback for tokens.
 * Server-side only — uses the client secret in the Authorization header.
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  id_token: string;
  access_token: string;
  refresh_token: string;
} | null> {
  const { domain, clientId, clientSecret } = getEnv();

  // Cognito wants HTTP Basic Auth: base64("clientId:clientSecret").
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: callbackUrl(),
  });

  const res = await fetch(`${domain}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Cognito token exchange failed', res.status, text);
    return null;
  }

  return (await res.json()) as {
    id_token: string;
    access_token: string;
    refresh_token: string;
  };
}
