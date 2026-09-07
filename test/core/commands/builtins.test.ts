import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { registerBuiltinCommands } from '../../../src/core/commands/builtins.js';
import { CommandRegistry } from '../../../src/core/commands/CommandRegistry.js';
import { AgentRegistry } from '../../../src/core/agentRegistry/AgentRegistry.js';
import { ProjectRegistry } from '../../../src/core/project/ProjectRegistry.js';
import { ProjectSession } from '../../../src/core/project/ProjectSession.js';
import { ActiveExecutionRegistry } from '../../../src/core/execution/ActiveExecutionRegistry.js';
import { InMemoryQueueProvider } from '../../../src/core/queue/InMemoryQueueProvider.js';
import { InMemoryStorageProvider } from '../../../src/core/storage/InMemoryStorageProvider.js';
import type { AgentAdapter } from '../../../src/interfaces/AgentAdapter.js';
import type {
  CommandContext,
  ExecutionJobPayload,
  Identity,
  InboundMessage,
  ReplyContent,
} from '../../../src/core/types.js';
import { createTestLogger } from '../../helpers/testLogger.js';

/** Writes a projects.json with the given raw entries and returns a loaded ProjectRegistry. */
function loadedProjectRegistry(entries: Record<string, unknown>): ProjectRegistry {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-connect-builtins-test-'));
  const configPath = path.join(dir, 'projects.json');
  fs.writeFileSync(configPath, JSON.stringify(entries));
  const registry = new ProjectRegistry(configPath, createTestLogger());
  registry.load();
  return registry;
}

function fakeAgent(name: string, healthy = true): AgentAdapter {
  return {
    name,
    healthCheck: async () =>
      healthy ? { healthy: true } : { healthy: false, message: 'not found on PATH' },
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

function setup(
  agents: AgentAdapter[] = [fakeAgent('claude')],
  opts: { projectRegistry?: ProjectRegistry } = {},
) {
  const storage = new InMemoryStorageProvider();
  const projectRegistry =
    opts.projectRegistry ?? new ProjectRegistry('/does/not/matter.json', createTestLogger());
  const projectSession = new ProjectSession(storage);
  const agentRegistry = new AgentRegistry(agents, agents[0]!.name, storage);
  const queue = new InMemoryQueueProvider<ExecutionJobPayload>();
  const activeExecutions = new ActiveExecutionRegistry();
  const logger = createTestLogger();

  const registry = new CommandRegistry();
  registerBuiltinCommands(registry, {
    projectRegistry,
    projectSession,
    agentRegistry,
    queue,
    activeExecutions,
    logger,
  });

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
    post: vi.fn(async (_content: ReplyContent) => {}),
    update: vi.fn(async (_content: ReplyContent) => {}),
    complete: vi.fn(async (_content: ReplyContent) => {}),
  };
  const ctx: CommandContext = { identity, message, responder };

  return { registry, queue, activeExecutions, projectSession, ctx, responder };
}

function basePayload(overrides: Partial<ExecutionJobPayload> = {}): ExecutionJobPayload {
  return {
    identityId: 'test:U1',
    platformUserId: 'U1',
    platform: 'test',
    channelId: 'C1',
    prompt: 'do the thing',
    projectName: 'demo',
    cwd: '/tmp/demo',
    agentName: 'claude',
    requestedAt: Date.now(),
    ...overrides,
  };
}

describe('builtins: status', () => {
  it('lists queued job ids and points at cancel <id>', async () => {
    const { registry, queue, ctx, responder } = setup();
    await queue.enqueue(basePayload());
    await registry.execute('status', '', ctx);

    const text = responder.post.mock.calls.at(-1)![0]!.text;
    expect(text).toContain('1 execution(s) queued');
    expect(text).toContain('cancel <id>');
  });
});

describe('builtins: cancel', () => {
  it('cancel with no id stops the active run and clears every queued one (existing behavior)', async () => {
    const { registry, queue, activeExecutions, ctx, responder } = setup();
    const cancelFn = vi.fn();
    activeExecutions.register('test:U1', 'job-active', cancelFn);
    await queue.enqueue(basePayload());

    await registry.execute('cancel', '', ctx);

    expect(cancelFn).toHaveBeenCalled();
    expect(await queue.listPending()).toHaveLength(0);
    expect(responder.post).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Stopped your running execution') }),
    );
  });

  it('cancel <id> stops only the matching active execution', async () => {
    const { registry, activeExecutions, ctx, responder } = setup();
    const cancelFn = vi.fn();
    activeExecutions.register('test:U1', 'job-active', cancelFn);

    await registry.execute('cancel', 'job-active', ctx);

    expect(cancelFn).toHaveBeenCalled();
    expect(responder.post).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Stopped running execution `job-active`'),
      }),
    );
  });

  it('cancel <id> cancels only the matching queued job, leaving others untouched', async () => {
    const { registry, queue, ctx, responder } = setup();
    const { id: keepId } = await queue.enqueue(basePayload({ prompt: 'keep me' }));
    const { id: cancelId } = await queue.enqueue(basePayload({ prompt: 'cancel me' }));

    await registry.execute('cancel', cancelId, ctx);

    const remaining = await queue.listPending();
    expect(remaining.map((j) => j.id)).toEqual([keepId]);
    expect(responder.post).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(`Cancelled queued execution \`${cancelId}\``),
      }),
    );
  });

  it('cancel <id> reports a clear error for an id that does not belong to this user', async () => {
    const { registry, ctx, responder } = setup();
    await registry.execute('cancel', 'not-mine', ctx);

    expect(responder.post).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('No running or queued execution `not-mine`'),
      }),
    );
  });

  it("cancel <id> never touches another user's queued job with the same-looking id namespace", async () => {
    const { registry, queue, ctx, responder } = setup();
    const { id } = await queue.enqueue(basePayload({ identityId: 'test:OTHER' }));

    await registry.execute('cancel', id, ctx);

    expect(await queue.listPending()).toHaveLength(1);
    expect(responder.post).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('No running or queued execution') }),
    );
  });
});

describe('builtins: health', () => {
  it("reports every registered agent's health", async () => {
    const { registry, ctx, responder } = setup([
      fakeAgent('claude', true),
      fakeAgent('cursor', false),
    ]);
    await registry.execute('health', '', ctx);

    const text = responder.post.mock.calls.at(-1)![0]!.text;
    expect(text).toContain('✅ claude');
    expect(text).toContain('❌ cursor — not found on PATH');
  });

  it('treats a healthCheck() that throws as unhealthy instead of crashing the command', async () => {
    const throwingAgent: AgentAdapter = {
      name: 'flaky',
      healthCheck: async () => {
        throw new Error('spawn ENOENT');
      },
      execute: () => ({ cancel: () => {}, result: Promise.reject(new Error('unused')) }),
    };
    const { registry, ctx, responder } = setup([throwingAgent]);

    await registry.execute('health', '', ctx);

    const text = responder.post.mock.calls.at(-1)![0]!.text;
    expect(text).toContain('❌ flaky — spawn ENOENT');
  });
});

describe('builtins: current/agent reflect the project agent/model override', () => {
  it('`agent` with no arg shows the project override, not the app default, when the user never picked one', async () => {
    const projectRegistry = loadedProjectRegistry({ demo: { path: os.tmpdir(), agent: 'cursor' } });
    const { registry, projectSession, ctx, responder } = setup(
      [fakeAgent('claude'), fakeAgent('cursor')],
      { projectRegistry },
    );
    await projectSession.setActiveProject('test:U1', 'demo', os.tmpdir());

    await registry.execute('agent', '', ctx);

    expect(responder.post).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Active agent: *cursor*') }),
    );
  });

  it("`agent` with no arg still shows the user's own explicit pick over the project override", async () => {
    const projectRegistry = loadedProjectRegistry({ demo: { path: os.tmpdir(), agent: 'cursor' } });
    const { registry, projectSession, ctx, responder } = setup(
      [fakeAgent('claude'), fakeAgent('cursor')],
      { projectRegistry },
    );
    await projectSession.setActiveProject('test:U1', 'demo', os.tmpdir());
    await registry.execute('agent', 'claude', ctx);
    responder.post.mockClear();

    await registry.execute('agent', '', ctx);

    expect(responder.post).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Active agent: *claude*') }),
    );
  });

  it('`current` shows the effective agent and model for the active project', async () => {
    const projectRegistry = loadedProjectRegistry({
      demo: { path: os.tmpdir(), agent: 'cursor', model: 'gpt-5' },
    });
    const { registry, projectSession, ctx, responder } = setup(
      [fakeAgent('claude'), fakeAgent('cursor')],
      { projectRegistry },
    );
    await projectSession.setActiveProject('test:U1', 'demo', os.tmpdir());

    await registry.execute('current', '', ctx);

    const text = responder.post.mock.calls.at(-1)![0]!.text;
    expect(text).toContain('Agent: *cursor*');
    expect(text).toContain('model: *gpt-5*');
  });

  it('`current` omits the model note when the project has no model override', async () => {
    const projectRegistry = loadedProjectRegistry({ demo: os.tmpdir() });
    const { registry, projectSession, ctx, responder } = setup([fakeAgent('claude')], {
      projectRegistry,
    });
    await projectSession.setActiveProject('test:U1', 'demo', os.tmpdir());

    await registry.execute('current', '', ctx);

    const text = responder.post.mock.calls.at(-1)![0]!.text;
    expect(text).toContain('Agent: *claude*');
    expect(text).not.toContain('model:');
  });
});
