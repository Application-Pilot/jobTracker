import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

export interface SyncStateRow {
  userId: string;
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'failure' | 'partial';
  applicationsCreated?: number;
}

let docClient: DynamoDBDocumentClient | null = null;

function getDocClient(): DynamoDBDocumentClient {
  if (docClient) return docClient;
  docClient = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' }),
  );
  return docClient;
}

export async function getSyncState(
  userId: string,
): Promise<SyncStateRow | null> {
  const tableName = process.env.SYNC_STATE_TABLE;
  if (!tableName) {
    return null;
  }

  const result = await getDocClient().send(
    new GetCommand({
      TableName: tableName,
      Key: { userId },
    }),
  );
  return (result.Item as SyncStateRow | undefined) ?? null;
}

export async function getApplicationCount(userId: string): Promise<number | null> {
  const tableName = process.env.APPLICATIONS_TABLE;
  if (!tableName) {
    return null;
  }

  const result = await getDocClient().send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: '#userId = :userId',
      ExpressionAttributeNames: {
        '#userId': 'userId',
      },
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      Select: 'COUNT',
    }),
  );
  return result.Count ?? 0;
}
