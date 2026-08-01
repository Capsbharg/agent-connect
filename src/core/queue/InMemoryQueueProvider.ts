import type { QueueJobContext, QueueProvider, QueuedJob } from '../../interfaces/QueueProvider.js';

interface Entry<T> {
  id: string;
  payload: T;
  priority: number;
}

/**
 * Zero-dependency QueueProvider for local dev / tests. Single-process only —
 * no cross-instance sharing, no persistence across restarts. Same processor
 * shape as BullMQQueueProvider so ExecutionManager never knows which is in use.
 */
export class InMemoryQueueProvider<T = unknown> implements QueueProvider<T> {
  private readonly pending: Entry<T>[] = [];
  private readonly cancelledIds = new Set<string>();
  private handler: ((payload: T, ctx: QueueJobContext) => Promise<void>) | null = null;
  private concurrency = 4;
  private active = 0;
  private nextId = 1;

  async enqueue(payload: T, opts?: { priority?: number }): Promise<{ id: string }> {
    const id = String(this.nextId++);
    this.pending.push({ id, payload, priority: opts?.priority ?? 0 });
    this.pending.sort((a, b) => b.priority - a.priority);
    queueMicrotask(() => this.drain());
    return { id };
  }

  process(handler: (payload: T, ctx: QueueJobContext) => Promise<void>, opts?: { concurrency?: number }): void {
    if (this.handler) {
      throw new Error('Processor already registered.');
    }
    this.handler = handler;
    this.concurrency = opts?.concurrency ?? 4;
    this.drain();
  }

  private drain(): void {
    if (!this.handler) return;
    while (this.active < this.concurrency && this.pending.length > 0) {
      const entry = this.pending.shift();
      if (!entry) break;
      if (this.cancelledIds.delete(entry.id)) continue;

      this.active++;
      this.handler(entry.payload, { jobId: entry.id })
        .catch(() => {
          // Errors are the caller's responsibility to log; a rejected handler
          // must never stop the queue from draining the rest.
        })
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }

  async cancel(jobId: string): Promise<void> {
    const index = this.pending.findIndex((entry) => entry.id === jobId);
    if (index >= 0) {
      this.pending.splice(index, 1);
    } else {
      this.cancelledIds.add(jobId);
    }
  }

  async listPending(filter?: (payload: T) => boolean): Promise<QueuedJob<T>[]> {
    return this.pending
      .filter((entry) => (filter ? filter(entry.payload) : true))
      .map((entry) => ({ id: entry.id, payload: entry.payload }));
  }

  async close(): Promise<void> {
    this.pending.length = 0;
    this.handler = null;
  }
}
