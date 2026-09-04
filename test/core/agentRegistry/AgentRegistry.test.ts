import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../../../src/core/agentRegistry/AgentRegistry.js';
import { InMemoryStorageProvider } from '../../../src/core/storage/InMemoryStorageProvider.js';
import { AgentNotFoundError } from '../../../src/core/errors.js';
import type { AgentAdapter } from '../../../src/interfaces/AgentAdapter.js';

function fakeAgent(name: string): AgentAdapter {
  return {
    name,
    healthCheck: async () => ({ healthy: true }),
    execute: () => ({
      cancel: () => {},
      result: Promise.resolve({
        success: true,
        outputText: '',
        durationMs: 0,
        exitCode: 0,
        cancelled: false,
        timedOut: false,
      }),
    }),
  };
}

describe('AgentRegistry', () => {
  it('throws when constructed with a defaultAgentName that is not among the registered agents', () => {
    const storage = new InMemoryStorageProvider();
    expect(() => new AgentRegistry([fakeAgent('claude')], 'cursor', storage)).toThrow(
      AgentNotFoundError,
    );
  });

  it('list()/has()/get() reflect the registered agents', () => {
    const storage = new InMemoryStorageProvider();
    const registry = new AgentRegistry(
      [fakeAgent('claude'), fakeAgent('cursor')],
      'claude',
      storage,
    );

    expect(registry.list().map((a) => a.name)).toEqual(['claude', 'cursor']);
    expect(registry.has('cursor')).toBe(true);
    expect(registry.has('codex')).toBe(false);
    expect(registry.get('cursor').name).toBe('cursor');
    expect(() => registry.get('codex')).toThrow(AgentNotFoundError);
  });

  it('getActiveAgentName() falls back to the default when nothing is selected yet', async () => {
    const storage = new InMemoryStorageProvider();
    const registry = new AgentRegistry([fakeAgent('claude')], 'claude', storage);
    expect(await registry.getActiveAgentName('U1')).toBe('claude');
  });

  it('setActiveAgent()/getActiveAgentName() round-trip per identity', async () => {
    const storage = new InMemoryStorageProvider();
    const registry = new AgentRegistry(
      [fakeAgent('claude'), fakeAgent('cursor')],
      'claude',
      storage,
    );

    await registry.setActiveAgent('U1', 'cursor');
    expect(await registry.getActiveAgentName('U1')).toBe('cursor');
    // A different identity is unaffected.
    expect(await registry.getActiveAgentName('U2')).toBe('claude');
  });

  it('setActiveAgent() rejects an unregistered agent name', async () => {
    const storage = new InMemoryStorageProvider();
    const registry = new AgentRegistry([fakeAgent('claude')], 'claude', storage);
    await expect(registry.setActiveAgent('U1', 'nope')).rejects.toThrow(AgentNotFoundError);
  });

  it('getActiveAgentName() falls back to the default if the previously-selected agent is no longer registered', async () => {
    const storage = new InMemoryStorageProvider();
    const registryV1 = new AgentRegistry(
      [fakeAgent('claude'), fakeAgent('cursor')],
      'claude',
      storage,
    );
    await registryV1.setActiveAgent('U1', 'cursor');

    // Simulates a redeploy where "cursor" is no longer registered.
    const registryV2 = new AgentRegistry([fakeAgent('claude')], 'claude', storage);
    expect(await registryV2.getActiveAgentName('U1')).toBe('claude');
  });
});
