import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { AgentRegistry } from '../../../src/core/agentRegistry/AgentRegistry.js';
import { EventBus } from '../../../src/core/events/EventBus.js';
import { ActiveExecutionRegistry } from '../../../src/core/execution/ActiveExecutionRegistry.js';
import { ExecutionManager } from '../../../src/core/execution/ExecutionManager.js';
import { InMemoryQueueProvider } from '../../../src/core/queue/InMemoryQueueProvider.js';
import { InMemoryStorageProvider } from '../../../src/core/storage/InMemoryStorageProvider.js';
import type { AgentAdapter } from '../../../src/interfaces/AgentAdapter.js';
import type { MessagingAdapter } from '../../../src/interfaces/MessagingAdapter.js';
import type { ExecutionJobPayload } from '../../../src/core/types.js';
import { createTestLogger } from '../../helpers/testLogger.js';

function fakeResponder() {
  return { post: vi.fn(async () => {}), update: vi.fn(async () => {}), complete: vi.fn(async () => {}) };
}

function fakeAdapter(responder: ReturnType<typeof fakeResponder>): MessagingAdapter {
  return {
    platform: 'test',
    capabilities: { threads: true, fileUploads: false, slashCommands: false },
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    onMessage: () => {},
    createResponder: vi.fn(() => responder),
  };
}

function basePayload(overrides: Partial<ExecutionJobPayload> = {}): ExecutionJobPayload {
  return {
    identityId: 'test:U1',
    platformUserId: 'U1',
    platform: 'test',
    channelId: 'C1',
    prompt: 'do the thing',
    projectName: 'demo',
    cwd: os.tmpdir(),
    agentName: 'claude',
    requestedAt: Date.now(),
    ...overrides,
  };
}

describe('ExecutionManager', () => {
  it('runs the active agent and streams progress into a fresh responder', async () => {
    const responder = fakeResponder();
    const adapter = fakeAdapter(responder);

    const agent: AgentAdapter = {
      name: 'claude',
      healthCheck: async () => ({ healthy: true }),
      execute: (request) => {
        request.onProgress?.({ text: 'Reading file...' });
        return {
          cancel: vi.fn(),
          result: Promise.resolve({
            success: true,
            outputText: 'All done.',
            durationMs: 5,
            exitCode: 0,
            cancelled: false,
            timedOut: false,
          }),
        };
      },
    };

    const storage = new InMemoryStorageProvider();
    const agentRegistry = new AgentRegistry([agent], 'claude', storage);
    const queue = new InMemoryQueueProvider<ExecutionJobPayload>();

    const manager = new ExecutionManager({
      queue,
      agentRegistry,
      messagingAdapters: [adapter],
      events: new EventBus(createTestLogger()),
      activeExecutions: new ActiveExecutionRegistry(),
      logger: createTestLogger(),
      concurrency: 4,
    });
    manager.start();

    await queue.enqueue(basePayload());
    await vi.waitFor(() => expect(responder.complete).toHaveBeenCalled());

    expect(responder.post).toHaveBeenCalled();
    expect(responder.update).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Reading file...') }),
    );
    expect(responder.complete).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('All done.') }),
    );
  });

  it('reports a clear error and never calls the agent when the project directory no longer exists', async () => {
    const responder = fakeResponder();
    const adapter = fakeAdapter(responder);
    const agent: AgentAdapter = {
      name: 'claude',
      healthCheck: async () => ({ healthy: true }),
      execute: vi.fn(),
    };

    const storage = new InMemoryStorageProvider();
    const agentRegistry = new AgentRegistry([agent], 'claude', storage);
    const queue = new InMemoryQueueProvider<ExecutionJobPayload>();

    const manager = new ExecutionManager({
      queue,
      agentRegistry,
      messagingAdapters: [adapter],
      events: new EventBus(createTestLogger()),
      activeExecutions: new ActiveExecutionRegistry(),
      logger: createTestLogger(),
      concurrency: 4,
    });
    manager.start();

    await queue.enqueue(basePayload({ cwd: '/definitely/does/not/exist' }));
    await vi.waitFor(() => expect(responder.complete).toHaveBeenCalled());

    expect(agent.execute).not.toHaveBeenCalled();
    expect(responder.complete).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('no longer exists') }),
    );
  });
});
