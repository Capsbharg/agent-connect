import { describe, expect, it, vi } from 'vitest';

const constructedOptions: unknown[] = [];
class FakeRedis {
  constructor(...args: unknown[]) {
    constructedOptions.push(args[1]);
  }
  on() {}
}

vi.mock('ioredis', () => ({ Redis: FakeRedis }));

const { createRedisConnection } =
  await import('../../../src/core/storage/createRedisConnection.js');
const { createTestLogger } = await import('../../helpers/testLogger.js');

describe('createRedisConnection', () => {
  it('does not set ioredis keyPrefix when none is given', () => {
    constructedOptions.length = 0;
    createRedisConnection('redis://localhost:6379', createTestLogger());
    expect(constructedOptions[0]).not.toHaveProperty('keyPrefix');
  });

  it('passes keyPrefix through to the ioredis client options when given', () => {
    constructedOptions.length = 0;
    createRedisConnection('redis://localhost:6379', createTestLogger(), 'myapp:');
    expect(constructedOptions[0]).toMatchObject({ keyPrefix: 'myapp:' });
  });
});
