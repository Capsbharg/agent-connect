import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRegistry } from '../../../src/core/agentRegistry/AgentRegistry.js';
import { EventBus } from '../../../src/core/events/EventBus.js';
import { ActiveExecutionRegistry } from '../../../src/core/execution/ActiveExecutionRegistry.js';
import { ExecutionManager } from '../../../src/core/execution/ExecutionManager.js';
import { ProjectSession } from '../../../src/core/project/ProjectSession.js';
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
      projectSession: new ProjectSession(storage),
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
      projectSession: new ProjectSession(storage),
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
      projectSession: new ProjectSession(storage),
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
      projectSession: new ProjectSession(storage),
    });
    manager.start();

    await queue.enqueue(basePayload());
    await vi.waitFor(() => expect(responder.complete).toHaveBeenCalled());

    // Only the initial "Starting..." post() — no overflow follow-up.
    expect(responder.post).toHaveBeenCalledTimes(1);
  });

  describe('attachments', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('downloads attachments and appends their path to the prompt the agent actually receives', async () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-connect-em-attachments-'));
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          headers: { get: () => null },
          arrayBuffer: async () => new TextEncoder().encode('file contents').buffer,
        })),
      );

      const responder = fakeResponder();
      const adapter = fakeAdapter(responder);
      let receivedPrompt = '';
      const agent: AgentAdapter = {
        name: 'claude',
        healthCheck: async () => ({ healthy: true }),
        execute: (request) => {
          receivedPrompt = request.prompt;
          return {
            cancel: vi.fn(),
            result: Promise.resolve({
              success: true,
              outputText: 'done',
              durationMs: 1,
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
        projectSession: new ProjectSession(storage),
      });
      manager.start();

      const { id: jobId } = await queue.enqueue(
        basePayload({
          cwd,
          prompt: 'summarize the attached file',
          attachments: [{ filename: 'notes.txt', url: 'https://example.com/notes.txt' }],
        }),
      );
      await vi.waitFor(() => expect(responder.complete).toHaveBeenCalled());

      expect(receivedPrompt).toContain('summarize the attached file');
      expect(receivedPrompt).toContain('notes.txt');
      expect(receivedPrompt).toContain('.agent-connect-attachments');

      // The final user-facing text should show the original prompt only —
      // the attachment note is for the agent, not the chat transcript.
      const finalText = responder.complete.mock.calls[0]![0]!.text as string;
      expect(finalText).not.toContain('.agent-connect-attachments');

      // Cleaned up after the run — the job-specific subdirectory is gone
      // (the shared .agent-connect-attachments/ parent is left in place, in
      // case a sibling job for the same project is still writing to it).
      expect(fs.existsSync(path.join(cwd, '.agent-connect-attachments', jobId))).toBe(false);
    });

    it('warns in the transcript when an attachment fails to download, but still runs the agent', async () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-connect-em-attachments-fail-'));
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: false,
          status: 404,
          headers: { get: () => null },
          arrayBuffer: async () => new ArrayBuffer(0),
        })),
      );

      const responder = fakeResponder();
      const adapter = fakeAdapter(responder);
      const agent: AgentAdapter = {
        name: 'claude',
        healthCheck: async () => ({ healthy: true }),
        execute: () => ({
          cancel: vi.fn(),
          result: Promise.resolve({
            success: true,
            outputText: 'done',
            durationMs: 1,
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
        projectSession: new ProjectSession(storage),
      });
      manager.start();

      await queue.enqueue(
        basePayload({
          cwd,
          attachments: [{ filename: 'missing.txt', url: 'https://example.com/missing.txt' }],
        }),
      );
      await vi.waitFor(() => expect(responder.complete).toHaveBeenCalled());

      expect(responder.post).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('could not be downloaded') }),
      );
    });

    it('a payload with no attachments never touches the filesystem for attachments', async () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-connect-em-no-attachments-'));
      const responder = fakeResponder();
      const adapter = fakeAdapter(responder);
      const agent: AgentAdapter = {
        name: 'claude',
        healthCheck: async () => ({ healthy: true }),
        execute: (request) => ({
          cancel: vi.fn(),
          result: Promise.resolve({
            success: true,
            outputText: request.prompt,
            durationMs: 1,
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
        projectSession: new ProjectSession(storage),
      });
      manager.start();

      await queue.enqueue(basePayload({ cwd, prompt: 'plain prompt, no attachments' }));
      await vi.waitFor(() => expect(responder.complete).toHaveBeenCalled());

      expect(responder.complete).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('plain prompt, no attachments') }),
      );
      expect(fs.existsSync(path.join(cwd, '.agent-connect-attachments'))).toBe(false);
    });
  });

  describe('session continuation', () => {
    it("passes the payload's sessionId to the agent, and persists the result's sessionId for next time", async () => {
      const responder = fakeResponder();
      const adapter = fakeAdapter(responder);
      let receivedSessionId: string | undefined;
      const agent: AgentAdapter = {
        name: 'claude',
        healthCheck: async () => ({ healthy: true }),
        execute: (request) => {
          receivedSessionId = request.sessionId;
          return {
            cancel: vi.fn(),
            result: Promise.resolve({
              success: true,
              outputText: 'done',
              durationMs: 1,
              exitCode: 0,
              cancelled: false,
              timedOut: false,
              sessionId: 'new-session-id',
            }),
          };
        },
      };

      const storage = new InMemoryStorageProvider();
      const agentRegistry = new AgentRegistry([agent], 'claude', storage);
      const queue = new InMemoryQueueProvider<ExecutionJobPayload>();
      const projectSession = new ProjectSession(storage);
      await projectSession.setActiveProject('test:U1', 'demo', os.tmpdir());

      const manager = new ExecutionManager({
        queue,
        agentRegistry,
        messagingAdapters: [adapter],
        events: new EventBus(createTestLogger()),
        activeExecutions: new ActiveExecutionRegistry(),
        logger: createTestLogger(),
        concurrency: 4,
        projectSession,
      });
      manager.start();

      await queue.enqueue(basePayload({ identityId: 'test:U1', sessionId: 'prior-session-id' }));
      await vi.waitFor(() => expect(responder.complete).toHaveBeenCalled());

      expect(receivedSessionId).toBe('prior-session-id');
      expect(await projectSession.getSessionId('test:U1', 'claude')).toBe('new-session-id');
    });

    it('does not touch the stored session id when the result has none', async () => {
      const responder = fakeResponder();
      const adapter = fakeAdapter(responder);
      const agent: AgentAdapter = {
        name: 'claude',
        healthCheck: async () => ({ healthy: true }),
        execute: () => ({
          cancel: vi.fn(),
          result: Promise.resolve({
            success: true,
            outputText: 'done',
            durationMs: 1,
            exitCode: 0,
            cancelled: false,
            timedOut: false,
          }),
        }),
      };

      const storage = new InMemoryStorageProvider();
      const agentRegistry = new AgentRegistry([agent], 'claude', storage);
      const queue = new InMemoryQueueProvider<ExecutionJobPayload>();
      const projectSession = new ProjectSession(storage);
      await projectSession.setActiveProject('test:U1', 'demo', os.tmpdir());
      await projectSession.setSessionId('test:U1', 'claude', 'existing-session-id');

      const manager = new ExecutionManager({
        queue,
        agentRegistry,
        messagingAdapters: [adapter],
        events: new EventBus(createTestLogger()),
        activeExecutions: new ActiveExecutionRegistry(),
        logger: createTestLogger(),
        concurrency: 4,
        projectSession,
      });
      manager.start();

      await queue.enqueue(basePayload({ identityId: 'test:U1' }));
      await vi.waitFor(() => expect(responder.complete).toHaveBeenCalled());

      expect(await projectSession.getSessionId('test:U1', 'claude')).toBe('existing-session-id');
    });
  });
});
