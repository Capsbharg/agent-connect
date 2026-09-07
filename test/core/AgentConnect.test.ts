import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentConnect } from '../../src/core/AgentConnect.js';
import { ConfigError } from '../../src/core/errors.js';
import { InMemoryQueueProvider } from '../../src/core/queue/InMemoryQueueProvider.js';
import { InMemoryStorageProvider } from '../../src/core/storage/InMemoryStorageProvider.js';
import { ProjectSession } from '../../src/core/project/ProjectSession.js';
import type { AgentAdapter } from '../../src/interfaces/AgentAdapter.js';
import type { MessagingAdapter } from '../../src/interfaces/MessagingAdapter.js';
import type { ExecutionJobPayload, InboundMessage, ReplyContent } from '../../src/core/types.js';
import { createTestLogger } from '../helpers/testLogger.js';

function fakeAgent(name = 'claude'): AgentAdapter {
  return {
    name,
    healthCheck: async () => ({ healthy: true }),
    execute: () => ({
      cancel: () => {},
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
}

function fakeResponder() {
  return {
    post: vi.fn(async (_content: ReplyContent) => {}),
    update: vi.fn(async (_content: ReplyContent) => {}),
    complete: vi.fn(async (_content: ReplyContent) => {}),
  };
}

function fakeAdapter(responder: ReturnType<typeof fakeResponder>) {
  let handler: ((message: InboundMessage) => void | Promise<void>) | null = null;
  const adapter: MessagingAdapter = {
    platform: 'test',
    capabilities: { threads: true, fileUploads: false, slashCommands: false },
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    onMessage: (h) => {
      handler = h;
    },
    createResponder: vi.fn(() => responder),
  };
  return { adapter, emit: (message: InboundMessage) => handler?.(message) };
}

// A directory guaranteed not to contain a projects.json, so ProjectRegistry.load()
// just logs a warning and moves on rather than picking up an unrelated file.
const emptyProjectsConfigPath = path.join(
  os.tmpdir(),
  `agent-connect-test-${Date.now()}-projects.json`,
);

describe('AgentConnect constructor validation', () => {
  it('throws a ConfigError with zero messaging adapters', () => {
    expect(() => new AgentConnect({ messaging: [], agents: [fakeAgent()] })).toThrow(ConfigError);
  });

  it('throws a ConfigError with zero agents', () => {
    const { adapter } = fakeAdapter(fakeResponder());
    expect(() => new AgentConnect({ messaging: [adapter], agents: [] })).toThrow(ConfigError);
  });
});

describe('AgentConnect.fromEnv()', () => {
  it('throws when no messaging platform is configured', () => {
    expect(() => AgentConnect.fromEnv({})).toThrow(/no messaging platform configured/);
  });

  it('throws when no agent is enabled', () => {
    expect(() =>
      AgentConnect.fromEnv({ TELEGRAM_BOT_TOKEN: 'tok', CLAUDE_ENABLED: 'false' }),
    ).toThrow(/no agent enabled/);
  });

  it('throws when DEFAULT_AGENT does not match an enabled agent', () => {
    expect(() =>
      AgentConnect.fromEnv({ TELEGRAM_BOT_TOKEN: 'tok', DEFAULT_AGENT: 'cursor' }),
    ).toThrow(/DEFAULT_AGENT/);
  });

  it('builds successfully with a valid Telegram + Claude configuration', () => {
    const app = AgentConnect.fromEnv({ TELEGRAM_BOT_TOKEN: 'tok', ADMIN_ENABLED: 'false' });
    expect(app).toBeInstanceOf(AgentConnect);
  });

  it('builds successfully with Gemini registered and selected as the default agent', () => {
    const app = AgentConnect.fromEnv({
      TELEGRAM_BOT_TOKEN: 'tok',
      ADMIN_ENABLED: 'false',
      CLAUDE_ENABLED: 'false',
      GEMINI_ENABLED: 'true',
      DEFAULT_AGENT: 'gemini',
    });
    expect(app).toBeInstanceOf(AgentConnect);
  });

  it('builds successfully with only Discord configured as the messaging platform', () => {
    const app = AgentConnect.fromEnv({
      DISCORD_BOT_TOKEN: 'discord-token',
      ADMIN_ENABLED: 'false',
    });
    expect(app).toBeInstanceOf(AgentConnect);
  });
});

describe('AgentConnect.start() security warning', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a loud warning when no allowlist is configured (the default)', async () => {
    const { adapter } = fakeAdapter(fakeResponder());
    const logger = createTestLogger();
    const app = new AgentConnect({
      messaging: [adapter],
      agents: [fakeAgent()],
      logger,
      projectsConfigPath: emptyProjectsConfigPath,
    });

    await app.start();
    try {
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('SECURITY'));
    } finally {
      await app.stop();
    }
  });

  it('does not warn once at least one allowlist is configured', async () => {
    const { adapter } = fakeAdapter(fakeResponder());
    const logger = createTestLogger();
    const app = new AgentConnect({
      messaging: [adapter],
      agents: [fakeAgent()],
      logger,
      projectsConfigPath: emptyProjectsConfigPath,
      security: { allowedUsers: ['U1'], allowedChannels: [], allowedGroups: [] },
    });

    await app.start();
    try {
      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('SECURITY'));
    } finally {
      await app.stop();
    }
  });

  it('does not warn when a custom AuthorizationProvider is supplied (unrestricted-ness is unknowable from here)', async () => {
    const { adapter } = fakeAdapter(fakeResponder());
    const logger = createTestLogger();
    const app = new AgentConnect({
      messaging: [adapter],
      agents: [fakeAgent()],
      logger,
      projectsConfigPath: emptyProjectsConfigPath,
      authorization: { isAllowed: async () => true },
    });

    await app.start();
    try {
      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('SECURITY'));
    } finally {
      await app.stop();
    }
  });
});

describe('AgentConnect flood control wiring', () => {
  it('enforces maxQueuedPerIdentity end-to-end through Router', async () => {
    const responder = fakeResponder();
    const { adapter, emit } = fakeAdapter(responder);
    const storage = new InMemoryStorageProvider();
    const queue = new InMemoryQueueProvider<ExecutionJobPayload>();
    // Never resolves — keeps the first execution "active" for the whole test,
    // so the second message deterministically finds the limit already hit
    // instead of racing the in-memory queue's near-instant drain.
    const neverFinishingAgent: AgentAdapter = {
      name: 'claude',
      healthCheck: async () => ({ healthy: true }),
      execute: () => ({ cancel: () => {}, result: new Promise(() => {}) }),
    };

    const app = new AgentConnect({
      messaging: [adapter],
      agents: [neverFinishingAgent],
      storage,
      queue,
      logger: createTestLogger(),
      projectsConfigPath: emptyProjectsConfigPath,
      maxQueuedPerIdentity: 1,
    });
    await app.start();

    try {
      // Same key scheme ProjectSession uses internally, sharing the same storage instance.
      await new ProjectSession(storage).setActiveProject('test:U1', 'demo', os.tmpdir());

      await emit({
        platform: 'test',
        platformUserId: 'U1',
        channelId: 'C1',
        isDirect: true,
        text: 'first',
        raw: {},
      });
      // Wait until ExecutionManager has actually picked the job up (posted
      // its "Working on" progress message, right before registering it as
      // active) so the second message deterministically sees it outstanding,
      // rather than racing the in-memory queue's own drain.
      await vi.waitFor(() =>
        expect(responder.post).toHaveBeenCalledWith(
          expect.objectContaining({ text: expect.stringContaining('Working on: first') }),
        ),
      );
      await emit({
        platform: 'test',
        platformUserId: 'U1',
        channelId: 'C1',
        isDirect: true,
        text: 'second',
        raw: {},
      });

      expect(responder.post).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('max 1') }),
      );
    } finally {
      await app.stop();
    }
  });

  it('maxQueuedPerIdentity: 0 disables the limit', async () => {
    const responder = fakeResponder();
    const { adapter, emit } = fakeAdapter(responder);
    const storage = new InMemoryStorageProvider();
    const queue = new InMemoryQueueProvider<ExecutionJobPayload>();

    const app = new AgentConnect({
      messaging: [adapter],
      agents: [fakeAgent()],
      storage,
      queue,
      logger: createTestLogger(),
      projectsConfigPath: emptyProjectsConfigPath,
      maxQueuedPerIdentity: 0,
    });
    await app.start();

    try {
      await new ProjectSession(storage).setActiveProject('test:U1', 'demo', os.tmpdir());
      for (const text of ['a', 'b', 'c']) {
        await emit({
          platform: 'test',
          platformUserId: 'U1',
          channelId: 'C1',
          isDirect: true,
          text,
          raw: {},
        });
      }
      const calls = responder.post.mock.calls.map((call) => (call[0]! as { text: string }).text);
      expect(calls.some((text) => text.includes('max'))).toBe(false);
    } finally {
      await app.stop();
    }
  });
});
