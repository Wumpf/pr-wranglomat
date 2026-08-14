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
import { GraphQLSource } from '../github/graphql';
import { AppError } from '../domain/errors';
import { storageChanges } from '../storage/db';
import type { IngestionTransport, SnapshotScope } from '../domain/snapshot';
import { formatDiagnosticLocation } from './diagnostics';
import { pageCache } from '../storage/pageCache';
export function createAppState() {
  let repos = $state<Repository[]>([]);
  let selected = $state<Repository | undefined>();
  let rows = $state<PullRequest[]>([]);
  let savedFilters = $state<StoredFilter[]>([]);
  let activeFilter = $state<StoredFilter | undefined>();
  let filterName = $state('');
  let source = $state('');
  let temporarySource = $state('');
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
  let sourceSavePromise: Promise<boolean> | undefined;
  let nameSavePromise: Promise<boolean> | undefined;
  const sourceRevisions = new Map<string, number>();
  const nameRevisions = new Map<string, number>();
  let online = $state(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  let snapshotScope = $state<SnapshotScope>({ kind: 'open' });
  let recentCutoffDays = $state(90);
  let transport = $state<IngestionTransport>('rest');
  let activeSnapshotScope = $state<SnapshotScope | undefined>();
  let authIdentity = $state<
    | { login: string; rateLimitRemaining?: number; rateLimitResetAt?: string }
    | undefined
  >();
  let generation = 0;
  let selectionGeneration = 0;
  let preferenceRevision = 0;
  const apply = () => {
    const parsed = parse(source);
    diagnosticDetails = parsed.diagnostics;
    const multiline = source.includes('\n');
    diagnostics = parsed.diagnostics.map((diagnostic) => {
      const location = formatDiagnosticLocation(diagnostic, multiline);
      return `${location ? `${location}: ` : ''}${diagnostic.message}`;
    });
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
    if (!activeFilter) {
      saveState = 'Not saved';
      return;
    }
    saveState = 'Saving';
    if (saveTimer) clearTimeout(saveTimer);
    const filterId = activeFilter.id;
    const draft = source;
    const revision = (sourceRevisions.get(filterId) ?? 0) + 1;
    sourceRevisions.set(filterId, revision);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      const pending = (async () => {
        try {
          const stored = await filters.get(filterId);
          if (!stored || sourceRevisions.get(filterId) !== revision)
            return true;
          const parsed = parse(draft);
          const next = await filters.saveDraft(
            filterId,
            draft,
            parsed.filter ?? stored.lastValidAst,
            revision,
          );
          if (!next || sourceRevisions.get(filterId) !== revision) return true;
          if (activeFilter?.id === filterId) activeFilter = next;
          savedFilters = await filters.list();
          if (activeFilter?.id === filterId)
            saveState = parsed.diagnostics.length ? 'Invalid draft' : 'Saved';
          return true;
        } catch {
          if (activeFilter?.id === filterId) saveState = 'Storage error';
          return false;
        }
      })();
      sourceSavePromise = pending;
      void pending.finally(() => {
        if (sourceSavePromise === pending) sourceSavePromise = undefined;
      });
    }, 600);
  };
  const flushPendingEdits = async () => {
    const current = activeFilter;
    if (!current) return true;
    const saveSource = Boolean(saveTimer);
    const saveName = Boolean(nameTimer);
    if (saveTimer) clearTimeout(saveTimer);
    if (nameTimer) clearTimeout(nameTimer);
    saveTimer = undefined;
    nameTimer = undefined;
    try {
      const pendingWrites = [sourceSavePromise, nameSavePromise].filter(
        (pending): pending is Promise<boolean> => Boolean(pending),
      );
      if (pendingWrites.length) {
        const results = await Promise.all(pendingWrites);
        if (results.includes(false)) return false;
      }
      let next = (await filters.get(current.id)) ?? current;
      if (saveSource) {
        const revision = sourceRevisions.get(current.id) ?? 0;
        const parsed = parse(source);
        next =
          (await filters.saveDraft(
            current.id,
            source,
            parsed.filter ?? next.lastValidAst,
            revision,
          )) ?? next;
      }
      if (saveName) {
        const revision = nameRevisions.get(current.id) ?? 0;
        next =
          (await filters.saveName(current.id, filterName, revision)) ?? next;
      }
      if (saveSource || saveName || pendingWrites.length)
        savedFilters = await filters.list();
      if (activeFilter?.id === current.id) {
        activeFilter = next;
        filterName = next.name;
        saveState = diagnostics.length ? 'Invalid draft' : 'Saved';
      }
      return true;
    } catch {
      if (activeFilter?.id === current.id) saveState = 'Storage error';
      return false;
    }
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
    get filterName() {
      return filterName;
    },
    get source() {
      return source;
    },
    set source(value: string) {
      source = value;
      if (!activeFilter) temporarySource = value;
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
    get snapshotScope() {
      return snapshotScope;
    },
    get transport() {
      return transport;
    },
    get recentCutoffDays() {
      return recentCutoffDays;
    },
    get historyWarning() {
      return activeSnapshotScope && activeSnapshotScope.kind !== 'complete'
        ? 'This snapshot omits some closed and merged pull requests. A zero-match result is not proof that historical PRs are absent.'
        : '';
    },
    async setSnapshotScope(scope: SnapshotScope) {
      snapshotScope = scope;
      if (scope.kind === 'recent') recentCutoffDays = scope.cutoffDays;
      if (selected) {
        const revision = ++preferenceRevision;
        selected = {
          ...selected,
          snapshotScope: scope,
          recentCutoffDays,
          preferenceRevision: revision,
        };
        repos = repos.map((repo) =>
          repo.id === selected?.id ? selected! : repo,
        );
        await repositories.savePreferences(selected.id, {
          snapshotScope: cloneScope(scope),
          ingestionTransport: transport,
          recentCutoffDays,
          preferenceRevision: revision,
        });
        if (revision === preferenceRevision)
          status = 'Download preferences saved.';
      }
    },
    async setRecentCutoff(days: number) {
      const safe = Math.max(1, Math.min(3650, Math.trunc(days) || 90));
      recentCutoffDays = safe;
      await this.setSnapshotScope({ kind: 'recent', cutoffDays: safe });
    },
    async setTransport(value: IngestionTransport) {
      transport = value;
      if (selected) {
        const revision = ++preferenceRevision;
        selected = {
          ...selected,
          ingestionTransport: value,
          preferenceRevision: revision,
        };
        repos = repos.map((repo) =>
          repo.id === selected?.id ? selected! : repo,
        );
        await repositories.savePreferences(selected.id, {
          snapshotScope: cloneScope(snapshotScope),
          ingestionTransport: value,
          recentCutoffDays,
          preferenceRevision: revision,
        });
        if (revision === preferenceRevision)
          status = 'Download preferences saved.';
      }
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
        const selectedId = selected?.id;
        const nextRepos = await repositories.list();
        const nextSelected = selectedId
          ? nextRepos.find((repo) => repo.id === selectedId)
          : undefined;
        const nextRows = nextSelected
          ? await repositories.activeRows(nextSelected.id)
          : [];
        if (selected?.id !== selectedId) return;
        repos = nextRepos;
        selected = nextSelected;
        rows = nextRows;
        if (nextSelected) {
          snapshotScope = nextSelected.snapshotScope ?? { kind: 'open' };
          recentCutoffDays =
            nextSelected.recentCutoffDays ??
            (nextSelected.snapshotScope?.kind === 'recent'
              ? nextSelected.snapshotScope.cutoffDays
              : 90);
          transport = nextSelected.ingestionTransport ?? 'rest';
          activeSnapshotScope = nextSelected.activeSnapshotScope;
          preferenceRevision = nextSelected.preferenceRevision ?? 0;
        } else {
          activeSnapshotScope = undefined;
        }
        savedFilters = await filters.list();
        if (activeFilter) {
          const activeId = activeFilter.id;
          const refreshed = savedFilters.find(
            (filter) => filter.id === activeId,
          );
          if (refreshed) {
            const keepSource = Boolean(saveTimer || sourceSavePromise);
            const keepName = Boolean(nameTimer || nameSavePromise);
            activeFilter = refreshed;
            if (!keepSource) source = refreshed.source;
            if (!keepName) filterName = refreshed.name;
          } else {
            activeFilter = savedFilters[0];
            source = activeFilter?.source ?? temporarySource;
            filterName = activeFilter?.name ?? '';
          }
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
        activeId === 'temporary'
          ? undefined
          : (savedFilters.find((x) => x.id === activeId) ?? savedFilters[0]);
      source = activeFilter?.source ?? temporarySource;
      filterName = activeFilter?.name ?? '';
      saveState = activeFilter ? 'Saved' : 'Not saved';
      const selectedId = await settings.get<number | undefined>(
        'selectedRepository',
        undefined,
      );
      selected = repos.find((x) => x.id === selectedId) ?? repos[0];
      if (selected?.snapshotScope) snapshotScope = selected.snapshotScope;
      recentCutoffDays =
        selected?.recentCutoffDays ??
        (selected?.snapshotScope?.kind === 'recent'
          ? selected.snapshotScope.cutoffDays
          : 90);
      if (selected?.ingestionTransport) transport = selected.ingestionTransport;
      activeSnapshotScope = selected?.activeSnapshotScope;
      preferenceRevision = selected?.preferenceRevision ?? 0;
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
      const scope = cloneScope(snapshotScope);
      const selectedTransport = transport;
      const snapshotId = crypto.randomUUID();
      try {
        await repositories.beginSnapshot(
          repoAtStart,
          snapshotId,
          scope,
          selectedTransport,
        );
        const source =
          selectedTransport === 'graphql'
            ? new GraphQLSource(undefined, undefined, auth.credential)
            : new GitHubSource(undefined, auth.credential);
        const synced = await source.createSnapshot(
          repoAtStart,
          {
            snapshotId,
            scope,
            transport: selectedTransport,
            concurrency: 4,
            cache:
              selectedTransport === 'rest'
                ? pageCache.forRepository(repoAtStart.id)
                : undefined,
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
        if (selected?.id !== repoAtStart.id) return;
        rows = synced.pullRequests;
        apply();
        activeSnapshotScope = scope;
        status = `Ready · ${rows.length} pull requests (${scopeLabel(scope)}, ${selectedTransport.toUpperCase()})`;
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
      const selection = ++selectionGeneration;
      selected = repo;
      snapshotScope = repo.snapshotScope ?? { kind: 'open' };
      recentCutoffDays =
        repo.recentCutoffDays ??
        (repo.snapshotScope?.kind === 'recent'
          ? repo.snapshotScope.cutoffDays
          : 90);
      transport = repo.ingestionTransport ?? 'rest';
      activeSnapshotScope = repo.activeSnapshotScope;
      preferenceRevision = repo.preferenceRevision ?? 0;
      await settings.set('selectedRepository', repo.id);
      const nextRows = await repositories.activeRows(repo.id);
      if (selection !== selectionGeneration || selected?.id !== repo.id) return;
      rows = nextRows;
      apply();
    },
    async selectFilter(id: string) {
      if (!(await flushPendingEdits())) return;
      if (!id) {
        activeFilter = undefined;
        filterName = '';
        source = temporarySource;
        saveState = 'Not saved';
        await settings.set('activeFilter', 'temporary');
        apply();
        return;
      }
      const chosen = savedFilters.find((item) => item.id === id);
      if (!chosen) return;
      activeFilter = chosen;
      filterName = chosen.name;
      source = chosen.source;
      saveState = parse(source).diagnostics.length ? 'Invalid draft' : 'Saved';
      await settings.set('activeFilter', chosen.id);
      apply();
    },
    async saveFilter() {
      const parsed = parse(source);
      if (!activeFilter) {
        activeFilter = await filters.create(
          nextAvailableName('My filter', savedFilters),
          source,
        );
        filterName = activeFilter.name;
      } else {
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
      if (!(await flushPendingEdits())) return;
      const created = await filters.create(
        nextAvailableName(name, savedFilters),
      );
      activeFilter = created;
      filterName = created.name;
      source = '';
      savedFilters = await filters.list();
      saveState = 'Saved';
      await settings.set('activeFilter', created.id);
      apply();
    },
    renameFilter(name: string) {
      if (!activeFilter) return;
      filterName = name;
      saveState = 'Saving';
      if (nameTimer) clearTimeout(nameTimer);
      const filterId = activeFilter.id;
      const revision = (nameRevisions.get(filterId) ?? 0) + 1;
      nameRevisions.set(filterId, revision);
      nameTimer = setTimeout(() => {
        nameTimer = undefined;
        const pending = (async () => {
          if (nameRevisions.get(filterId) !== revision) return true;
          try {
            const next = await filters.saveName(filterId, name, revision);
            if (!next || nameRevisions.get(filterId) !== revision) return true;
            if (activeFilter?.id === filterId) {
              activeFilter = next;
              filterName = next.name;
            }
            savedFilters = await filters.list();
            if (activeFilter?.id === filterId) saveState = 'Saved';
            return true;
          } catch {
            if (activeFilter?.id === filterId) saveState = 'Storage error';
            return false;
          }
        })();
        nameSavePromise = pending;
        void pending.finally(() => {
          if (nameSavePromise === pending) nameSavePromise = undefined;
        });
      }, 600);
    },
    async duplicateFilter() {
      if (!activeFilter) return;
      if (!(await flushPendingEdits())) return;
      const original = activeFilter;
      const name = nextAvailableName(`${original.name} copy`, savedFilters);
      const created = await filters.create(name, original.source);
      const parsed = parse(original.source);
      const duplicate = {
        ...created,
        lastValidAst:
          parsed.filter ??
          ($state.snapshot(original.lastValidAst as unknown) as
            StoredFilter['lastValidAst'] | undefined),
      };
      await filters.save(duplicate);
      activeFilter = duplicate;
      filterName = duplicate.name;
      source = original.source;
      savedFilters = await filters.list();
      await settings.set('activeFilter', activeFilter.id);
      apply();
    },
    async togglePinned() {
      if (!activeFilter) return;
      if (!(await flushPendingEdits())) return;
      activeFilter = { ...activeFilter, pinned: !activeFilter.pinned };
      await filters.save(activeFilter);
      savedFilters = await filters.list();
    },
    async deleteFilter() {
      if (!activeFilter) return;
      if (!(await flushPendingEdits())) return;
      const deleted = activeFilter;
      await filters.remove(deleted.id);
      savedFilters = await filters.list();
      activeFilter = savedFilters[0];
      filterName = activeFilter?.name ?? '';
      source = activeFilter?.source ?? temporarySource;
      saveState = activeFilter ? 'Saved' : 'Not saved';
      await settings.set('activeFilter', activeFilter?.id ?? 'temporary');
      apply();
      return deleted;
    },
    async restoreFilter(filter: StoredFilter | undefined) {
      if (!filter) return;
      await filters.save(filter);
      savedFilters = await filters.list();
      activeFilter = filter;
      filterName = filter.name;
      source = filter.source;
      saveState = parse(source).diagnostics.length ? 'Invalid draft' : 'Saved';
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
      filterName = activeFilter?.name ?? '';
      source = activeFilter?.source ?? temporarySource;
      saveState = activeFilter ? 'Saved' : 'Not saved';
      await settings.set('activeFilter', activeFilter?.id ?? 'temporary');
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
        activeSnapshotScope = undefined;
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
      filterName = '';
      temporarySource = '';
      source = '';
      saveState = 'Not saved';
      diagnostics = [];
      diagnosticDetails = [];
      unknown = 0;
      unavailableFields = [];
      page = 1;
      status = 'All local data deleted. The in-memory token was not changed.';
    },
  };
}

function cloneScope(scope: SnapshotScope): SnapshotScope {
  return scope.kind === 'recent'
    ? { kind: 'recent', cutoffDays: scope.cutoffDays }
    : { kind: scope.kind };
}
function scopeLabel(scope: SnapshotScope): string {
  if (scope.kind === 'open') return 'open PRs';
  if (scope.kind === 'complete') return 'complete history';
  return `open + closed (${scope.cutoffDays}d)`;
}
function nextAvailableName(base: string, existing: StoredFilter[]): string {
  const keys = new Set(existing.map((filter) => filter.nameKey));
  if (!keys.has(base.trim().toLocaleLowerCase())) return base;
  let suffix = 2;
  while (keys.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix++;
  return `${base} ${suffix}`;
}
