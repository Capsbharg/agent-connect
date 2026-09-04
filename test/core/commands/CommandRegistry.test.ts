import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../../../src/core/commands/CommandRegistry.js';
import type { CommandContext, Identity, InboundMessage } from '../../../src/core/types.js';

function fakeContext(): CommandContext {
  const identity: Identity = { id: 'test:U1', platform: 'test', platformUserId: 'U1' };
  const message: InboundMessage = {
    platform: 'test',
    platformUserId: 'U1',
    channelId: 'C1',
    isDirect: true,
    text: '',
    raw: {},
  };
  const responder = {
    post: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    complete: vi.fn(async () => {}),
  };
  return { identity, message, responder };
}

describe('CommandRegistry', () => {
  it('describeAll() lists every registered command', () => {
    const registry = new CommandRegistry();
    registry.register('help', 'show help', async () => {});
    registry.register('use', 'switch project', async () => {}, { takesArg: true });

    expect(registry.describeAll()).toEqual([
      { name: 'help', description: 'show help' },
      { name: 'use', description: 'switch project' },
    ]);
  });

  it('registers command names case-insensitively', async () => {
    const registry = new CommandRegistry();
    const handler = vi.fn(async () => {});
    registry.register('Help', 'show help', handler);

    const ctx = fakeContext();
    const handled = await registry.execute('HELP', '', ctx);
    expect(handled).toBe(true);
    expect(handler).toHaveBeenCalledWith('', ctx);
  });

  it('execute() returns false for an unregistered command without throwing', async () => {
    const registry = new CommandRegistry();
    await expect(registry.execute('nope', '', fakeContext())).resolves.toBe(false);
  });

  it("parse() reflects each command's takesArg via the underlying CommandParser", () => {
    const registry = new CommandRegistry();
    registry.register('help', 'show help', async () => {});
    registry.register('use', 'switch project', async () => {}, { takesArg: true });

    expect(registry.parse('help')).toEqual({ type: 'command', name: 'help', arg: '' });
    // help doesn't take an arg, so trailing text makes it a prompt instead.
    expect(registry.parse('help me debug this')).toEqual({
      type: 'prompt',
      text: 'help me debug this',
    });
    expect(registry.parse('use backend-api')).toEqual({
      type: 'command',
      name: 'use',
      arg: 'backend-api',
    });
    expect(registry.parse('write some code')).toEqual({ type: 'prompt', text: 'write some code' });
  });
});
