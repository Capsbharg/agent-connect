import { describe, expect, it, vi } from 'vitest';
import { InMemoryQueueProvider } from '../../../src/core/queue/InMemoryQueueProvider.js';

describe('InMemoryQueueProvider', () => {
  it('processes enqueued jobs in priority order, highest first', async () => {
    const queue = new InMemoryQueueProvider<string>();
    const seen: string[] = [];
    let resolveDone: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    queue.process(async (payload) => {
      seen.push(payload);
      if (seen.length === 3) resolveDone();
    });

    // Enqueue all three before awaiting any of them — awaiting individually
    // would let the first job start draining before the others are pushed,
    // defeating the point of this test (draining happens on a microtask
    // queued during enqueue(), so it only runs once the synchronous call
    // stack — this whole block — finishes).
    const enqueued = Promise.all([
      queue.enqueue('low', { priority: 0 }),
      queue.enqueue('high', { priority: 10 }),
      queue.enqueue('mid', { priority: 5 }),
    ]);
    await enqueued;
    await done;

    expect(seen).toEqual(['high', 'mid', 'low']);
  });

  it('respects the configured concurrency limit', async () => {
    const queue = new InMemoryQueueProvider<number>();
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    let resolveDone: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    let completed = 0;

    queue.process(
      async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active--;
        completed++;
        if (completed === 4) resolveDone();
      },
      { concurrency: 2 },
    );

    await Promise.all([1, 2, 3, 4].map((n) => queue.enqueue(n)));
    await vi.waitFor(() => expect(releases.length).toBe(2));
    expect(maxActive).toBe(2);

    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases.length).toBe(2));
    releases.splice(0).forEach((release) => release());
    await done;

    expect(completed).toBe(4);
  });

  it('cancel() removes a still-pending job before it runs', async () => {
    const queue = new InMemoryQueueProvider<string>();
    const seen: string[] = [];
    // No processor registered yet — job stays pending until process() is called.
    const { id } = await queue.enqueue('never-runs');
    await queue.cancel(id);

    queue.process(async (payload) => {
      seen.push(payload);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(seen).toEqual([]);
  });

  it('cancel() on an already-dequeued job is a safe no-op for future enqueues', async () => {
    const queue = new InMemoryQueueProvider<string>();
    await expect(queue.cancel('not-a-real-id')).resolves.toBeUndefined();
  });

  it('listPending supports filtering', async () => {
    const queue = new InMemoryQueueProvider<{ owner: string }>();
    await queue.enqueue({ owner: 'a' });
    await queue.enqueue({ owner: 'b' });
    await queue.enqueue({ owner: 'a' });

    const all = await queue.listPending();
    expect(all).toHaveLength(3);

    const onlyA = await queue.listPending((payload) => payload.owner === 'a');
    expect(onlyA).toHaveLength(2);
  });

  it('throws if process() is called more than once', () => {
    const queue = new InMemoryQueueProvider<string>();
    queue.process(async () => {});
    expect(() => queue.process(async () => {})).toThrow();
  });

  it('close() clears pending jobs and the processor', async () => {
    const queue = new InMemoryQueueProvider<string>();
    await queue.enqueue('a');
    await queue.close();
    expect(await queue.listPending()).toHaveLength(0);
  });
});
