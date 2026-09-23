import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../storage/db';
import { filters } from '../storage/filters';
import { createAppState } from './appState.svelte';
import { repositories } from '../storage/repositories';
import type { Repository } from '../domain/repository';
import { normalizePullRequest } from '../domain/normalize';

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
  await app.setTransport('graphql');
  for (const id of [1, 3]) {
    expect(await repositories.get(id)).toMatchObject({
      snapshotScope: { kind: 'complete' },
      ingestionTransport: 'graphql',
    });
  }
  expect((await repositories.get(2))?.snapshotScope).toBeUndefined();
  expect((await repositories.get(2))?.ingestionTransport).toBeUndefined();
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
  const sync = vi.spyOn(await import('../github/sync'), 'GitHubSource');
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
