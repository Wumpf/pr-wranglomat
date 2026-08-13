import type { Repository } from '../domain/repository';
import type { SnapshotResult, SyncProgress } from '../domain/snapshot';
export interface Credential {
  readonly kind: 'pat';
  readonly token: string;
}
export interface SnapshotOptions {
  readonly snapshotId?: string;
  readonly onPage?: (
    rows: import('../domain/pullRequest').PullRequest[],
    progress: SyncProgress,
  ) => Promise<void> | void;
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
