/**
 * Home page — server component (default for App Router).
 *
 * Middleware (middleware.ts at the repo root) verifies the user's
 * session before this component renders, and sets x-user-email +
 * x-user-sub + x-user-name as request headers. We read those headers
 * here using next/headers — no client JS, no extra Cognito round-trip.
 *
 * The DynamoDB call is wrapped in try/catch because local dev (without
 * AWS credentials) should still render the page gracefully.
 */

import { headers } from 'next/headers';
import { getUser, getUserCount, type UserRow } from '@/lib/users';

// Force this page to render on every request rather than be statically
// pre-rendered at build time. We need fresh user count + headers.
export const dynamic = 'force-dynamic';

async function getHomeData(userId: string | null): Promise<{
  user: UserRow | null;
  userCount: number | null;
}> {
  if (!process.env.USERS_TABLE) {
    return { user: null, userCount: null };
  }

  try {
    const [user, userCount] = await Promise.all([
      userId ? getUser(userId) : Promise.resolve(null),
      getUserCount(),
    ]);
    return { user, userCount };
  } catch (err) {
    console.error('getHomeData failed:', err);
    return { user: null, userCount: null };
  }
}

export default async function HomePage() {
  // Middleware always sets these for authenticated requests (and never
  // lets unauthenticated requests reach this page).
  const h = await headers();
  const email = h.get('x-user-email');
  const name = h.get('x-user-name');
  const userId = h.get('x-user-sub');

  const { user, userCount } = await getHomeData(userId);
  const gmailConnected = user?.gmailConnected === true;

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '3rem', margin: 0, letterSpacing: '-0.02em' }}>
        Jobtracker
      </h1>
      <p style={{ color: '#888', margin: '0.5rem 0 2rem' }}>Coming soon.</p>

      {email && (
        <section
          style={{
            padding: '1rem 1.5rem',
            border: '1px solid #2a4',
            borderRadius: '0.5rem',
            background: '#0c1f0c',
            color: '#9fc99f',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.9rem',
            marginBottom: '1rem',
          }}
        >
          Signed in as <strong>{name ? `${name} (${email})` : email}</strong>
        </section>
      )}

      <section
        style={{
          padding: '1rem 1.5rem',
          border: '1px solid #222',
          borderRadius: '0.5rem',
          background: '#111',
          color: '#aaa',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '0.9rem',
        }}
      >
        {userCount === null ? (
          <span>DB connection: not configured (running outside AWS)</span>
        ) : (
          <>
            Registered users in DynamoDB: <strong>{userCount}</strong>
          </>
        )}
      </section>

      <section
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginTop: '1rem',
          padding: '1rem 1.5rem',
          border: '1px solid #222',
          borderRadius: '0.5rem',
          background: '#111',
          color: '#ddd',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '0.9rem',
        }}
      >
        {gmailConnected ? (
          <>
            <span>Gmail: connected ✅</span>
            <a
              href="/api/gmail/disconnect"
              style={{
                color: '#aaa',
                fontSize: '0.85rem',
                textDecoration: 'underline',
              }}
            >
              Disconnect
            </a>
          </>
        ) : (
          <a
            href="/api/gmail/connect"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '2.25rem',
              padding: '0 1rem',
              borderRadius: '0.4rem',
              background: '#e8eefc',
              color: '#111',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Connect Gmail
          </a>
        )}
      </section>

      <a
        href="/api/auth/logout"
        style={{
          marginTop: '1.5rem',
          color: '#888',
          fontSize: '0.85rem',
          textDecoration: 'underline',
        }}
      >
        Sign out
      </a>

      <footer
        style={{
          marginTop: 'auto',
          padding: '2rem 0 0',
          color: '#444',
          fontSize: '0.75rem',
        }}
      >
        Deployed via Terraform on AWS Lambda + CloudFront + S3 · Auth via Cognito + Google
      </footer>
    </main>
  );
}
