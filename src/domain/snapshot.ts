import type { DataSource, PullRequest } from './pullRequest';
export type SnapshotScope =
  | { kind: 'open' }
  | { kind: 'recent'; cutoffDays: number }
  | { kind: 'complete' };
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
  rateLimitCost?: number;
  failure?: { code: string; message: string };
  scope: SnapshotScope;
  historyComplete: boolean;
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
  rateLimitResetAt?: string;
  rateLimitCost?: number;
  status: string;
}
