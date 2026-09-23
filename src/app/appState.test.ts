import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../storage/db';
import { filters } from '../storage/filters';
import { createAppState } from './appState.svelte';
import { repositories } from '../storage/repositories';
import type { Repository } from '../domain/repository';
import { normalizePullRequest } from '../domain/normalize';
import { GraphQLSource } from '../github/graphql';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('defaults to all repositories and combines independently selected results', async () => {
  const repos: Repository[] = [1, 2].map((id) => ({
    id,
    fullName: `owner/repo${id}`,
    visibility: 'public',
    defaultBranch: 'main',
    lastSyncStatus: 'never',
  }));
  for (const repo of repos) await repositories.save(repo);
  vi.spyOn(repositories, 'activeRows').mockImplementation(async (id) => [
    normalizePullRequest(
      {
        number: 1,
        html_url: `https://github.com/owner/repo${id}/pull/1`,
        title: `PR ${id}`,
        state: 'open',
        base: { ref: 'main' },
        head: { ref: 'branch' },
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        closed_at: null,
      },
      id,
      `owner/repo${id}`,
      'snapshot',
    ),
  ]);
  const app = createAppState();
  await app.init();
  expect(app.selectedRepositories).toHaveLength(2);
  expect(app.result.map((row) => row.repositoryId).sort()).toEqual([1, 2]);
  await app.toggleRepository(repos[0]);
  expect(app.result.map((row) => row.repositoryId)).toEqual([2]);
  await app.toggleRepository(repos[1]);
  expect(app.result).toEqual([]);
  await app.selectAllRepositories();
  expect(app.result).toHaveLength(2);
  await app.toggleRepository(repos[1]);
  await app.removeSelectedRepositories();
  expect(app.repos.map((repo) => repo.id)).toEqual([2]);
  expect(app.selectedRepositories).toEqual([]);
  expect(app.result).toEqual([]);
});

it('applies preferences and deletion to all selected repositories only', async () => {
  const repos: Repository[] = [1, 2, 3].map((id) => ({
    id,
    fullName: `owner/repo${id}`,
    visibility: 'public',
    defaultBranch: 'main',
    lastSyncStatus: 'never',
  }));
  for (const repo of repos) await repositories.save(repo);
  const app = createAppState();
  await app.init();
  await app.toggleRepository(repos[1]);
  await app.setSnapshotScope({ kind: 'complete' });
  for (const id of [1, 3]) {
    expect(await repositories.get(id)).toMatchObject({
      snapshotScope: { kind: 'complete' },
    });
  }
  expect((await repositories.get(2))?.snapshotScope).toBeUndefined();
  const clear = vi.spyOn(repositories, 'clearSnapshotData');
  await app.clearSelectedRepositoryData();
  expect(clear.mock.calls.map(([id]) => id).sort()).toEqual([1, 3]);
  expect(app.repos).toHaveLength(3);
  await app.removeSelectedRepositories();
  expect(app.repos.map((repo) => repo.id)).toEqual([2]);
  expect(app.selectedRepositories).toEqual([]);
  clear.mockClear();
  await app.clearSelectedRepositoryData();
  await app.removeSelectedRepositories();
  expect(clear).not.toHaveBeenCalled();
  expect(await repositories.get(2)).toBeDefined();
});

it('refreshes all selected repositories through GraphQL', async () => {
  const repos: Repository[] = [1, 2, 3].map((id) => ({
    id,
    fullName: `owner/repo${id}`,
    visibility: 'public',
    defaultBranch: 'main',
    lastSyncStatus: 'never',
  }));
  for (const repo of repos) await repositories.save(repo);
  const app = createAppState();
  await app.init();
  await app.toggleRepository(repos[1]);
  app.setToken('test-token');
  const createSnapshot = vi
    .spyOn(GraphQLSource.prototype, 'createSnapshot')
    .mockImplementation(async (repo, options) => ({
      snapshot: {
        id: options.snapshotId!,
        repositoryId: repo.id,
        state: 'complete',
        schemaVersion: 1,
        profile: 'core',
        source: 'github-graphql',
        completeness: { core: true },
        count: 0,
        startedAt: new Date().toISOString(),
        scope: options.scope!,
        historyComplete: false,
      },
      pullRequests: [],
    }));
  await app.refresh();
  expect(createSnapshot.mock.calls.map(([repo]) => repo.id).sort()).toEqual([
    1, 3,
  ]);
  expect((await repositories.get(1))?.lastSyncStatus).toBe('ready');
  expect((await repositories.get(2))?.lastSyncStatus).toBe('never');
  expect((await repositories.get(3))?.lastSyncStatus).toBe('ready');
  expect(app.busy).toBe(false);
  app.forgetToken();
});

it.each(['success', 'cancel', 'failure'])(
  'bounds repository concurrency and drains workers (%s)',
  async (mode) => {
    const cancel = mode === 'cancel';
    for (const id of [1, 2, 3, 4, 5]) {
      const repo: Repository = {
        id,
        fullName: `owner/repo${id}`,
        visibility: 'public',
        defaultBranch: 'main',
        lastSyncStatus: 'never',
      };
      await repositories.save(repo);
      await repositories.beginSnapshot(repo, `old-${id}`);
      await repositories.activate(repo, `old-${id}`, []);
    }
    const app = createAppState();
    await app.init();
    app.setToken('test-token');
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const signals: AbortSignal[] = [];
    const sync = vi
      .spyOn(GraphQLSource.prototype, 'createSnapshot')
      .mockImplementation(async (repo, options, _progress, signal) => {
        signals.push(signal);
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => release.push(resolve));
        active--;
        if (mode === 'failure' && repo.id === 1)
          throw new Error('Download failed');
        return {
          snapshot: {
            id: options.snapshotId!,
            repositoryId: repo.id,
            state: 'complete',
            schemaVersion: 1,
            profile: 'core',
            source: 'github-graphql',
            completeness: { core: true },
            count: 0,
            startedAt: new Date().toISOString(),
            scope: options.scope!,
            historyComplete: false,
          },
          pullRequests: [],
        };
      });
    const refresh = app.refresh();
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(3));
    expect(app.busy).toBe(true);
    if (cancel) {
      app.cancel();
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    }
    release.splice(0).forEach((resolve) => resolve());
    if (!cancel) {
      await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(5));
      release.splice(0).forEach((resolve) => resolve());
    }
    await refresh;
    expect(peak).toBe(3);
    expect(app.busy).toBe(false);
    expect(await db.snapshots.where('state').equals('building').count()).toBe(
      0,
    );
    for (const id of [1, 2, 3, 4, 5]) {
      const repo = (await repositories.get(id))!;
      if (cancel || (mode === 'failure' && id === 1))
        expect(repo.activeSnapshotId).toBe(`old-${id}`);
      else expect(repo.activeSnapshotId).not.toBe(`old-${id}`);
    }
    app.forgetToken();
  },
);

it('requires credentials before refreshing a multi-repository selection', async () => {
  const repos: Repository[] = [1, 2, 3].map((id) => ({
    id,
    fullName: `owner/repo${id}`,
    visibility: 'public',
    defaultBranch: 'main',
    lastSyncStatus: 'never',
  }));
  for (const repo of repos) await repositories.save(repo);
  const app = createAppState();
  await app.init();
  app.setToken('test-token');
  await app.toggleRepository(repos[1]);
  const sync = vi.spyOn(await import('../github/graphql'), 'GraphQLSource');
  // Missing credentials must not start any repository downloads.
  app.forgetToken();
  await app.refresh();
  expect(sync).not.toHaveBeenCalled();
  expect(app.status).toContain('provide a token');
  expect(app.selectedRepositories.map((repo) => repo.id).sort()).toEqual([
    1, 3,
  ]);
});

it('creates a saved filter and saves every edit immediately', async () => {
  const app = createAppState();
  await app.init();

  expect(app.activeFilter?.name).toBe('My filter');
  expect(app.filters).toHaveLength(1);
  const savedId = app.activeFilter!.id;

  app.source = 'state = "open"';
  await app.renameFilter('Open pull requests');

  await vi.waitFor(async () => {
    const saved = await filters.get(savedId);
    expect(saved?.source).toBe('state = "open"');
    expect(saved?.name).toBe('Open pull requests');
  });

  await app.newFilter('Review queue');
  await app.selectFilter(savedId);
  expect(app.activeFilter?.name).toBe('Open pull requests');
  expect(app.source).toBe('state = "open"');
});

it('trims a filter name in one explicit rename', async () => {
  const app = createAppState();
  await app.init();
  const savedId = app.activeFilter!.id;

  await app.renameFilter('Open pull requests ');

  expect((await filters.get(savedId))?.name).toBe('Open pull requests');
  expect(app.activeFilter?.name).toBe('Open pull requests');
});

it('keeps the latest filter selection while a draft save finishes', async () => {
  const app = createAppState();
  await app.init();
  const originalId = app.activeFilter!.id;
  await app.newFilter('First');
  const firstId = app.activeFilter!.id;
  await app.newFilter('Second');
  const secondId = app.activeFilter!.id;
  await app.selectFilter(originalId);

  const saveDraft = filters.saveDraft.bind(filters);
  let releaseSave!: () => void;
  const saveReleased = new Promise<void>((resolve) => (releaseSave = resolve));
  let markSaveStarted!: () => void;
  const saveStarted = new Promise<void>(
    (resolve) => (markSaveStarted = resolve),
  );
  vi.spyOn(filters, 'saveDraft').mockImplementation(async (...args) => {
    markSaveStarted();
    await saveReleased;
    return saveDraft(...args);
  });

  app.source = 'state = "open"';
  await saveStarted;
  const firstSelection = app.selectFilter(firstId);
  const secondSelection = app.selectFilter(secondId);
  releaseSave();
  await Promise.all([firstSelection, secondSelection]);

  expect(app.activeFilter?.id).toBe(secondId);
  expect(app.activeFilter?.name).toBe('Second');
});

it('waits for an in-flight draft save before duplicating a filter', async () => {
  const app = createAppState();
  await app.init();
  await app.newFilter('Review queue');

  const saveDraft = filters.saveDraft.bind(filters);
  let releaseSave!: () => void;
  const saveReleased = new Promise<void>((resolve) => (releaseSave = resolve));
  let markSaveStarted!: () => void;
  const saveStarted = new Promise<void>(
    (resolve) => (markSaveStarted = resolve),
  );
  vi.spyOn(filters, 'saveDraft').mockImplementation(async (...args) => {
    markSaveStarted();
    await saveReleased;
    return saveDraft(...args);
  });

  app.source = 'state = "merged"';
  await saveStarted;

  let duplicateFinished = false;
  const duplicate = app.duplicateFilter().then(() => {
    duplicateFinished = true;
  });
  await Promise.resolve();
  expect(duplicateFinished).toBe(false);

  releaseSave();
  await duplicate;
  expect(app.source).toBe('state = "merged"');
  expect(app.activeFilter?.name).toBe('Review queue copy');
  expect(app.activeFilter?.source).toBe('state = "merged"');
});
