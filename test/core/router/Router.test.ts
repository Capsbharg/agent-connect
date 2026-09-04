import { describe, expect, it, vi } from 'vitest';
import { AgentRegistry } from '../../../src/core/agentRegistry/AgentRegistry.js';
import { CommandRegistry } from '../../../src/core/commands/CommandRegistry.js';
import { EventBus } from '../../../src/core/events/EventBus.js';
import { ActiveExecutionRegistry } from '../../../src/core/execution/ActiveExecutionRegistry.js';
import { InMemoryQueueProvider } from '../../../src/core/queue/InMemoryQueueProvider.js';
import { ProjectSession } from '../../../src/core/project/ProjectSession.js';
import { Router } from '../../../src/core/router/Router.js';
import { InMemoryStorageProvider } from '../../../src/core/storage/InMemoryStorageProvider.js';
import type { AgentAdapter } from '../../../src/interfaces/AgentAdapter.js';
import type { AuthenticationProvider } from '../../../src/interfaces/AuthenticationProvider.js';
import type { AuthorizationProvider } from '../../../src/interfaces/AuthorizationProvider.js';
import type { MessagingAdapter } from '../../../src/interfaces/MessagingAdapter.js';
import type { ExecutionJobPayload, Identity, InboundMessage } from '../../../src/core/types.js';
import { createTestLogger } from '../../helpers/testLogger.js';

const fakeAgent: AgentAdapter = {
  name: 'claude',
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

function baseMessage(text: string): InboundMessage {
  return { platform: 'test', platformUserId: 'U1', channelId: 'C1', isDirect: true, text, raw: {} };
}

function setup(
  opts: { authFails?: boolean; authorized?: boolean; maxQueuedPerIdentity?: number } = {},
) {
  const storage = new InMemoryStorageProvider();
  const projectSession = new ProjectSession(storage);
  const agentRegistry = new AgentRegistry([fakeAgent], 'claude', storage);
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
    activeExecutions,
    emit: (message: InboundMessage) => handler?.(message),
  };
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
});
