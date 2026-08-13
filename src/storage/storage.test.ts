import { beforeEach, expect, it } from 'vitest';
import { db } from './db';
import { filters } from './filters';
import { repositories } from './repositories';
beforeEach(async () => {
  await db.delete();
  await db.open();
});
it('enforces unique case-folded filter names', async () => {
  await filters.create('Review queue');
  await expect(filters.create('review queue')).rejects.toThrow();
});

it('atomically imports valid filters and rejects invalid batches', async () => {
  await filters.import(
    JSON.stringify({
      version: 1,
      filters: [{ name: 'Open', source: 'state = "open"' }],
    }),
  );
  expect((await filters.list()).map((x) => x.name)).toContain('Open');
  await expect(
    filters.import(
      JSON.stringify({
        version: 1,
        filters: [{ name: 'Bad', source: 'state =' }],
      }),
    ),
  ).rejects.toThrow();
  expect((await filters.list()).map((x) => x.name)).not.toContain('Bad');
});

it('stages a building generation and deletes the old generation after activation', async () => {
  const repo = {
    id: 7,
    fullName: 'acme/app',
    visibility: 'private' as const,
    defaultBranch: 'main',
    lastSyncStatus: 'never' as const,
  };
  await repositories.save(repo);
  await repositories.beginSnapshot(repo, 'old');
  await repositories.activate(repo, 'old', []);
  const previous = await repositories.get(repo.id);
  await repositories.beginSnapshot(previous!, 'new');
  await repositories.activate(previous!, 'new', []);
  expect((await repositories.get(repo.id))?.activeSnapshotId).toBe('new');
  expect(await db.snapshots.get('old')).toBeUndefined();
});

it('rejects a stale concurrent activation inside the transaction', async () => {
  const repo = {
    id: 9,
    fullName: 'acme/concurrent',
    visibility: 'private' as const,
    defaultBranch: 'main',
    lastSyncStatus: 'never' as const,
  };
  await repositories.save(repo);
  await repositories.beginSnapshot(repo, 'first');
  expect(await repositories.activate(repo, 'first', [])).toBe(true);
  await repositories.beginSnapshot(repo, 'stale-build');
  expect(await repositories.activate(repo, 'stale-build', [])).toBe(false);
  expect((await repositories.get(repo.id))?.activeSnapshotId).toBe('first');
});

it('does not let a discarded stale generation erase a newer active snapshot', async () => {
  const repo = {
    id: 8,
    fullName: 'acme/other',
    visibility: 'private' as const,
    defaultBranch: 'main',
    lastSyncStatus: 'never' as const,
  };
  await repositories.save(repo);
  await repositories.beginSnapshot(repo, 'stale');
  const building = await repositories.get(repo.id);
  await repositories.activate(building!, 'newer', []);
  await repositories.discardSnapshot(repo, 'stale', 'cancelled');
  expect((await repositories.get(repo.id))?.activeSnapshotId).toBe('newer');
});

it('rejects an older draft write after a newer revision', async () => {
  const filter = await filters.create('Revision test', 'state = "open"');
  await filters.saveDraft(filter.id, 'state = "merged"', undefined, 2);
  await filters.saveDraft(filter.id, 'state = "closed"', undefined, 1);
  expect((await filters.get(filter.id))?.source).toBe('state = "merged"');
});

it('reopens an empty database after complete local-data deletion', async () => {
  await filters.create('Temporary');
  await repositories.clear();
  expect(await filters.list()).toEqual([]);
  await filters.create('After delete');
  expect(await filters.list()).toHaveLength(1);
});
