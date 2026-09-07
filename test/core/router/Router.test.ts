import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AgentRegistry } from '../../../src/core/agentRegistry/AgentRegistry.js';
import { CommandRegistry } from '../../../src/core/commands/CommandRegistry.js';
import { EventBus } from '../../../src/core/events/EventBus.js';
import { ActiveExecutionRegistry } from '../../../src/core/execution/ActiveExecutionRegistry.js';
import { InMemoryQueueProvider } from '../../../src/core/queue/InMemoryQueueProvider.js';
import { ProjectRegistry } from '../../../src/core/project/ProjectRegistry.js';
import { ProjectSession } from '../../../src/core/project/ProjectSession.js';
import { Router } from '../../../src/core/router/Router.js';
import { InMemoryStorageProvider } from '../../../src/core/storage/InMemoryStorageProvider.js';
import type { AgentAdapter } from '../../../src/interfaces/AgentAdapter.js';
import type { AuthenticationProvider } from '../../../src/interfaces/AuthenticationProvider.js';
import type { AuthorizationProvider } from '../../../src/interfaces/AuthorizationProvider.js';
import type { MessagingAdapter } from '../../../src/interfaces/MessagingAdapter.js';
import type { ExecutionJobPayload, Identity, InboundMessage } from '../../../src/core/types.js';
import { createTestLogger } from '../../helpers/testLogger.js';

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

/** An empty, never-loaded ProjectRegistry — every lookup returns undefined, matching pre-override behavior. */
function emptyProjectRegistry(): ProjectRegistry {
  return new ProjectRegistry(
    path.join(os.tmpdir(), 'agent-connect-router-test-nonexistent.json'),
    createTestLogger(),
  );
}

function baseMessage(text: string): InboundMessage {
  return { platform: 'test', platformUserId: 'U1', channelId: 'C1', isDirect: true, text, raw: {} };
}

function setup(
  opts: {
    authFails?: boolean;
    authorized?: boolean;
    maxQueuedPerIdentity?: number;
    projectRegistry?: ProjectRegistry;
    agentNames?: string[];
  } = {},
) {
  const storage = new InMemoryStorageProvider();
  const projectSession = new ProjectSession(storage);
  const agentNames = opts.agentNames ?? ['claude'];
  const agentRegistry = new AgentRegistry(agentNames.map(fakeAgent), agentNames[0]!, storage);
  const projectRegistry = opts.projectRegistry ?? emptyProjectRegistry();
  const queue = new InMemoryQueueProvider<ExecutionJobPayload>();
  const activeExecutions = new ActiveExecutionRegistry();
  const events = new EventBus(createTestLogger());
  const commands = new CommandRegistry();
  commands.register('help', 'show help', async (_arg, ctx) => {
    await ctx.responder.post({ text: 'help text' });
  });

  const responder = {
    post: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    complete: vi.fn(async () => {}),
  };
  let handler: ((message: InboundMessage) => void | Promise<void>) | null = null;
  const adapter: MessagingAdapter = {
    platform: 'test',
    capabilities: { threads: true, fileUploads: false, slashCommands: true },
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    onMessage: (h) => {
      handler = h;
    },
    createResponder: vi.fn(() => responder),
  };

  const identity: Identity = { id: 'test:U1', platform: 'test', platformUserId: 'U1' };
  const authentication: AuthenticationProvider = {
    authenticate: vi.fn(async () => (opts.authFails ? null : identity)),
  };
  const authorization: AuthorizationProvider = {
    isAllowed: vi.fn(async () => opts.authorized ?? true),
  };

  const router = new Router({
    messagingAdapters: [adapter],
    authentication,
    authorization,
    commands,
    projectSession,
    projectRegistry,
    agentRegistry,
    queue,
    activeExecutions,
    events,
    logger: createTestLogger(),
    maxQueuedPerIdentity: opts.maxQueuedPerIdentity,
  });
  router.attach();

  return {
    adapter,
    responder,
    queue,
    projectSession,
    agentRegistry,
    activeExecutions,
    emit: (message: InboundMessage) => handler?.(message),
  };
}

/** Writes a projects.json with the given raw entries and returns a loaded ProjectRegistry. */
function loadedProjectRegistry(entries: Record<string, unknown>): ProjectRegistry {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-connect-router-test-'));
  const configPath = path.join(dir, 'projects.json');
  fs.writeFileSync(configPath, JSON.stringify(entries));
  const registry = new ProjectRegistry(configPath, createTestLogger());
  registry.load();
  return registry;
}

describe('Router', () => {
  it('routes a known command to its registered handler', async () => {
    const { emit, responder } = setup();
    await emit(baseMessage('help'));
    expect(responder.post).toHaveBeenCalledWith({ text: 'help text' });
  });

  it('drops the message when authentication fails', async () => {
    const { emit, adapter } = setup({ authFails: true });
    await emit(baseMessage('hello'));
    expect(adapter.createResponder).not.toHaveBeenCalled();
  });

  it('drops the message when not authorized', async () => {
    const { emit, adapter } = setup({ authorized: false });
    await emit(baseMessage('hello'));
    expect(adapter.createResponder).not.toHaveBeenCalled();
  });

  it('replies with a reminder when a prompt has no active project', async () => {
    const { emit, responder } = setup();
    await emit(baseMessage('do something'));
    expect(responder.post).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('No project selected') }),
    );
  });

  it('enqueues a prompt and acknowledges it once a project is active', async () => {
    const { emit, responder, queue, projectSession } = setup();
    await projectSession.setActiveProject('test:U1', 'demo', '/tmp/demo');

    await emit(baseMessage('do something'));

    const pending = await queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.payload.prompt).toBe('do something');
    expect(pending[0]?.payload.projectName).toBe('demo');
    expect(responder.post).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Got it') }),
    );
  });

  it('rejects a new prompt once maxQueuedPerIdentity is reached, without touching the queue', async () => {
    const { emit, responder, queue, projectSession } = setup({ maxQueuedPerIdentity: 1 });
    await projectSession.setActiveProject('test:U1', 'demo', '/tmp/demo');

    await emit(baseMessage('first prompt'));
    await emit(baseMessage('second prompt'));

    const pending = await queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.payload.prompt).toBe('first prompt');
    expect(responder.post).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: expect.stringContaining('max 1') }),
    );
  });

  it('counts a currently-running execution toward the limit, not just queued ones', async () => {
    const { emit, responder, queue, projectSession, activeExecutions } = setup({
      maxQueuedPerIdentity: 1,
    });
    await projectSession.setActiveProject('test:U1', 'demo', '/tmp/demo');
    activeExecutions.register('test:U1', 'job-1', () => {});

    await emit(baseMessage('a new prompt'));

    expect(await queue.listPending()).toHaveLength(0);
    expect(responder.post).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('running/queued') }),
    );
  });

  it('does not enforce a limit when maxQueuedPerIdentity is undefined', async () => {
    const { emit, queue, projectSession } = setup();
    await projectSession.setActiveProject('test:U1', 'demo', '/tmp/demo');

    await emit(baseMessage('first'));
    await emit(baseMessage('second'));
    await emit(baseMessage('third'));

    expect(await queue.listPending()).toHaveLength(3);
  });

  describe('per-project agent/model overrides', () => {
    it("uses the project's agent override when the user has never explicitly picked one", async () => {
      const projectRegistry = loadedProjectRegistry({
        demo: { path: os.tmpdir(), agent: 'cursor' },
      });
      const { emit, queue, projectSession } = setup({
        agentNames: ['claude', 'cursor'],
        projectRegistry,
      });
      await projectSession.setActiveProject('test:U1', 'demo', os.tmpdir());

      await emit(baseMessage('do something'));

      const pending = await queue.listPending();
      expect(pending[0]?.payload.agentName).toBe('cursor');
    });

    it("the user's own explicit agent selection still wins over the project's override", async () => {
      const projectRegistry = loadedProjectRegistry({
        demo: { path: os.tmpdir(), agent: 'cursor' },
      });
      const { emit, queue, projectSession, agentRegistry } = setup({
        agentNames: ['claude', 'cursor'],
        projectRegistry,
      });
      await projectSession.setActiveProject('test:U1', 'demo', os.tmpdir());
      await agentRegistry.setActiveAgent('test:U1', 'claude');

      await emit(baseMessage('do something'));

      const pending = await queue.listPending();
      expect(pending[0]?.payload.agentName).toBe('claude');
    });

    it("passes the project's model override through to the execution payload", async () => {
      const projectRegistry = loadedProjectRegistry({
        demo: { path: os.tmpdir(), model: 'opus' },
      });
      const { emit, queue, projectSession } = setup({ projectRegistry });
      await projectSession.setActiveProject('test:U1', 'demo', os.tmpdir());

      await emit(baseMessage('do something'));

      const pending = await queue.listPending();
      expect(pending[0]?.payload.model).toBe('opus');
    });

    it('leaves agentName/model at their normal defaults for a project with no overrides', async () => {
      const projectRegistry = loadedProjectRegistry({ demo: os.tmpdir() });
      const { emit, queue, projectSession } = setup({ projectRegistry });
      await projectSession.setActiveProject('test:U1', 'demo', os.tmpdir());

      await emit(baseMessage('do something'));

      const pending = await queue.listPending();
      expect(pending[0]?.payload.agentName).toBe('claude');
      expect(pending[0]?.payload.model).toBeUndefined();
    });
  });

  describe('session continuation', () => {
    it('attaches the stored session id for the resolved agent when one exists', async () => {
      const { emit, queue, projectSession } = setup();
      await projectSession.setActiveProject('test:U1', 'demo', '/tmp/demo');
      await projectSession.setSessionId('test:U1', 'claude', 'claude-session-1');

      await emit(baseMessage('continue that'));

      const pending = await queue.listPending();
      expect(pending[0]?.payload.sessionId).toBe('claude-session-1');
    });

    it('leaves sessionId undefined for a fresh project/agent with no prior conversation', async () => {
      const { emit, queue, projectSession } = setup();
      await projectSession.setActiveProject('test:U1', 'demo', '/tmp/demo');

      await emit(baseMessage('do something'));

      const pending = await queue.listPending();
      expect(pending[0]?.payload.sessionId).toBeUndefined();
    });

    it("looks up the session id under the agent that will actually run, not the identity's raw selection", async () => {
      const projectRegistry = loadedProjectRegistry({
        demo: { path: os.tmpdir(), agent: 'cursor' },
      });
      const { emit, queue, projectSession } = setup({
        agentNames: ['claude', 'cursor'],
        projectRegistry,
      });
      await projectSession.setActiveProject('test:U1', 'demo', os.tmpdir());
      await projectSession.setSessionId('test:U1', 'cursor', 'cursor-session-1');
      await projectSession.setSessionId('test:U1', 'claude', 'claude-session-1');

      await emit(baseMessage('do something'));

      const pending = await queue.listPending();
      expect(pending[0]?.payload.agentName).toBe('cursor');
      expect(pending[0]?.payload.sessionId).toBe('cursor-session-1');
    });
  });
});
