import { describe, expect, it, vi } from 'vitest';

const queueOptionsCalls: unknown[] = [];
const workerOptionsCalls: unknown[] = [];

class FakeQueue {
  constructor(_name: string, opts: unknown) {
    queueOptionsCalls.push(opts);
  }
  add() {}
  getJob() {}
  getJobs() {
    return [];
  }
  close() {}
}

class FakeWorker {
  constructor(_name: string, _handler: unknown, opts: unknown) {
    workerOptionsCalls.push(opts);
  }
  on() {}
  close() {}
}

vi.mock('bullmq', () => ({ Queue: FakeQueue, Worker: FakeWorker }));
vi.mock('../../../src/core/storage/createRedisConnection.js', () => ({
  createRedisConnection: () => ({ quit: async () => {} }),
}));

const { BullMQQueueProvider } = await import('../../../src/core/queue/BullMQQueueProvider.js');
const { createTestLogger } = await import('../../helpers/testLogger.js');

describe('BullMQQueueProvider key prefix', () => {
  it("passes keyPrefix through as BullMQ's own `prefix` option (not ioredis keyPrefix) for both Queue and Worker", () => {
    queueOptionsCalls.length = 0;
    workerOptionsCalls.length = 0;

    const provider = new BullMQQueueProvider(
      'test-queue',
      'redis://localhost:6379',
      createTestLogger(),
      'myapp',
    );
    provider.process(async () => {});

    expect(queueOptionsCalls[0]).toMatchObject({ prefix: 'myapp' });
    expect(workerOptionsCalls[0]).toMatchObject({ prefix: 'myapp' });
  });

  it('leaves prefix undefined when none is given', () => {
    queueOptionsCalls.length = 0;

    new BullMQQueueProvider('test-queue', 'redis://localhost:6379', createTestLogger());

    expect((queueOptionsCalls[0] as { prefix?: string }).prefix).toBeUndefined();
  });
});
