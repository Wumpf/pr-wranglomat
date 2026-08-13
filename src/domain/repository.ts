export type Visibility = 'public' | 'private' | 'internal';
export interface Repository {
  id: number;
  fullName: string;
  visibility: Visibility;
  defaultBranch: string;
  activeSnapshotId?: string;
  lastSuccessfulSyncAt?: string;
  snapshotAge?: string;
  snapshotCount?: number;
  snapshotCompleteness?: Record<string, boolean>;
  syncError?: string;
  requestCount?: number;
  rateLimitRemaining?: number;
  rateLimitResetAt?: string;
  lastSyncStatus: SyncStatus;
}
export type SyncStatus =
  | 'never'
  | 'building'
  | 'ready'
  | 'stale'
  | 'partial'
  | 'forbidden'
  | 'rate-limited'
  | 'error'
  | 'cancelled';
export function normalizeRepoInput(input: string): string {
  const value = input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  if (!/^[^/\s]+\/[^/\s]+$/.test(value))
    throw new Error('Repository must be owner/name or a GitHub URL');
  return value;
}
