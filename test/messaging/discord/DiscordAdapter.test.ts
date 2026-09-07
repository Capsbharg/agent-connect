import { describe, expect, it, vi } from 'vitest';

// DiscordAdapter.ts does `new Client({...})` and imports Events/GatewayIntentBits/
// Partials as values — mock the whole module so constructing a DiscordAdapter
// never touches the real discord.js SDK (which would otherwise try to open a
// real gateway connection).
const registeredHandlers = new Map<string, (...args: unknown[]) => void | Promise<void>>();
let onceReadyHandler: (() => void) | null = null;

function fakeMessage(text: string) {
  return { id: 'm1', content: text, edit: vi.fn(async () => {}) };
}

const fakeChannel = {
  isSendable: () => true,
  send: vi.fn(async (text: string) => fakeMessage(text)),
};

const fakeClient = {
  user: { id: 'BOT_ID' },
  on: vi.fn((event: string, handler: (...args: unknown[]) => void | Promise<void>) => {
    registeredHandlers.set(event, handler);
  }),
  once: vi.fn((event: string, handler: () => void) => {
    if (event === 'clientReady') onceReadyHandler = handler;
  }),
  login: vi.fn(async () => 'fake-token'),
  destroy: vi.fn(async () => {}),
  channels: { fetch: vi.fn(async () => fakeChannel) },
};

vi.mock('discord.js', () => ({
  // Must be a real function (not an arrow) so `new Client(...)` in DiscordAdapter.ts works.
  Client: vi.fn(function Client() {
    return fakeClient;
  }),
  Events: { MessageCreate: 'messageCreate', ClientReady: 'clientReady', Error: 'error' },
  GatewayIntentBits: { Guilds: 1, GuildMessages: 512, DirectMessages: 4096, MessageContent: 32768 },
  Partials: { Channel: 1 },
}));

const { DiscordAdapter, stripMentionTags } =
  await import('../../../src/messaging/discord/DiscordAdapter.js');
const { createTestLogger } = await import('../../helpers/testLogger.js');

function baseConfig() {
  return { botToken: 'discord-test-token', editThrottleMs: 1500, progressMaxLines: 12 };
}

function guildMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    author: { id: 'U1', bot: false },
    content: '<@999999999999999999> use backend-api',
    channelId: 'C1',
    guildId: 'G1',
    mentions: { has: () => true },
    attachments: { values: () => [].values() },
    ...overrides,
  };
}

function dmMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    author: { id: 'U1', bot: false },
    content: 'help',
    channelId: 'D1',
    guildId: null,
    mentions: { has: () => false },
    attachments: { values: () => [].values() },
    ...overrides,
  };
}

describe('stripMentionTags', () => {
  it('removes a Discord mention tag and trims surrounding whitespace', () => {
    expect(stripMentionTags('<@123456789> use backend-api')).toBe('use backend-api');
  });

  it('handles the legacy nickname-mention form <@!id>', () => {
    expect(stripMentionTags('<@!123456789> hello')).toBe('hello');
  });

  it('leaves plain text untouched', () => {
    expect(stripMentionTags('use backend-api')).toBe('use backend-api');
  });

  it('handles an empty string', () => {
    expect(stripMentionTags('')).toBe('');
  });
});

describe('DiscordAdapter', () => {
  it('throws a ConfigError when constructed with no config and no env vars', async () => {
    const { ConfigError } = await import('../../../src/core/errors.js');
    const original = process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_BOT_TOKEN;
    try {
      expect(() => new DiscordAdapter()).toThrow(ConfigError);
    } finally {
      if (original !== undefined) process.env.DISCORD_BOT_TOKEN = original;
    }
  });

  it('dispatches a DM as a direct InboundMessage without requiring a mention', async () => {
    const adapter = new DiscordAdapter({ config: baseConfig(), logger: createTestLogger() });
    const received: unknown[] = [];
    adapter.onMessage((message) => {
      received.push(message);
    });

    const handler = registeredHandlers.get('messageCreate')!;
    await handler(dmMessage());

    expect(received).toEqual([
      expect.objectContaining({
        platform: 'discord',
        platformUserId: 'U1',
        channelId: 'D1',
        isDirect: true,
        isGroup: false,
        text: 'help',
      }),
    ]);
  });

  it('dispatches a guild channel message that mentions the bot, with the mention stripped', async () => {
    const adapter = new DiscordAdapter({ config: baseConfig(), logger: createTestLogger() });
    const received: unknown[] = [];
    adapter.onMessage((message) => {
      received.push(message);
    });

    const handler = registeredHandlers.get('messageCreate')!;
    await handler(guildMessage());

    expect(received).toEqual([
      expect.objectContaining({
        platform: 'discord',
        channelId: 'C1',
        isDirect: false,
        text: 'use backend-api',
      }),
    ]);
  });

  it('ignores a guild channel message that does not mention the bot', async () => {
    const adapter = new DiscordAdapter({ config: baseConfig(), logger: createTestLogger() });
    const received: unknown[] = [];
    adapter.onMessage((message) => {
      received.push(message);
    });

    const handler = registeredHandlers.get('messageCreate')!;
    await handler(guildMessage({ mentions: { has: () => false } }));

    expect(received).toEqual([]);
  });

  it("ignores messages authored by a bot (never routes a bot's own messages back in)", async () => {
    const adapter = new DiscordAdapter({ config: baseConfig(), logger: createTestLogger() });
    const received: unknown[] = [];
    adapter.onMessage((message) => {
      received.push(message);
    });

    const handler = registeredHandlers.get('messageCreate')!;
    await handler(dmMessage({ author: { id: 'OTHER_BOT', bot: true } }));

    expect(received).toEqual([]);
  });

  it('drops a message with no text and no attachments', async () => {
    const adapter = new DiscordAdapter({ config: baseConfig(), logger: createTestLogger() });
    const received: unknown[] = [];
    adapter.onMessage((message) => {
      received.push(message);
    });

    const handler = registeredHandlers.get('messageCreate')!;
    await handler(dmMessage({ content: '' }));

    expect(received).toEqual([]);
  });

  it('extracts attachments', async () => {
    const adapter = new DiscordAdapter({ config: baseConfig(), logger: createTestLogger() });
    const received: Array<{ attachments?: unknown[] }> = [];
    adapter.onMessage((message) => {
      received.push(message);
    });

    const attachment = {
      name: 'notes.txt',
      contentType: 'text/plain',
      url: 'https://cdn.discord/notes.txt',
    };
    const handler = registeredHandlers.get('messageCreate')!;
    await handler(
      dmMessage({ content: 'here', attachments: { values: () => [attachment].values() } }),
    );

    expect(received).toHaveLength(1);
    expect(received[0]!.attachments).toEqual([
      expect.objectContaining({
        filename: 'notes.txt',
        mimeType: 'text/plain',
        url: 'https://cdn.discord/notes.txt',
      }),
    ]);
  });

  it('createResponder() returns a StreamingResponder-shaped object', () => {
    const adapter = new DiscordAdapter({ config: baseConfig(), logger: createTestLogger() });
    const responder = adapter.createResponder({ platform: 'discord', channelId: 'C1' });
    expect(responder).toEqual(
      expect.objectContaining({
        post: expect.any(Function),
        update: expect.any(Function),
        complete: expect.any(Function),
      }),
    );
  });

  it('start() logs in and waits for the client-ready event before resolving; stop() destroys the client', async () => {
    const adapter = new DiscordAdapter({ config: baseConfig(), logger: createTestLogger() });

    let started = false;
    const startPromise = adapter.start().then(() => {
      started = true;
    });
    // start() registers the once('clientReady', ...) handler synchronously
    // before its first await, so it's already available here.
    expect(started).toBe(false);
    onceReadyHandler!();
    await startPromise;

    expect(fakeClient.login).toHaveBeenCalledWith('discord-test-token');
    expect(started).toBe(true);

    await adapter.stop();
    expect(fakeClient.destroy).toHaveBeenCalled();
  });

  it('logs unhandled discord.js client errors instead of throwing', () => {
    const logger = createTestLogger();
    new DiscordAdapter({ config: baseConfig(), logger });

    const errorHandler = registeredHandlers.get('error') as (error: Error) => void;
    expect(errorHandler).toBeTypeOf('function');
    errorHandler(new Error('boom'));
    expect(logger.error).toHaveBeenCalledWith('Unhandled Discord (discord.js) error', {
      error: 'boom',
    });
  });
});
