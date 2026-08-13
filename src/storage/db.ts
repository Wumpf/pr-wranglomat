import Dexie, { type Table } from 'dexie';
import type { Repository } from '../domain/repository';
import type { PullRequest } from '../domain/pullRequest';
import type { Snapshot } from '../domain/snapshot';
import type { CompiledFilter } from '../query/ast';
export interface StoredFilter {
  id: string;
  name: string;
  nameKey: string;
  source: string;
  lastValidAst?: CompiledFilter;
  languageVersion: 1;
  repositoryScope: 'all' | number[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  pinned?: boolean;
  sourceRevision?: number;
  nameRevision?: number;
}
export interface Setting {
  key: string;
  value: unknown;
}
export interface StoredPageCache {
  key: string;
  repositoryId: number;
  stream: string;
  page: string;
  etag: string;
  rows: import('../domain/pullRequest').PullRequest[];
  updatedAt: string;
  next?: string;
  last?: string;
  totalPages?: number;
}
export class AppDatabase extends Dexie {
  repositories!: Table<Repository, number>;
  pullRequests!: Table<PullRequest, [number, string, number]>;
  snapshots!: Table<Snapshot, string>;
  filters!: Table<StoredFilter, string>;
  settings!: Table<Setting, string>;
  pageCache!: Table<StoredPageCache, string>;
  constructor() {
    super('pr-wranglomat');
    this.version(1).stores({
      repositories: 'id, fullName, lastSuccessfulSyncAt',
      pullRequests:
        '[repositoryId+snapshotId+number], [repositoryId+snapshotId], updated_at',
      snapshots: 'id, repositoryId, state',
      filters: 'id, &nameKey, updatedAt',
      settings: 'key',
    });
    this.version(2).stores({
      repositories: 'id, fullName, lastSuccessfulSyncAt',
      pullRequests:
        '[repositoryId+snapshotId+number], [repositoryId+snapshotId], updated_at',
      snapshots: 'id, repositoryId, state',
      filters: 'id, &nameKey, updatedAt',
      settings: 'key',
      pageCache: 'key, repositoryId, [repositoryId+stream], updatedAt',
    });
  }
}
export const db = new AppDatabase();
// Close this tab before another tab upgrades the schema.
db.on('versionchange', () => db.close());
export const storageChanges =
  typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('pr-wranglomat-storage');
