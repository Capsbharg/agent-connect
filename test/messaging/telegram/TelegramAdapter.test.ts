import { describe, expect, it, vi } from 'vitest';

const registeredHandlers = new Map<string, (ctx: unknown) => void | Promise<void>>();
let caughtErrorHandler: ((error: { message: string }) => void | Promise<void>) | null = null;
const fakeApi = {
  getFile: vi.fn(async (fileId: string) => ({ file_path: `files/${fileId}.bin` })),
  sendMessage: vi.fn(),
  editMessageText: vi.fn(),
};
const fakeBot = {
  botInfo: { username: 'TestBot' },
  api: fakeApi,
  init: vi.fn(async () => {}),
  start: vi.fn(async () => new Promise(() => {})), // long-polling loop — never resolves, matches the real bot.start()
  stop: vi.fn(async () => {}),
  on: vi.fn((event: string, handler: (ctx: unknown) => void | Promise<void>) => {
    registeredHandlers.set(event, handler);
  }),
  catch: vi.fn((handler: (error: { message: string }) => void | Promise<void>) => {
    caughtErrorHandler = handler;
  }),
};

vi.mock('grammy', () => ({
  // Must be a real function (not an arrow) so `new Bot(...)` in TelegramAdapter.ts works.
  Bot: vi.fn(function Bot() {
    return fakeBot;
  }),
}));

const { TelegramAdapter, normalizeText } =
  await import('../../../src/messaging/telegram/TelegramAdapter.js');
const { createTestLogger } = await import('../../helpers/testLogger.js');

function baseConfig() {
  return { botToken: 'test-token', editThrottleMs: 1500, progressMaxLines: 12 };
}

describe('normalizeText', () => {
  it('strips a leading slash', () => {
    expect(normalizeText('/help', undefined)).toBe('help');
  });

  it('strips a trailing @BotName mention, case-insensitively', () => {
    expect(normalizeText('/help@TestBot', 'TestBot')).toBe('help');
    expect(normalizeText('use backend-api @testbot', 'TestBot')).toBe('use backend-api');
  });

  it('leaves plain text untouched when there is no bot username to strip', () => {
    expect(normalizeText('use backend-api', undefined)).toBe('use backend-api');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeText('  help  ', undefined)).toBe('help');
  });
});

describe('TelegramAdapter', () => {
  it('throws a ConfigError when constructed with no config and no env vars', async () => {
    const { ConfigError } = await import('../../../src/core/errors.js');
    const original = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    try {
      expect(() => new TelegramAdapter()).toThrow(ConfigError);
    } finally {
      if (original !== undefined) process.env.TELEGRAM_BOT_TOKEN = original;
    }
  });

  it('dispatches a private-chat message as direct, with the bot mention normalized away', async () => {
    const adapter = new TelegramAdapter({ config: baseConfig(), logger: createTestLogger() });
    const received: unknown[] = [];
    adapter.onMessage((message) => {
      received.push(message);
    });

    const handler = registeredHandlers.get('message')!;
    await handler({
      message: { text: '/help@TestBot', from: { id: 42 } },
      chat: { id: 100, type: 'private' },
    });

    expect(received).toEqual([
      expect.objectContaining({
        platform: 'telegram',
        platformUserId: '42',
        channelId: '100',
        isDirect: true,
        isGroup: false,
        text: 'help',
      }),
    ]);
  });

  it('dispatches a group message as non-direct/group', async () => {
    const adapter = new TelegramAdapter({ config: baseConfig(), logger: createTestLogger() });
    const received: unknown[] = [];
    adapter.onMessage((message) => {
      received.push(message);
    });

    const handler = registeredHandlers.get('message')!;
    await handler({
      message: { text: 'use backend-api', from: { id: 42 } },
      chat: { id: -500, type: 'group' },
    });

    expect(received).toEqual([
      expect.objectContaining({
        platform: 'telegram',
        channelId: '-500',
        isDirect: false,
        isGroup: true,
        text: 'use backend-api',
      }),
    ]);
  });

  it('drops a message with no text and no document/photo', async () => {
    const adapter = new TelegramAdapter({ config: baseConfig(), logger: createTestLogger() });
    const received: unknown[] = [];
    adapter.onMessage((message) => {
      received.push(message);
    });

    const handler = registeredHandlers.get('message')!;
    await handler({ message: { from: { id: 42 } }, chat: { id: 100, type: 'private' } });

    expect(received).toEqual([]);
  });

  it('extracts a document attachment, resolving its file URL without leaking the bot token into logs', async () => {
    const adapter = new TelegramAdapter({ config: baseConfig(), logger: createTestLogger() });
    const received: Array<{ attachments?: unknown[] }> = [];
    adapter.onMessage((message) => {
      received.push(message);
    });

    const handler = registeredHandlers.get('message')!;
    await handler({
      message: {
        caption: 'here is the file',
        from: { id: 42 },
        document: { file_id: 'F1', file_name: 'notes.txt', mime_type: 'text/plain' },
      },
      chat: { id: 100, type: 'private' },
    });

    expect(received).toHaveLength(1);
    expect(received[0]!.attachments).toEqual([
      expect.objectContaining({
        filename: 'notes.txt',
        mimeType: 'text/plain',
        url: expect.stringContaining('files/F1.bin'),
      }),
    ]);
  });

  it('createResponder() returns a StreamingResponder-shaped object', () => {
    const adapter = new TelegramAdapter({ config: baseConfig(), logger: createTestLogger() });
    const responder = adapter.createResponder({ platform: 'telegram', channelId: '100' });
    expect(responder).toEqual(
      expect.objectContaining({
        post: expect.any(Function),
        update: expect.any(Function),
        complete: expect.any(Function),
      }),
    );
  });

  it('logs unhandled grammY errors instead of throwing', () => {
    const logger = createTestLogger();
    new TelegramAdapter({ config: baseConfig(), logger });
    expect(caughtErrorHandler).not.toBeNull();
    caughtErrorHandler!({ message: 'boom' });
    expect(logger.error).toHaveBeenCalledWith('Unhandled Telegram (grammY) error', {
      error: 'boom',
    });
  });
});
