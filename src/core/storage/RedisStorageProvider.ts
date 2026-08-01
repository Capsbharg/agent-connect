import type { Redis } from 'ioredis';
import type { StorageProvider } from '../../interfaces/StorageProvider.js';
import type { Logger } from '../logger/Logger.js';
import { createRedisConnection } from './createRedisConnection.js';

/** JSON-over-Redis StorageProvider. Used for ProjectSession in production. */
export class RedisStorageProvider implements StorageProvider {
  private readonly redis: Redis;

  constructor(redisUrl: string, logger: Logger) {
    this.redis = createRedisConnection(redisUrl, logger);
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  }

  async set<T = unknown>(key: string, value: T, opts?: { ttlMs?: number }): Promise<void> {
    const raw = JSON.stringify(value);
    if (opts?.ttlMs) {
      await this.redis.set(key, raw, 'PX', opts.ttlMs);
    } else {
      await this.redis.set(key, raw);
    }
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /** Used by AgentConnect.start() to fail fast with a clear error if Redis is unreachable. */
  async ping(): Promise<void> {
    await this.redis.ping();
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
