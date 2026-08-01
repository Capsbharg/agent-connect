import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../src/core/events/EventBus.js';
import type { InboundMessage } from '../../../src/core/types.js';
import { createTestLogger } from '../../helpers/testLogger.js';

const message: InboundMessage = {
  platform: 'test',
  platformUserId: 'U1',
  channelId: 'C1',
  isDirect: true,
  text: 'hello',
  raw: {},
};

describe('EventBus', () => {
  it('calls every listener registered for an event, in registration order', async () => {
    const bus = new EventBus(createTestLogger());
    const seen: string[] = [];
    bus.on('beforeMessage', () => {
      seen.push('a');
    });
    bus.on('beforeMessage', () => {
      seen.push('b');
    });

    await bus.emit('beforeMessage', { message });

    expect(seen).toEqual(['a', 'b']);
  });

  it('unsubscribes via the function returned from on()', async () => {
    const bus = new EventBus(createTestLogger());
    const listener = vi.fn();
    const off = bus.on('beforeMessage', listener);
    off();

    await bus.emit('beforeMessage', { message });

    expect(listener).not.toHaveBeenCalled();
  });

  it('logs and continues when a listener throws', async () => {
    const logger = createTestLogger();
    const bus = new EventBus(logger);
    const second = vi.fn();
    bus.on('beforeMessage', () => {
      throw new Error('boom');
    });
    bus.on('beforeMessage', second);

    await bus.emit('beforeMessage', { message });

    expect(second).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('resolves without error when an event has no listeners', async () => {
    const bus = new EventBus(createTestLogger());
    await expect(bus.emit('afterMessage', { message, identity: null })).resolves.toBeUndefined();
  });
});
