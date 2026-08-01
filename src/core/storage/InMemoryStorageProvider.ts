import type { StorageProvider } from '../../interfaces/StorageProvider.js';

interface Entry {
  value: unknown;
  expiresAt?: number;
}

/** Zero-dependency StorageProvider for local dev / tests. Not shared across processes. */
export class InMemoryStorageProvider implements StorageProvider {
  private readonly store = new Map<string, Entry>();

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T = unknown>(key: string, value: T, opts?: { ttlMs?: number }): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: opts?.ttlMs ? Date.now() + opts.ttlMs : undefined,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}
