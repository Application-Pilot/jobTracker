/**
 * Home page — server component (default for App Router).
 *
 * This is a React Server Component, so the DynamoDB read happens on the
 * server (the Lambda) on every request. No client-side JS needed for the
 * counter. When deployed:
 *
 *   1. CloudFront receives the request
 *   2. Routes "/" to the SSR Lambda
 *   3. Lambda runs this component, calls DynamoDB, returns rendered HTML
 *   4. CloudFront serves the HTML back to the browser
 *
 * The DynamoDB call is wrapped in try/catch because Lambda's IAM role
 * permissions or AWS_REGION might not be set during local dev — we don't
 * want the dev experience broken if the env isn't AWS-shaped.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

// Force this page to render on every request rather than be statically
// pre-rendered at build time. The user count is dynamic; we want it fresh.
export const dynamic = 'force-dynamic';

/**
 * Reads the count of items in the users table. Returns null on any failure
 * so the page still renders gracefully if the DB is unreachable.
 */
async function getUserCount(): Promise<number | null> {
  const tableName = process.env.USERS_TABLE;
  if (!tableName) return null;

  try {
    const client = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' })
    );
    // Scan returns the entire table; fine while users are few. At scale
    // we'd keep a counter in a stats table instead of scanning every load.
    const result = await client.send(
      new ScanCommand({ TableName: tableName, Select: 'COUNT' })
    );
    return result.Count ?? 0;
  } catch (err) {
    console.error('getUserCount failed:', err);
    return null;
  }
}

export default async function HomePage() {
  const userCount = await getUserCount();

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

      <footer
        style={{
          marginTop: 'auto',
          padding: '2rem 0 0',
          color: '#444',
          fontSize: '0.75rem',
        }}
      >
        Deployed via Terraform on AWS Lambda + CloudFront + S3.
      </footer>
    </main>
  );
}
