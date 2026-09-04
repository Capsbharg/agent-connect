import type { Redis } from 'ioredis';
import { Queue, Worker } from 'bullmq';
import type { Job, JobsOptions } from 'bullmq';
import type { QueueJobContext, QueueProvider, QueuedJob } from '../../interfaces/QueueProvider.js';
import type { Logger } from '../logger/Logger.js';
import { createRedisConnection } from '../storage/createRedisConnection.js';

const JOB_OPTIONS = {
  // Executions are not idempotent (side effects on the filesystem/repo), so a
  // failed run must never be silently retried.
  attempts: 1,
  removeOnComplete: { age: 3600, count: 100 },
  removeOnFail: { age: 86400, count: 200 },
};

/** Production QueueProvider: BullMQ + Redis, with retry/priority/concurrency/cancellation. */
export class BullMQQueueProvider<T = unknown> implements QueueProvider<T> {
  private readonly queue: Queue<T>;
  private readonly queueConnection: Redis;
  private worker: Worker<T> | null = null;
  private workerConnection: Redis | null = null;

  /**
   * `keyPrefix` namespaces every key this queue owns, using BullMQ's own
   * `prefix` option (not ioredis' `keyPrefix`, which conflicts with how
   * BullMQ addresses its own keys internally) — set it when a Redis instance
   * is shared with other apps to avoid collisions.
   */
  constructor(
    private readonly queueName: string,
    private readonly redisUrl: string,
    private readonly logger: Logger,
    private readonly keyPrefix?: string,
  ) {
    this.queueConnection = createRedisConnection(redisUrl, logger);
    this.queue = new Queue<T>(queueName, {
      connection: this.queueConnection,
      prefix: this.keyPrefix,
    });
  }

  async enqueue(payload: T, opts?: { priority?: number }): Promise<{ id: string }> {
    // bullmq infers the job-name type param from T via a deferred conditional
    // (ExtractNameType<T, string>), which never resolves for an unconstrained
    // generic T — cast .add to the shape it actually has at runtime (string name).
    const add = this.queue.add.bind(this.queue) as unknown as (
      name: string,
      data: T,
      opts?: JobsOptions,
    ) => Promise<Job<T, unknown, string>>;
    const job = await add('execute', payload, { ...JOB_OPTIONS, priority: opts?.priority });
    return { id: job.id ?? '' };
  }

  process(
    handler: (payload: T, ctx: QueueJobContext) => Promise<void>,
    opts?: { concurrency?: number },
  ): void {
    if (this.worker) {
      throw new Error(`Queue "${this.queueName}" already has a processor registered.`);
    }
    this.workerConnection = createRedisConnection(this.redisUrl, this.logger);
    this.worker = new Worker<T>(
      this.queueName,
      (job) => handler(job.data, { jobId: job.id ?? '' }),
      {
        connection: this.workerConnection,
        concurrency: opts?.concurrency ?? 4,
        prefix: this.keyPrefix,
      },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error(`Job ${job?.id} failed`, { error: error.message });
    });
    this.worker.on('error', (error) => {
      this.logger.error('Queue worker error', { error: error.message });
    });
  }

  async cancel(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (job) await job.remove();
  }

  async listPending(filter?: (payload: T) => boolean): Promise<QueuedJob<T>[]> {
    const jobs = await this.queue.getJobs(['waiting', 'delayed']);
    return jobs
      .filter((job) => (filter ? filter(job.data) : true))
      .map((job) => ({ id: job.id ?? '', payload: job.data }));
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    await this.queueConnection.quit();
    if (this.workerConnection) await this.workerConnection.quit();
  }

  /** Exposes the underlying BullMQ Queue for the optional Bull Board admin dashboard. */
  getBullQueue(): Queue<T> {
    return this.queue;
  }
}
