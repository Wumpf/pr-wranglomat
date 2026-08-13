import { db, type StoredPageCache } from './db';
import type { PageCache, CachedPage } from '../ingestion/source';

export function pageCacheFor(repositoryId: number): PageCache & {
  clear(): Promise<void>;
} {
  return {
    async get(key) {
      const page = await db.pageCache.get(key);
      return page
        ? {
            key: page.key,
            etag: page.etag,
            rows: page.rows,
            updatedAt: page.updatedAt,
            next: page.next,
            last: page.last,
            totalPages: page.totalPages,
          }
        : undefined;
    },
    async set(page: CachedPage) {
      const parts = page.key.split('|');
      const value: StoredPageCache = {
        ...page,
        repositoryId,
        stream: parts.slice(1, -1).join('|'),
        page: parts.at(-1) ?? '',
      };
      await db.pageCache.put(value);
    },
    async clear() {
      await db.pageCache.where('repositoryId').equals(repositoryId).delete();
    },
  };
}

export const pageCache = {
  forRepository: pageCacheFor,
  clearAll: () => db.pageCache.clear(),
};
