/**
 * users.ts — DynamoDB helpers for the users table.
 *
 * The users table is keyed by Cognito `sub` as userId. Non-key attributes
 * are schemaless in DynamoDB, so Session B can add profile and Gmail fields
 * without a table migration.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

export interface UserRow {
  userId: string;
  email?: string;
  name?: string;
  createdAt?: string;
  lastLoginAt?: string;
  gmailConnected?: boolean;
  gmailRefreshToken?: string;
  gmailScopes?: string[];
  gmailConnectedAt?: string;
}

interface UpsertSignedInUserInput {
  userId: string;
  email: string;
  name?: string;
}

let docClient: DynamoDBDocumentClient | null = null;

function getTableName(): string {
  const tableName = process.env.USERS_TABLE;
  if (!tableName) {
    throw new Error('USERS_TABLE env var is not set');
  }
  return tableName;
}

function getDocClient(): DynamoDBDocumentClient {
  if (docClient) return docClient;
  docClient = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' }),
  );
  return docClient;
}

/**
 * Atomically creates or updates a user profile after Cognito sign-in.
 *
 * We use UpdateItem with `createdAt = if_not_exists(createdAt, :now)` rather
 * than a read-then-write or full PutItem. That preserves any Gmail fields
 * already on the row and avoids a race between concurrent sign-in callbacks.
 */
export async function upsertSignedInUser({
  userId,
  email,
  name,
}: UpsertSignedInUserInput): Promise<void> {
  const now = new Date().toISOString();
  const names: Record<string, string> = {
    '#email': 'email',
    '#createdAt': 'createdAt',
    '#lastLoginAt': 'lastLoginAt',
  };
  const values: Record<string, string> = {
    ':email': email,
    ':now': now,
  };
  const setExpressions = [
    '#email = :email',
    '#createdAt = if_not_exists(#createdAt, :now)',
    '#lastLoginAt = :now',
  ];

  if (name) {
    names['#name'] = 'name';
    values[':name'] = name;
    setExpressions.push('#name = :name');
  }

  await getDocClient().send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { userId },
      UpdateExpression: `SET ${setExpressions.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function getUser(userId: string): Promise<UserRow | null> {
  const result = await getDocClient().send(
    new GetCommand({
      TableName: getTableName(),
      Key: { userId },
    }),
  );
  return (result.Item as UserRow | undefined) ?? null;
}

export async function getUserCount(): Promise<number> {
  const result = await getDocClient().send(
    new ScanCommand({ TableName: getTableName(), Select: 'COUNT' }),
  );
  return result.Count ?? 0;
}
