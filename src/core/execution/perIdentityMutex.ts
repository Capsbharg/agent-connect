/**
 * In-process per-identity serialization. A QueueProvider's `concurrency`
 * setting can dequeue more than one job for the same identity at once; this
 * chains each identity's jobs onto a promise tail so they always execute
 * strictly one-at-a-time, FIFO, regardless of dequeue order (generalizes
 * userMutex.js).
 */
export class PerIdentityMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(identityId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(identityId) ?? Promise.resolve();
    const run = previous.then(fn, fn);

    // Keep the chain alive for the next caller, but never let a rejection
    // here propagate into the map (that's the caller's own promise to handle).
    const tail = run.catch(() => {});
    this.tails.set(identityId, tail);

    tail.finally(() => {
      if (this.tails.get(identityId) === tail) {
        this.tails.delete(identityId);
      }
    });

    return run;
  }
}
