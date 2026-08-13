import type { DataSource, PullRequest } from './pullRequest';
export interface Snapshot {
  id: string;
  repositoryId: number;
  state: 'building' | 'complete' | 'failed' | 'cancelled';
  schemaVersion: 1;
  profile: 'core';
  source: DataSource;
  completeness: Record<string, boolean>;
  count: number;
  startedAt: string;
  finishedAt?: string;
  requestCount?: number;
  rateLimitRemaining?: number;
  rateLimitResetAt?: string;
  failure?: { code: string; message: string };
}
export interface SnapshotResult {
  snapshot: Snapshot;
  pullRequests: PullRequest[];
}
export interface SyncProgress {
  pages: number;
  requests: number;
  count: number;
  rateLimitRemaining?: number;
  status: string;
}
