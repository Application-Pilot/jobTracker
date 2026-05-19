/**
 * /signed-out — landing page after Cognito logout.
 *
 * The middleware allows this path through without a session, so a user
 * who has just signed out actually sees something instead of being
 * bounced straight back into the sign-in flow.
 *
 * Static page (no DB calls, no headers needed), so it can be statically
 * rendered.
 */
export const dynamic = 'force-static';

export default function SignedOutPage() {
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
      <h1 style={{ fontSize: '2.5rem', margin: 0, letterSpacing: '-0.02em' }}>
        Signed out
      </h1>
      <p style={{ color: '#888', margin: '0.5rem 0 2rem' }}>
        Your session has ended.
      </p>
      <a
        href="/api/auth/login"
        style={{
          padding: '0.75rem 1.5rem',
          background: '#fff',
          color: '#000',
          textDecoration: 'none',
          borderRadius: '0.4rem',
          fontWeight: 500,
        }}
      >
        Sign in again
      </a>
    </main>
  );
}
