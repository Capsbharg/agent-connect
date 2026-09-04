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
import type { ExecutionJobPayload, ReplyContent } from '../../../src/core/types.js';
import { createTestLogger } from '../../helpers/testLogger.js';

function fakeResponder() {
  return {
    post: vi.fn(async (_content: ReplyContent) => {}),
    update: vi.fn(async (_content: ReplyContent) => {}),
    complete: vi.fn(async (_content: ReplyContent) => {}),
  };
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

  it('posts the rest of a long result as follow-up messages instead of silently dropping it', async () => {
    const responder = fakeResponder();
    const adapter = fakeAdapter(responder);
    // Past MAX_RESULT_TEXT_LENGTH (3500) but small enough that the remainder
    // (1500 chars) fits in exactly one follow-up chunk, so this stays a
    // single overflow post() regardless of the exact overflow chunk size.
    const longOutput = 'x'.repeat(5000);

    const agent: AgentAdapter = {
      name: 'claude',
      healthCheck: async () => ({ healthy: true }),
      execute: () => ({
        cancel: vi.fn(),
        result: Promise.resolve({
          success: true,
          outputText: longOutput,
          durationMs: 5,
          exitCode: 0,
          cancelled: false,
          timedOut: false,
        }),
      }),
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
    await vi.waitFor(() => expect(responder.post).toHaveBeenCalledTimes(2));

    // First post() is the initial "Starting..." message; complete() carries
    // the first MAX_RESULT_TEXT_LENGTH chars plus a "continued" note; the
    // second post() carries the rest of the 5000-char output.
    const completedText = responder.complete.mock.calls[0]![0]!.text as string;
    expect(completedText).toContain('continued in');

    const overflowText = responder.post.mock.calls[1]![0]!.text as string;
    expect(overflowText.length).toBeGreaterThan(0);
    expect(completedText.length + overflowText.length).toBeGreaterThanOrEqual(longOutput.length);
  });

  it('does not post any follow-up message when the result fits within the limit', async () => {
    const responder = fakeResponder();
    const adapter = fakeAdapter(responder);
    const agent: AgentAdapter = {
      name: 'claude',
      healthCheck: async () => ({ healthy: true }),
      execute: () => ({
        cancel: vi.fn(),
        result: Promise.resolve({
          success: true,
          outputText: 'short result',
          durationMs: 5,
          exitCode: 0,
          cancelled: false,
          timedOut: false,
        }),
      }),
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

    // Only the initial "Starting..." post() — no overflow follow-up.
    expect(responder.post).toHaveBeenCalledTimes(1);
  });
});
