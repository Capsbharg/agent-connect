import IORedis from 'ioredis';
import type { Logger } from '../logger/Logger.js';

/**
 * BullMQ requires each Queue/Worker to own its own connection (sharing one
 * across blocking and non-blocking commands can deadlock), so this is a
 * factory, not a singleton. RedisStorageProvider gets its own connection too.
 */
export function createRedisConnection(redisUrl: string, logger: Logger): IORedis {
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  connection.on('error', (error) => {
    logger.error('Redis connection error', { error: error.message });
  });

  return connection;
}
