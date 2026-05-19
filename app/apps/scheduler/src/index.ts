import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

interface UserRow {
  userId: string;
  gmailConnected?: boolean;
}

interface SyncStateRow {
  userId: string;
  nextSyncEligibleAt?: string;
}

interface SchedulerResult {
  statusCode: number;
  body: {
    usersScanned: number;
    gmailConnectedUsers: number;
    messagesPublished: number;
  };
}

const region = process.env.AWS_REGION ?? 'us-east-1';
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const sqsClient = new SQSClient({ region });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} env var is not set`);
  }
  return value;
}

function isEligible(syncState: SyncStateRow | null, now: string): boolean {
  if (!syncState?.nextSyncEligibleAt) {
    return true;
  }
  return syncState.nextSyncEligibleAt <= now;
}

async function getSyncState(
  table: string,
  userId: string,
): Promise<SyncStateRow | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: table,
      Key: { userId },
    }),
  );
  return (result.Item as SyncStateRow | undefined) ?? null;
}

async function listGmailConnectedUsers(
  table: string,
): Promise<{ users: UserRow[]; scannedCount: number }> {
  const users: UserRow[] = [];
  let scannedCount = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: '#gmailConnected = :connected',
        ExpressionAttributeNames: {
          '#gmailConnected': 'gmailConnected',
        },
        ExpressionAttributeValues: {
          ':connected': true,
        },
        ExclusiveStartKey,
      }),
    );
    users.push(...((result.Items as UserRow[] | undefined) ?? []));
    scannedCount += result.ScannedCount ?? 0;
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return { users, scannedCount };
}

async function enqueueUser(queueUrl: string, userId: string): Promise<void> {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ userId }),
    }),
  );
}

export async function handler(): Promise<SchedulerResult> {
  const usersTable = requiredEnv('USERS_TABLE');
  const syncStateTable = requiredEnv('SYNC_STATE_TABLE');
  const queueUrl = requiredEnv('JOBS_QUEUE_URL');
  const now = new Date().toISOString();

  const { users: connectedUsers, scannedCount } =
    await listGmailConnectedUsers(usersTable);
  const eligibleUsers = (
    await Promise.all(
      connectedUsers.map(async (user) => {
        const syncState = await getSyncState(syncStateTable, user.userId);
        return isEligible(syncState, now) ? user : null;
      }),
    )
  ).filter((user): user is UserRow => user !== null);

  await Promise.all(eligibleUsers.map((user) => enqueueUser(queueUrl, user.userId)));

  const body = {
    usersScanned: scannedCount,
    gmailConnectedUsers: connectedUsers.length,
    messagesPublished: eligibleUsers.length,
  };

  console.log('scheduler complete', body);
  return { statusCode: 200, body };
}
