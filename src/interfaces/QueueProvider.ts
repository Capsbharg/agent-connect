export interface QueueJobContext {
  jobId: string;
}

export interface QueuedJob<T> {
  id: string;
  payload: T;
}

/**
 * Abstraction over BullMQ (production, Redis-backed: retry/priority/timeout/
 * cancellation/concurrency) and an in-memory fallback (dev/tests). Nothing
 * outside core/queue and core/execution knows which one is in use.
 */
export interface QueueProvider<T = unknown> {
  enqueue(payload: T, opts?: { priority?: number }): Promise<{ id: string }>;

  /** Registers the (single) processor for this queue. Call once. */
  process(
    handler: (payload: T, ctx: QueueJobContext) => Promise<void>,
    opts?: { concurrency?: number },
  ): void;

  /** Best-effort cancellation of a pending (not yet started) job. */
  cancel(jobId: string): Promise<void>;

  listPending(filter?: (payload: T) => boolean): Promise<QueuedJob<T>[]>;

  close(): Promise<void>;
}
