import { UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { SyncStatePatch } from './types';

export async function updateSyncState(
  client: DynamoDBDocumentClient,
  table: string,
  userId: string,
  patch: SyncStatePatch,
): Promise<void> {
  const names: Record<string, string> = {
    '#lastSyncAt': 'lastSyncAt',
    '#lastSyncStatus': 'lastSyncStatus',
    '#lastError': 'lastError',
    '#emailsProcessed': 'emailsProcessed',
    '#applicationsCreated': 'applicationsCreated',
  };
  const values: Record<string, string | number | null> = {
    ':lastSyncAt': patch.lastSyncAt,
    ':lastSyncStatus': patch.lastSyncStatus,
    ':lastError': patch.lastError ?? null,
    ':zero': 0,
    ':emailsProcessedIncrement': patch.emailsProcessedIncrement ?? 0,
    ':applicationsCreatedIncrement': patch.applicationsCreatedIncrement ?? 0,
  };
  const setExpressions = [
    '#lastSyncAt = :lastSyncAt',
    '#lastSyncStatus = :lastSyncStatus',
    '#lastError = :lastError',
    '#emailsProcessed = if_not_exists(#emailsProcessed, :zero) + :emailsProcessedIncrement',
    '#applicationsCreated = if_not_exists(#applicationsCreated, :zero) + :applicationsCreatedIncrement',
  ];

  if (patch.nextSyncEligibleAt) {
    names['#nextSyncEligibleAt'] = 'nextSyncEligibleAt';
    values[':nextSyncEligibleAt'] = patch.nextSyncEligibleAt;
    setExpressions.push('#nextSyncEligibleAt = :nextSyncEligibleAt');
  }

  await client.send(
    new UpdateCommand({
      TableName: table,
      Key: { userId },
      UpdateExpression: `SET ${setExpressions.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}
