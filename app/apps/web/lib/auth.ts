/**
 * auth.ts — Cognito JWT verification
 *
 * Cognito access tokens are signed with RS256 using a key from its JWKS
 * (JSON Web Key Set), published at:
 *
 *   https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json
 *
 * To verify a token we:
 *   1. Fetch the JWKS once per Lambda cold-start (~100ms one-time cost).
 *   2. Pick the right key based on the token's `kid` header.
 *   3. Verify signature + issuer + audience.
 *   4. Return the claims (sub, email, etc.) if valid.
 *
 * The JWKS is cached in module-level memory, so warm Lambda invocations
 * skip the network round-trip entirely. `jose.createRemoteJWKSet` handles
 * the caching internally and refreshes when an unknown `kid` appears
 * (e.g., after Cognito rotates keys).
 *
 * This file is deliberately runtime-agnostic — it works in both the
 * Edge runtime (middleware) and the Node runtime (API routes / SSR) by
 * relying only on Web Crypto APIs, which `jose` does.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

/** Minimal shape of the claims we actually use. Cognito provides many more. */
export interface CognitoClaims {
  /** Cognito's internal user ID. Stable for the user's lifetime. */
  sub: string;
  /** User's email. Always present because we map Google's email claim. */
  email: string;
  /** User's display name from Google. May be absent. */
  name?: string;
  /** The token's audience — must equal our app's Cognito client_id. */
  aud: string;
  /** Token expiry, seconds since epoch. */
  exp: number;
}

/**
 * Lazily-initialized JWKS fetcher. Constructed on first call, reused
 * for the lifetime of the Lambda container. `jose` handles HTTP caching
 * and key rotation under the hood.
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (jwks) return jwks;

  const region = process.env.AWS_REGION ?? 'us-east-1';
  const poolId = process.env.COGNITO_USER_POOL_ID;
  if (!poolId) {
    throw new Error('COGNITO_USER_POOL_ID env var is not set');
  }

  const url = new URL(
    `https://cognito-idp.${region}.amazonaws.com/${poolId}/.well-known/jwks.json`,
  );
  jwks = createRemoteJWKSet(url);
  return jwks;
}

/**
 * Verifies a Cognito-issued JWT. Returns the decoded claims on success,
 * or null on any failure (expired, bad signature, wrong issuer, etc.).
 *
 * Never throws — callers treat null as "not authenticated."
 */
export async function verifyToken(token: string): Promise<CognitoClaims | null> {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const poolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;

  if (!poolId || !clientId) {
    // Misconfigured Lambda — treat as not authenticated rather than crash.
    console.error('verifyToken: missing Cognito env vars');
    return null;
  }

  const expectedIssuer = `https://cognito-idp.${region}.amazonaws.com/${poolId}`;

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: expectedIssuer,
      // For ID tokens, `aud` is the client_id. For access tokens, Cognito
      // does NOT set `aud` — it uses `client_id` instead. We verify ID
      // tokens here because they carry the email claim we actually want.
      audience: clientId,
    });

    return payload as unknown as CognitoClaims;
  } catch (err) {
    // Common cases: expired token, signature mismatch, wrong issuer.
    // Don't log the token (contains user PII); just log the error type.
    console.warn('verifyToken: rejected -', (err as Error).name);
    return null;
  }
}
