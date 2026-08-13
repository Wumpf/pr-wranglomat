import { db, storageChanges, type StoredFilter } from './db';
import { parse } from '../query/parser';
const MAX_EXPORT = 1_000_000;
export const filters = {
  async list() {
    const values = await db.filters.orderBy('updatedAt').reverse().toArray();
    return values.sort(
      (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)),
    );
  },
  get: (id: string) => db.filters.get(id),
  async save(filter: StoredFilter) {
    const name = filter.name.trim();
    if (!name) throw new Error('Filter name cannot be empty.');
    const value = await db.filters.put({
      ...filter,
      name,
      nameKey: name.toLocaleLowerCase(),
    });
    storageChanges?.postMessage({ type: 'filters-changed' });
    return value;
  },
  async saveDraft(
    id: string,
    source: string,
    lastValidAst: StoredFilter['lastValidAst'],
    revision: number,
  ) {
    let saved: StoredFilter | undefined;
    await db.transaction('rw', db.filters, async () => {
      const current = await db.filters.get(id);
      if (!current || (current.sourceRevision ?? 0) > revision) return;
      saved = {
        ...current,
        source,
        lastValidAst,
        sourceRevision: revision,
        updatedAt: new Date().toISOString(),
      };
      await db.filters.put(saved);
    });
    if (saved) storageChanges?.postMessage({ type: 'filters-changed' });
    return saved;
  },
  async saveName(id: string, nameValue: string, revision: number) {
    const name = nameValue.trim();
    if (!name) throw new Error('Filter name cannot be empty.');
    let saved: StoredFilter | undefined;
    await db.transaction('rw', db.filters, async () => {
      const current = await db.filters.get(id);
      if (!current || (current.nameRevision ?? 0) > revision) return;
      saved = {
        ...current,
        name,
        nameKey: name.toLocaleLowerCase(),
        nameRevision: revision,
        updatedAt: new Date().toISOString(),
      };
      await db.filters.put(saved);
    });
    if (saved) storageChanges?.postMessage({ type: 'filters-changed' });
    return saved;
  },
  remove: (id: string) =>
    db.filters.delete(id).then((value) => {
      storageChanges?.postMessage({ type: 'filters-changed' });
      return value;
    }),
  async create(name = 'Untitled filter', source = '') {
    const now = new Date().toISOString();
    const trimmed = name.trim();
    const filter: StoredFilter = {
      id: crypto.randomUUID(),
      name: trimmed,
      nameKey: trimmed.toLocaleLowerCase(),
      source,
      languageVersion: 1,
      repositoryScope: 'all',
      createdAt: now,
      updatedAt: now,
    };
    await this.save(filter);
    return filter;
  },
  export(filtersToExport: StoredFilter[]) {
    return JSON.stringify(
      {
        version: 1,
        filters: filtersToExport.map(
          ({ name, source, languageVersion, repositoryScope, pinned }) => ({
            name,
            source,
            languageVersion,
            repositoryScope,
            pinned,
          }),
        ),
      },
      null,
      2,
    );
  },
  async import(source: string) {
    if (source.length > MAX_EXPORT)
      throw new Error('Filter export is too large.');
    const payload: unknown = JSON.parse(source);
    if (
      !payload ||
      typeof payload !== 'object' ||
      (payload as { version?: unknown }).version !== 1 ||
      !Array.isArray((payload as { filters?: unknown }).filters)
    )
      throw new Error('Unsupported filter export.');
    const incoming = (payload as { filters: unknown[] }).filters;
    const prepared: StoredFilter[] = [];
    const names = new Set((await this.list()).map((x) => x.nameKey));
    for (const item of incoming) {
      if (!item || typeof item !== 'object')
        throw new Error('Invalid filter export.');
      const filter = item as Partial<StoredFilter>;
      if (
        typeof filter.name !== 'string' ||
        typeof filter.source !== 'string' ||
        !filter.name.trim()
      )
        throw new Error('Invalid filter export.');
      if (names.has(filter.name.trim().toLocaleLowerCase()))
        throw new Error(`Duplicate filter name: ${filter.name}`);
      const parsed = parse(filter.source);
      if (parsed.diagnostics.length)
        throw new Error(`Invalid filter '${filter.name}'.`);
      const now = new Date().toISOString();
      const name = filter.name.trim();
      names.add(name.toLocaleLowerCase());
      prepared.push({
        id: crypto.randomUUID(),
        name,
        nameKey: name.toLocaleLowerCase(),
        source: filter.source,
        lastValidAst: parsed.filter,
        languageVersion: 1,
        repositoryScope: filter.repositoryScope ?? 'all',
        createdAt: now,
        updatedAt: now,
        pinned: Boolean(filter.pinned),
      });
    }
    await db.transaction('rw', db.filters, async () => {
      for (const filter of prepared) await db.filters.add(filter);
    });
    storageChanges?.postMessage({ type: 'filters-changed' });
  },
};
