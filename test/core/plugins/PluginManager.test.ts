import { describe, expect, it, vi } from 'vitest';
import { PluginManager } from '../../../src/core/plugins/PluginManager.js';
import type { Plugin, PluginContext } from '../../../src/core/plugins/Plugin.js';
import { CommandRegistry } from '../../../src/core/commands/CommandRegistry.js';
import { EventBus } from '../../../src/core/events/EventBus.js';
import { createTestLogger } from '../../helpers/testLogger.js';

function fakeContext(): PluginContext {
  return {
    events: new EventBus(createTestLogger()),
    commands: new CommandRegistry(),
    logger: createTestLogger(),
  };
}

describe('PluginManager', () => {
  it('calls register() on every plugin, in order, with the shared context', async () => {
    const calls: string[] = [];
    const pluginA: Plugin = { name: 'a', register: () => void calls.push('a') };
    const pluginB: Plugin = { name: 'b', register: async () => void calls.push('b') };

    const ctx = fakeContext();
    const manager = new PluginManager([pluginA, pluginB]);
    await manager.registerAll(ctx);

    expect(calls).toEqual(['a', 'b']);
  });

  it('an empty plugin list resolves cleanly', async () => {
    const manager = new PluginManager([]);
    await expect(manager.registerAll(fakeContext())).resolves.toBeUndefined();
  });

  it('awaits an async register() before moving on to the next plugin', async () => {
    const order: string[] = [];
    const pluginA: Plugin = {
      name: 'a',
      register: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push('a-done');
      },
    };
    const pluginB: Plugin = { name: 'b', register: () => void order.push('b-done') };

    await new PluginManager([pluginA, pluginB]).registerAll(fakeContext());
    expect(order).toEqual(['a-done', 'b-done']);
  });

  it('passes through the plugin registering additional commands via the shared registry', async () => {
    const ctx = fakeContext();
    const plugin: Plugin = {
      name: 'extra-commands',
      register: (pluginCtx) => {
        pluginCtx.commands.register('ping', 'pong', vi.fn());
      },
    };

    await new PluginManager([plugin]).registerAll(ctx);
    expect(ctx.commands.describeAll()).toContainEqual({ name: 'ping', description: 'pong' });
  });
});
