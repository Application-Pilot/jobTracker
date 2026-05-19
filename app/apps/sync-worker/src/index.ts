import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DecryptCommand, KMSClient } from '@aws-sdk/client-kms';
import {
  DynamoDBDocumentClient,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { classify, putApplication, updateSyncState } from '@jobtracker/sync-core';

interface SqsRecord {
  body: string;
  messageId: string;
}

interface SqsEvent {
  Records: SqsRecord[];
}

interface SyncJob {
  userId: string;
}

interface UserRow {
  userId: string;
  gmailConnected?: boolean;
  gmailRefreshToken?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

const region = process.env.AWS_REGION ?? 'us-east-1';
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const kmsClient = new KMSClient({ region });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} env var is not set`);
  }
  return value;
}

function nextEligibleAt(): string {
  return new Date(Date.now() + 15 * 60 * 1000).toISOString();
}

function parseJob(record: SqsRecord): SyncJob {
  const parsed = JSON.parse(record.body) as Partial<SyncJob>;
  if (!parsed.userId) {
    throw new Error(`SQS message ${record.messageId} is missing userId`);
  }
  return { userId: parsed.userId };
}

async function getUser(table: string, userId: string): Promise<UserRow | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: table,
      Key: { userId },
    }),
  );
  return (result.Item as UserRow | undefined) ?? null;
}

async function decryptRefreshToken(
  encryptedRefreshToken: string,
  userId: string,
): Promise<string> {
  const result = await kmsClient.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(encryptedRefreshToken, 'base64'),
      KeyId: requiredEnv('TOKEN_KMS_KEY_ARN'),
      EncryptionContext: { userId },
    }),
  );

  if (!result.Plaintext) {
    throw new Error('KMS Decrypt returned no plaintext');
  }

  return Buffer.from(result.Plaintext).toString('utf8');
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ ok: true } | { ok: false; permanent: boolean; error: string }> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: requiredEnv('GMAIL_OAUTH_CLIENT_ID'),
    client_secret: requiredEnv('GMAIL_OAUTH_CLIENT_SECRET'),
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const body = (await response.json().catch(() => ({}))) as GoogleTokenResponse;

  if (!response.ok) {
    const error = body.error_description ?? body.error ?? response.statusText;
    return { ok: false, permanent: response.status < 500, error };
  }

  if (!body.access_token) {
    throw new Error('Google token refresh returned no access_token');
  }

  console.log('gmail token refresh succeeded', {
    expiresIn: body.expires_in,
    scope: body.scope,
    tokenType: body.token_type,
  });
  return { ok: true };
}

async function markFailure(userId: string, error: string): Promise<void> {
  await updateSyncState(docClient, requiredEnv('SYNC_STATE_TABLE'), userId, {
    lastSyncAt: new Date().toISOString(),
    lastSyncStatus: 'failure',
    lastError: error,
    emailsProcessedIncrement: 0,
    applicationsCreatedIncrement: 0,
    nextSyncEligibleAt: nextEligibleAt(),
  });
}

async function processRecord(record: SqsRecord): Promise<void> {
  const job = parseJob(record);
  const usersTable = requiredEnv('USERS_TABLE');
  const applicationsTable = requiredEnv('APPLICATIONS_TABLE');
  const user = await getUser(usersTable, job.userId);

  if (!user?.gmailConnected || !user.gmailRefreshToken) {
    await markFailure(job.userId, 'User is missing a connected Gmail refresh token');
    console.warn('skipping sync for user without Gmail token', { userId: job.userId });
    return;
  }

  const refreshToken = await decryptRefreshToken(user.gmailRefreshToken, job.userId);
  const tokenResult = await refreshAccessToken(refreshToken);
  if (!tokenResult.ok) {
    await markFailure(job.userId, tokenResult.error);
    if (tokenResult.permanent) {
      console.warn('gmail token refresh failed permanently; message acknowledged', {
        userId: job.userId,
        error: tokenResult.error,
      });
      return;
    }
    throw new Error(`Gmail token refresh failed: ${tokenResult.error}`);
  }

  const applications = await classify(job.userId);
  await Promise.all(
    applications.map((application) =>
      putApplication(docClient, applicationsTable, application),
    ),
  );

  await updateSyncState(docClient, requiredEnv('SYNC_STATE_TABLE'), job.userId, {
    lastSyncAt: new Date().toISOString(),
    lastSyncStatus: 'success',
    lastError: null,
    emailsProcessedIncrement: 0,
    applicationsCreatedIncrement: applications.length,
    nextSyncEligibleAt: nextEligibleAt(),
  });

  console.log('sync job complete', {
    userId: job.userId,
    applicationsCreated: applications.length,
  });
}

export async function handler(event: SqsEvent): Promise<void> {
  const results = await Promise.allSettled(
    event.Records.map((record) => processRecord(record)),
  );
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );

  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `${failures.length} sync job(s) failed`,
    );
  }
}
