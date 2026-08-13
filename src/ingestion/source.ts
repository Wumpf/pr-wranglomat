import type { Repository } from '../domain/repository';
import type {
  IngestionTransport,
  SnapshotResult,
  SnapshotScope,
  SyncProgress,
} from '../domain/snapshot';
export interface Credential {
  readonly kind: 'pat';
  readonly token: string;
}
export interface SnapshotOptions {
  readonly snapshotId?: string;
  readonly scope?: SnapshotScope;
  readonly transport?: IngestionTransport;
  readonly concurrency?: number;
  readonly cache?: PageCache;
  readonly onPage?: (
    rows: import('../domain/pullRequest').PullRequest[],
    progress: SyncProgress,
  ) => Promise<void> | void;
}
export interface PageCache {
  get(key: string): Promise<CachedPage | undefined>;
  set(page: CachedPage): Promise<void>;
}
export interface CachedPage {
  key: string;
  etag: string;
  rows: import('../domain/pullRequest').PullRequest[];
  updatedAt: string;
  next?: string;
  last?: string;
  totalPages?: number;
}
export interface PullRequestSource {
  resolveRepository(
    input: string,
    credential?: Credential,
    signal?: AbortSignal,
  ): Promise<Repository>;
  createSnapshot(
    repository: Repository,
    options: SnapshotOptions,
    onProgress: (progress: SyncProgress) => void,
    signal: AbortSignal,
  ): Promise<SnapshotResult>;
}
