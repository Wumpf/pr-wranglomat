import { db } from './db';
import type { Repository } from '../domain/repository';
import type { SnapshotResult } from '../domain/snapshot';
import { storageChanges } from './db';
export const repositories = {
  list: () => db.repositories.toArray(),
  get: (id: number) => db.repositories.get(id),
  save: (repo: Repository) => db.repositories.put(repo),
  remove: (id: number) => db.repositories.delete(id),
  async beginSnapshot(repo: Repository, snapshotId: string) {
    await db.transaction('rw', db.repositories, db.snapshots, async () => {
      await db.snapshots.put({
        id: snapshotId,
        repositoryId: repo.id,
        state: 'building',
        schemaVersion: 1,
        profile: 'core',
        source: 'github-rest',
        completeness: { core: false },
        count: 0,
        startedAt: new Date().toISOString(),
      });
      const current = await db.repositories.get(repo.id);
      await db.repositories.put({
        ...(current ?? repo),
        lastSyncStatus: 'building',
      });
    });
    storageChanges?.postMessage({
      type: 'snapshot-building',
      repositoryId: repo.id,
    });
  },
  async stageRows(
    repositoryId: number,
    snapshotId: string,
    rows: SnapshotResult['pullRequests'],
  ) {
    if (rows.length)
      await db.pullRequests.bulkPut(
        rows.map((row) => ({ ...row, repositoryId, snapshotId })),
      );
    const snapshot = await db.snapshots.get(snapshotId);
    if (snapshot)
      await db.snapshots.put({
        ...snapshot,
        count: snapshot.count + rows.length,
      });
  },
  async activate(
    repo: Repository,
    snapshotId: string,
    rows: SnapshotResult['pullRequests'],
    metadata: Partial<SnapshotResult['snapshot']> = {},
  ): Promise<boolean> {
    let activated = false;
    await db.transaction(
      'rw',
      db.repositories,
      db.snapshots,
      db.pullRequests,
      async () => {
        const current = await db.repositories.get(repo.id);
        if (!current || current.activeSnapshotId !== repo.activeSnapshotId)
          return;
        const previous = current.activeSnapshotId;
        await db.pullRequests.bulkPut(
          rows.map((row) => ({ ...row, repositoryId: repo.id, snapshotId })),
        );
        const building = await db.snapshots.get(snapshotId);
        await db.snapshots.put({
          ...(building ?? {}),
          ...metadata,
          id: snapshotId,
          repositoryId: repo.id,
          state: 'complete',
          schemaVersion: 1,
          profile: 'core',
          source: 'github-rest',
          completeness: { core: true },
          count: rows.length,
          startedAt: building?.startedAt ?? new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        });
        await db.repositories.put({
          ...current,
          activeSnapshotId: snapshotId,
          lastSuccessfulSyncAt: new Date().toISOString(),
          snapshotCompleteness: { core: true },
          snapshotCount: rows.length,
          requestCount: metadata.requestCount,
          rateLimitRemaining: metadata.rateLimitRemaining,
          rateLimitResetAt: metadata.rateLimitResetAt,
          syncError: undefined,
          lastSyncStatus: 'ready',
        });
        if (previous && previous !== snapshotId) {
          await db.pullRequests
            .where('[repositoryId+snapshotId]')
            .equals([repo.id, previous])
            .delete();
          await db.snapshots.delete(previous);
        }
        activated = true;
      },
    );
    if (!activated) return false;
    storageChanges?.postMessage({
      type: 'snapshot-changed',
      repositoryId: repo.id,
    });
    return true;
  },
  async discardSnapshot(
    repository: Repository,
    snapshotId: string,
    status: Repository['lastSyncStatus'],
    error?: string,
  ) {
    await db.transaction(
      'rw',
      db.repositories,
      db.snapshots,
      db.pullRequests,
      async () => {
        await db.pullRequests
          .where('[repositoryId+snapshotId]')
          .equals([repository.id, snapshotId])
          .delete();
        await db.snapshots.delete(snapshotId);
        const current = await db.repositories.get(repository.id);
        if (current?.lastSyncStatus === 'building')
          await db.repositories.put({
            ...current,
            lastSyncStatus: status,
            syncError: error,
          });
      },
    );
    storageChanges?.postMessage({
      type: 'snapshot-discarded',
      repositoryId: repository.id,
    });
  },
  activeRows: async (id: number) => {
    const repo = await db.repositories.get(id);
    return repo?.activeSnapshotId
      ? db.pullRequests
          .where('[repositoryId+snapshotId]')
          .equals([id, repo.activeSnapshotId])
          .toArray()
      : [];
  },
  clearSnapshotData: async (id: number) => {
    const repo = await db.repositories.get(id);
    if (!repo) return;
    await db.transaction(
      'rw',
      db.repositories,
      db.snapshots,
      db.pullRequests,
      async () => {
        await db.snapshots.where('repositoryId').equals(id).delete();
        await db.pullRequests.where('repositoryId').equals(id).delete();
        await db.repositories.put({
          ...repo,
          activeSnapshotId: undefined,
          lastSuccessfulSyncAt: undefined,
          snapshotCount: undefined,
          snapshotCompleteness: undefined,
          requestCount: undefined,
          syncError: undefined,
          lastSyncStatus: 'never',
        });
      },
    );
    storageChanges?.postMessage({
      type: 'repository-data-cleared',
      repositoryId: id,
    });
  },
  clear: async (id?: number) => {
    if (id === undefined) {
      await db.delete();
      await db.open();
      storageChanges?.postMessage({ type: 'all-data-cleared' });
      return;
    }
    await db.transaction(
      'rw',
      db.repositories,
      db.snapshots,
      db.pullRequests,
      async () => {
        await db.repositories.delete(id);
        await db.snapshots.where('repositoryId').equals(id).delete();
        await db.pullRequests.where('repositoryId').equals(id).delete();
      },
    );
    storageChanges?.postMessage({
      type: 'repository-removed',
      repositoryId: id,
    });
  },
};
