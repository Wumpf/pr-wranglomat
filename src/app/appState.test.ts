import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../storage/db';
import { filters } from '../storage/filters';
import { createAppState } from './appState.svelte';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('creates a saved filter and saves every edit immediately', async () => {
  const app = createAppState();
  await app.init();

  expect(app.activeFilter?.name).toBe('My filter');
  expect(app.filters).toHaveLength(1);
  const savedId = app.activeFilter!.id;

  app.source = 'state = "open"';
  app.renameFilter('Open pull requests');

  await vi.waitFor(async () => {
    const saved = await filters.get(savedId);
    expect(saved?.source).toBe('state = "open"');
    expect(saved?.name).toBe('Open pull requests');
  });

  await app.newFilter('Review queue');
  await app.selectFilter(savedId);
  expect(app.filterName).toBe('Open pull requests');
  expect(app.source).toBe('state = "open"');
});

it('keeps a typed trailing space while saving a filter name', async () => {
  const app = createAppState();
  await app.init();
  const savedId = app.activeFilter!.id;

  app.renameFilter('Open ');

  await vi.waitFor(async () => {
    expect((await filters.get(savedId))?.name).toBe('Open');
  });
  expect(app.filterName).toBe('Open ');

  app.renameFilter('Open pull requests');
  await vi.waitFor(async () => {
    expect((await filters.get(savedId))?.name).toBe('Open pull requests');
  });
  expect(app.filterName).toBe('Open pull requests');
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
