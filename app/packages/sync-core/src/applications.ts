import { PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Application } from './types';

export function createSyntheticApplication(userId: string): Application {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  return {
    userId,
    applicationId: id,
    gmailThreadId: `stub-${id}`,
    company: 'Stub Co',
    role: 'Stub Engineer',
    status: 'applied',
    appliedAt: now.slice(0, 10),
    emailSubject: 'Synthetic application from sync pipeline stub',
    emailDate: now,
    createdAt: now,
    updatedAt: now,
  };
}

export async function putApplication(
  client: DynamoDBDocumentClient,
  table: string,
  app: Application,
): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: table,
      Item: app,
    }),
  );
}

export async function classify(userId: string): Promise<Application[]> {
  // Session D swap-in point: replace this stub with Gmail classification
  // and LLM extraction while keeping worker orchestration unchanged.
  return [createSyntheticApplication(userId)];
}
