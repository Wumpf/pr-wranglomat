import { db, storageChanges } from './db';
export const settings = {
  async get<T>(key: string, fallback: T): Promise<T> {
    return ((await db.settings.get(key))?.value as T) ?? fallback;
  },
  async set(key: string, value: unknown) {
    await db.settings.put({ key, value });
    storageChanges?.postMessage({ type: 'settings-changed', key });
  },
  async remove(key: string) {
    await db.settings.delete(key);
    storageChanges?.postMessage({ type: 'settings-changed', key });
  },
};
