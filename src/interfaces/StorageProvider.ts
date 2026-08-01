/**
 * Minimal JSON key-value store. ProjectSession (per-user active project/agent)
 * is built on this instead of talking to Redis directly, so it works the same
 * way against RedisStorageProvider or InMemoryStorageProvider.
 */
export interface StorageProvider {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, opts?: { ttlMs?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  close(): Promise<void>;
}
