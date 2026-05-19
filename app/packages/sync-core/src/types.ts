export interface Application {
  userId: string;
  applicationId: string;
  gmailThreadId: string;
  company: string;
  role: string;
  status: 'applied' | 'interview' | 'offer' | 'rejected';
  appliedAt: string;
  emailSubject: string;
  emailDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncState {
  userId: string;
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'failure' | 'partial';
  lastError?: string | null;
  gmailHistoryId?: string;
  nextSyncEligibleAt?: string;
  emailsProcessed?: number;
  applicationsCreated?: number;
}

export interface SyncStatePatch {
  lastSyncAt: string;
  lastSyncStatus: 'success' | 'failure' | 'partial';
  lastError?: string | null;
  nextSyncEligibleAt?: string;
  emailsProcessedIncrement?: number;
  applicationsCreatedIncrement?: number;
}
