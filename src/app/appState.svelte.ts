/* eslint-disable svelte/prefer-svelte-reactivity */
import type { PullRequest } from '../domain/pullRequest';
import type { Repository } from '../domain/repository';
import type { StoredFilter } from '../storage/db';
import { repositories } from '../storage/repositories';
import { filters } from '../storage/filters';
import { settings } from '../storage/settings';
import { parse } from '../query/parser';
import { evaluate } from '../query/evaluate';
import { auth } from '../github/auth';
import { GitHubSource } from '../github/sync';
import { AppError } from '../domain/errors';
import { storageChanges } from '../storage/db';
export function createAppState() {
  let repos = $state<Repository[]>([]);
  let selected = $state<Repository | undefined>();
  let rows = $state<PullRequest[]>([]);
  let savedFilters = $state<StoredFilter[]>([]);
  let activeFilter = $state<StoredFilter | undefined>();
  let source = $state('');
  let diagnostics = $state<string[]>([]);
  let diagnosticDetails = $state<
    { message: string; line?: number; column?: number }[]
  >([]);
  let result = $state<PullRequest[]>([]);
  let unknown = $state(0);
  let unavailableFields = $state<string[]>([]);
  let page = $state(1);
  const pageSize = 50;
  let status = $state('Ready for a repository.');
  let busy = $state(false);
  let saveState = $state('Saved');
  let controller: AbortController | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let nameTimer: ReturnType<typeof setTimeout> | undefined;
  const sourceRevisions = new Map<string, number>();
  const nameRevisions = new Map<string, number>();
  let online = $state(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  let authIdentity = $state<
    | { login: string; rateLimitRemaining?: number; rateLimitResetAt?: string }
    | undefined
  >();
  let generation = 0;
  const apply = () => {
    const parsed = parse(source);
    diagnosticDetails = parsed.diagnostics;
    diagnostics = parsed.diagnostics.map(
      (x) =>
        `${x.line ? `Line ${x.line}, column ${x.column}: ` : ''}${x.message}`,
    );
    const compiled = parsed.filter ?? activeFilter?.lastValidAst;
    if (compiled) {
      const evaluated = evaluate(compiled, rows);
      result = evaluated.rows;
      unknown = evaluated.unknown;
      unavailableFields = evaluated.unavailableFields;
    } else {
      result = rows;
      unknown = 0;
      unavailableFields = [];
    }
    page = 1;
  };
  const scheduleSave = () => {
    if (!activeFilter) return;
    saveState = 'Saving';
    if (saveTimer) clearTimeout(saveTimer);
    const filterId = activeFilter.id;
    const draft = source;
    const revision = (sourceRevisions.get(filterId) ?? 0) + 1;
    sourceRevisions.set(filterId, revision);
    saveTimer = setTimeout(async () => {
      const stored = await filters.get(filterId);
      if (!stored || sourceRevisions.get(filterId) !== revision) return;
      const parsed = parse(draft);
      try {
        const next = await filters.saveDraft(
          filterId,
          draft,
          parsed.filter ?? stored.lastValidAst,
          revision,
        );
        if (!next || sourceRevisions.get(filterId) !== revision) return;
        if (activeFilter?.id === filterId) activeFilter = next;
        savedFilters = await filters.list();
        if (activeFilter?.id === filterId)
          saveState = parsed.diagnostics.length ? 'Invalid draft' : 'Saved';
      } catch {
        saveState = 'Storage error';
      }
    }, 600);
  };
  return {
    get repos() {
      return repos;
    },
    get selected() {
      return selected;
    },
    get rows() {
      return rows;
    },
    get result() {
      return result;
    },
    get filters() {
      return savedFilters;
    },
    get activeFilter() {
      return activeFilter;
    },
    get source() {
      return source;
    },
    set source(value: string) {
      source = value;
      apply();
      scheduleSave();
    },
    get diagnostics() {
      return diagnostics;
    },
    get diagnosticDetails() {
      return diagnosticDetails;
    },
    get unknown() {
      return unknown;
    },
    get unavailableFields() {
      return unavailableFields;
    },
    get page() {
      return page;
    },
    get pageSize() {
      return pageSize;
    },
    get totalPages() {
      return Math.max(1, Math.ceil(result.length / pageSize));
    },
    get pagedResult() {
      return result.slice((page - 1) * pageSize, page * pageSize);
    },
    setPage(value: number) {
      page = Math.max(
        1,
        Math.min(Math.max(1, Math.ceil(result.length / pageSize)), value),
      );
    },
    get status() {
      return status;
    },
    get busy() {
      return busy;
    },
    get saveState() {
      return saveState;
    },
    get configured() {
      return auth.configured;
    },
    get online() {
      return online;
    },
    get authIdentity() {
      return authIdentity;
    },
    async validateToken() {
      authIdentity = await auth.validate();
      status = `Authenticated as ${authIdentity.login} · ${authIdentity.rateLimitRemaining ?? 'unknown'} requests remaining`;
    },
    async init() {
      online = typeof navigator === 'undefined' ? true : navigator.onLine;
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => (online = true));
        window.addEventListener('offline', () => (online = false));
      }
      storageChanges?.addEventListener('message', async () => {
        repos = await repositories.list();
        savedFilters = await filters.list();
        if (selected) {
          selected = repos.find((repo) => repo.id === selected?.id);
          rows = selected ? await repositories.activeRows(selected.id) : [];
        }
        if (activeFilter) {
          activeFilter =
            savedFilters.find((filter) => filter.id === activeFilter?.id) ??
            savedFilters[0];
          source = activeFilter?.source ?? '';
        }
        apply();
      });
      repos = await repositories.list();
      savedFilters = await filters.list();
      for (const filter of savedFilters) {
        sourceRevisions.set(filter.id, filter.sourceRevision ?? 0);
        nameRevisions.set(filter.id, filter.nameRevision ?? 0);
      }
      const activeId = await settings.get<string | undefined>(
        'activeFilter',
        undefined,
      );
      activeFilter =
        savedFilters.find((x) => x.id === activeId) ?? savedFilters[0];
      source = activeFilter?.source ?? '';
      const selectedId = await settings.get<number | undefined>(
        'selectedRepository',
        undefined,
      );
      selected = repos.find((x) => x.id === selectedId) ?? repos[0];
      if (selected) {
        rows = await repositories.activeRows(selected.id);
        await settings.set('selectedRepository', selected.id);
      }
      if (activeFilter) await settings.set('activeFilter', activeFilter.id);
      apply();
    },
    setToken(value: string) {
      auth.setToken(value);
      authIdentity = undefined;
    },
    forgetToken() {
      auth.forget();
      authIdentity = undefined;
      status = 'Token forgotten. Cached data remains on this device.';
    },
    async addRepository(input: string) {
      if (!auth.credential) throw new Error('Paste a GitHub token first.');
      busy = true;
      status = 'Resolving repository…';
      try {
        const repo = await new GitHubSource(
          undefined,
          auth.credential,
        ).resolveRepository(input, auth.credential);
        await repositories.save(repo);
        repos = await repositories.list();
        selected = repo;
        rows = await repositories.activeRows(repo.id);
        await settings.set('selectedRepository', repo.id);
        status = `${repo.fullName} added. Refresh to download pull requests.`;
      } finally {
        busy = false;
      }
    },
    async refresh() {
      if (!selected || !auth.credential) {
        status = 'Add a repository and provide a token first.';
        return;
      }
      const run = ++generation;
      busy = true;
      controller = new AbortController();
      status = 'Refreshing…';
      const repoAtStart = selected;
      const snapshotId = crypto.randomUUID();
      try {
        await repositories.beginSnapshot(repoAtStart, snapshotId);
        const synced = await new GitHubSource(
          undefined,
          auth.credential,
        ).createSnapshot(
          repoAtStart,
          {
            snapshotId,
            onPage: (pageRows) =>
              repositories.stageRows(repoAtStart.id, snapshotId, pageRows),
          },
          (progress) => {
            status = `${progress.status} (${progress.count} pull requests${progress.rateLimitRemaining === undefined ? '' : ` · ${progress.rateLimitRemaining} requests remaining`})`;
          },
          controller!.signal,
        );
        if (run !== generation) {
          await repositories.discardSnapshot(
            repoAtStart,
            snapshotId,
            'cancelled',
          );
          return;
        }
        const latest = await repositories.get(repoAtStart.id);
        if (
          !latest ||
          latest.activeSnapshotId !== repoAtStart.activeSnapshotId
        ) {
          await repositories.discardSnapshot(
            repoAtStart,
            snapshotId,
            'cancelled',
          );
          return;
        }
        const activated = await repositories.activate(
          repoAtStart,
          synced.snapshot.id,
          synced.pullRequests,
          synced.snapshot,
        );
        if (!activated) {
          await repositories.discardSnapshot(
            repoAtStart,
            snapshotId,
            'cancelled',
          );
          return;
        }
        repos = await repositories.list();
        selected = repos.find((x) => x.id === selected?.id);
        rows = synced.pullRequests;
        apply();
        status = `Ready · ${rows.length} pull requests`;
      } catch (error) {
        const syncStatus =
          error instanceof AppError && error.code === 'cancelled'
            ? 'cancelled'
            : error instanceof AppError && error.code === 'forbidden'
              ? 'forbidden'
              : error instanceof AppError && error.code === 'rate-limited'
                ? 'rate-limited'
                : 'error';
        await repositories.discardSnapshot(
          repoAtStart,
          snapshotId,
          syncStatus,
          error instanceof Error ? error.message : 'Refresh failed.',
        );
        if (run === generation)
          status = error instanceof Error ? error.message : 'Refresh failed.';
      } finally {
        if (run === generation) {
          busy = false;
          controller = undefined;
        }
      }
    },
    cancel() {
      generation++;
      controller?.abort();
      controller = undefined;
      busy = false;
      status = 'Refresh cancelled; previous snapshot remains active.';
    },
    async select(repo: Repository) {
      selected = repo;
      await settings.set('selectedRepository', repo.id);
      rows = await repositories.activeRows(repo.id);
      apply();
    },
    async selectFilter(id: string) {
      const chosen = savedFilters.find((item) => item.id === id);
      if (!chosen) return;
      activeFilter = chosen;
      source = chosen.source;
      await settings.set('activeFilter', chosen.id);
      apply();
    },
    async saveFilter() {
      const parsed = parse(source);
      if (!activeFilter)
        activeFilter = await filters.create('My filter', source);
      else {
        const revision = (sourceRevisions.get(activeFilter.id) ?? 0) + 1;
        sourceRevisions.set(activeFilter.id, revision);
        activeFilter =
          (await filters.saveDraft(
            activeFilter.id,
            source,
            parsed.filter ?? activeFilter.lastValidAst,
            revision,
          )) ?? activeFilter;
      }
      savedFilters = await filters.list();
      await settings.set('activeFilter', activeFilter.id);
      saveState = parsed.diagnostics.length ? 'Invalid draft' : 'Saved';
      apply();
    },
    async newFilter(name = 'New filter') {
      const created = await filters.create(
        nextAvailableName(name, savedFilters),
      );
      activeFilter = created;
      source = '';
      savedFilters = await filters.list();
      await settings.set('activeFilter', created.id);
      apply();
    },
    renameFilter(name: string) {
      if (!activeFilter) return;
      saveState = 'Saving';
      if (nameTimer) clearTimeout(nameTimer);
      const filterId = activeFilter.id;
      const revision = (nameRevisions.get(filterId) ?? 0) + 1;
      nameRevisions.set(filterId, revision);
      nameTimer = setTimeout(async () => {
        if (nameRevisions.get(filterId) !== revision) return;
        try {
          const next = await filters.saveName(filterId, name, revision);
          if (!next || nameRevisions.get(filterId) !== revision) return;
          if (activeFilter?.id === filterId) activeFilter = next;
          savedFilters = await filters.list();
          if (activeFilter?.id === filterId) saveState = 'Saved';
        } catch {
          saveState = 'Storage error';
        }
      }, 600);
    },
    async duplicateFilter() {
      if (!activeFilter) return;
      const original = activeFilter;
      const name = nextAvailableName(`${original.name} copy`, savedFilters);
      const created = await filters.create(name, original.source);
      const parsed = parse(original.source);
      activeFilter = {
        ...created,
        lastValidAst: parsed.filter ?? original.lastValidAst,
      };
      await filters.save(activeFilter);
      source = original.source;
      savedFilters = await filters.list();
      await settings.set('activeFilter', activeFilter.id);
      apply();
    },
    async togglePinned() {
      if (!activeFilter) return;
      activeFilter = { ...activeFilter, pinned: !activeFilter.pinned };
      await filters.save(activeFilter);
      savedFilters = await filters.list();
    },
    async deleteFilter() {
      if (!activeFilter) return;
      const deleted = activeFilter;
      await filters.remove(deleted.id);
      savedFilters = await filters.list();
      activeFilter = savedFilters[0];
      source = activeFilter?.source ?? '';
      if (activeFilter) await settings.set('activeFilter', activeFilter.id);
      apply();
      return deleted;
    },
    async restoreFilter(filter: StoredFilter | undefined) {
      if (!filter) return;
      await filters.save(filter);
      savedFilters = await filters.list();
      activeFilter = filter;
      source = filter.source;
      await settings.set('activeFilter', filter.id);
      apply();
    },
    exportFilters() {
      return filters.export(savedFilters);
    },
    async importFilters(value: string) {
      await filters.import(value);
      savedFilters = await filters.list();
      activeFilter = savedFilters[0];
      source = activeFilter?.source ?? '';
      if (activeFilter) await settings.set('activeFilter', activeFilter.id);
      apply();
    },
    async removeRepository(id: number) {
      if (id === selected?.id) {
        generation++;
        controller?.abort();
      }
      await repositories.clear(id);
      repos = await repositories.list();
      selected = repos[0];
      if (selected) await settings.set('selectedRepository', selected.id);
      else await settings.remove('selectedRepository');
      rows = selected ? await repositories.activeRows(selected.id) : [];
      apply();
    },
    async clearRepositoryData(id: number) {
      if (id === selected?.id) {
        generation++;
        controller?.abort();
        controller = undefined;
        busy = false;
      }
      await repositories.clearSnapshotData(id);
      if (selected?.id === id) {
        rows = [];
        apply();
      }
      repos = await repositories.list();
    },
    async clearData() {
      generation++;
      controller?.abort();
      controller = undefined;
      busy = false;
      if (saveTimer) clearTimeout(saveTimer);
      if (nameTimer) clearTimeout(nameTimer);
      await repositories.clear();
      repos = [];
      selected = undefined;
      rows = [];
      result = [];
      savedFilters = [];
      activeFilter = undefined;
      source = '';
      diagnostics = [];
      diagnosticDetails = [];
      unknown = 0;
      unavailableFields = [];
      page = 1;
      status = 'All local data deleted. The in-memory token was not changed.';
    },
  };
}

function nextAvailableName(base: string, existing: StoredFilter[]): string {
  const keys = new Set(existing.map((filter) => filter.nameKey));
  if (!keys.has(base.trim().toLocaleLowerCase())) return base;
  let suffix = 2;
  while (keys.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix++;
  return `${base} ${suffix}`;
}
