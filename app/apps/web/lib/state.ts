/**
 * state.ts — signed OAuth state parameter (stateless CSRF protection)
 *
 * The state parameter accompanies the user from /api/auth/login through
 * Cognito + Google and back to /api/auth/callback. Format:
 *
 *   `{nonce}.{timestamp}.{hmac_hex}`
 *
 * where the HMAC is computed over `nonce.timestamp` using SESSION_SECRET.
 *
 * Why this instead of a state cookie?
 *
 *   - Modern browsers (Chrome, Brave, Safari) increasingly block cross-site
 *     cookies, including SameSite=None;Secure cookies, in many third-party
 *     contexts. The OAuth round-trip via Cognito counts as a cross-site
 *     navigation, so a state cookie set in /api/auth/login frequently
 *     never makes it back to /api/auth/callback.
 *   - A signed URL parameter sidesteps the browser cookie-blocking question
 *     entirely. The HMAC guarantees only our server could have issued the
 *     state, which is exactly the property CSRF protection cares about.
 *   - This is the pattern major OAuth client libraries (oauth4webapi,
 *     openid-client) use by default when stateless operation is desired.
 *
 * The timestamp lets us reject stale states (>10 minutes old) so a
 * captured state can't be reused indefinitely.
 */

const ENCODER = new TextEncoder();
const MAX_STATE_AGE_SECONDS = 60 * 10; // 10 minutes

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET env var is not set');
  return ENCODER.encode(secret);
}

async function hmacHex(value: string): Promise<string> {
  const keyMaterial = getSecret() as unknown as BufferSource;
  const message = ENCODER.encode(value) as unknown as BufferSource;
  const key = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, message);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Produces a fresh signed state. Call this when starting the OAuth flow.
 */
export async function signState(): Promise<string> {
  // 16 bytes → 32 hex chars; entropy for replay prevention within the
  // signature window.
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = Array.from(nonceBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = `${nonce}.${timestamp}`;
  const sig = await hmacHex(payload);
  return `${payload}.${sig}`;
}

/**
 * Verifies a state value received on the callback. Returns true if the
 * HMAC is valid AND the timestamp is within MAX_STATE_AGE_SECONDS.
 * Constant-time comparison on the HMAC; timing-safe.
 */
export async function verifyState(state: string): Promise<boolean> {
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [nonce, timestamp, claimedSig] = parts;
  if (!nonce || !timestamp || !claimedSig) return false;

  // Reject stale states. A captured state older than the window is no
  // longer accepted, limiting the replay surface.
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const ageSeconds = Math.floor(Date.now() / 1000) - ts;
  if (ageSeconds < 0 || ageSeconds > MAX_STATE_AGE_SECONDS) return false;

  // Recompute expected signature.
  const expectedSig = await hmacHex(`${nonce}.${timestamp}`);

  // Constant-time compare. Same hex length on both sides.
  if (claimedSig.length !== expectedSig.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    diff |= claimedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return diff === 0;
}
