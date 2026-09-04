import { describe, expect, it, vi } from 'vitest';

// SlackApp.ts does `new App({...})` — mock the whole module so constructing a
// SlackAdapter never touches the real Bolt SDK (which would otherwise try to
// validate Socket Mode config at construction time).
const registeredEventHandlers = new Map<
  string,
  (arg: { event: unknown }) => void | Promise<void>
>();
let errorHandler: ((error: Error) => void | Promise<void>) | null = null;
const fakeApp = {
  client: {},
  event: vi.fn((name: string, handler: (arg: { event: unknown }) => void | Promise<void>) => {
    registeredEventHandlers.set(name, handler);
  }),
  error: vi.fn((handler: (error: Error) => void | Promise<void>) => {
    errorHandler = handler;
  }),
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
};

vi.mock('@slack/bolt', () => ({
  // Must be a real function (not an arrow) so `new App(...)` in SlackApp.ts works.
  App: vi.fn(function App() {
    return fakeApp;
  }),
}));

const { SlackAdapter, stripMentionTags } =
  await import('../../../src/messaging/slack/SlackAdapter.js');
const { createTestLogger } = await import('../../helpers/testLogger.js');

function baseConfig() {
  return {
    botToken: 'xoxb-test',
    signingSecret: 'secret',
    appToken: 'xapp-test',
    editThrottleMs: 1500,
    progressMaxLines: 12,
  };
}

describe('stripMentionTags', () => {
  it('removes a Slack mention tag and trims surrounding whitespace', () => {
    expect(stripMentionTags('<@U123> use backend-api')).toBe('use backend-api');
  });

  it('handles a mention with a display-name pipe', () => {
    expect(stripMentionTags('<@U123|somebody> hello')).toBe('hello');
  });

  it('leaves plain text untouched', () => {
    expect(stripMentionTags('use backend-api')).toBe('use backend-api');
  });

  it('handles an empty string', () => {
    expect(stripMentionTags('')).toBe('');
  });
});

describe('SlackAdapter', () => {
  it('throws a ConfigError when constructed with no config and no env vars', async () => {
    const { ConfigError } = await import('../../../src/core/errors.js');
    const originalEnv = { ...process.env };
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_APP_TOKEN;
    try {
      expect(() => new SlackAdapter()).toThrow(ConfigError);
    } finally {
      process.env = originalEnv;
    }
  });

  it('dispatches app_mention as a non-direct InboundMessage with the mention stripped', async () => {
    const adapter = new SlackAdapter({ config: baseConfig(), logger: createTestLogger() });
    const received: unknown[] = [];
    adapter.onMessage((message) => {
      received.push(message);
    });

    const handler = registeredEventHandlers.get('app_mention')!;
    await handler({
      event: {
        user: 'U1',
        text: '<@BOT> use backend-api',
        channel: 'C1',
        ts: '100.1',
        thread_ts: undefined,
      },
    });

    expect(received).toEqual([
      expect.objectContaining({
        platform: 'slack',
        platformUserId: 'U1',
        channelId: 'C1',
        threadId: '100.1',
        isDirect: false,
        isGroup: false,
        text: 'use backend-api',
      }),
    ]);
  });

  it('dispatches message.im as a direct InboundMessage with no threadId', async () => {
    const adapter = new SlackAdapter({ config: baseConfig(), logger: createTestLogger() });
    const received: unknown[] = [];
    adapter.onMessage((message) => {
      received.push(message);
    });

    const handler = registeredEventHandlers.get('message')!;
    await handler({ event: { user: 'U1', text: 'help', channel: 'D1', ts: '100.1' } });

    expect(received).toEqual([
      expect.objectContaining({
        platform: 'slack',
        channelId: 'D1',
        isDirect: true,
        threadId: undefined,
        text: 'help',
      }),
    ]);
  });

  it("ignores events carrying bot_id (never routes a bot's own messages back in)", async () => {
    const adapter = new SlackAdapter({ config: baseConfig(), logger: createTestLogger() });
    const received: unknown[] = [];
    adapter.onMessage((message) => {
      received.push(message);
    });

    const handler = registeredEventHandlers.get('message')!;
    await handler({ event: { user: 'U1', text: 'hi', channel: 'D1', ts: '1', bot_id: 'B1' } });

    expect(received).toEqual([]);
  });

  it('ignores events carrying a subtype (message_changed, channel_join, etc.)', async () => {
    const adapter = new SlackAdapter({ config: baseConfig(), logger: createTestLogger() });
    const received: unknown[] = [];
    adapter.onMessage((message) => {
      received.push(message);
    });

    const handler = registeredEventHandlers.get('message')!;
    await handler({
      event: { user: 'U1', text: 'hi', channel: 'D1', ts: '1', subtype: 'message_changed' },
    });

    expect(received).toEqual([]);
  });

  it('createResponder() returns a StreamingResponder-shaped object', () => {
    const adapter = new SlackAdapter({ config: baseConfig(), logger: createTestLogger() });
    const responder = adapter.createResponder({ platform: 'slack', channelId: 'C1' });
    expect(responder).toEqual(
      expect.objectContaining({
        post: expect.any(Function),
        update: expect.any(Function),
        complete: expect.any(Function),
      }),
    );
  });

  it('start()/stop() delegate to the underlying Bolt app', async () => {
    const adapter = new SlackAdapter({ config: baseConfig(), logger: createTestLogger() });
    await adapter.start();
    expect(fakeApp.start).toHaveBeenCalled();
    await adapter.stop();
    expect(fakeApp.stop).toHaveBeenCalled();
  });

  it('logs unhandled Bolt errors instead of throwing', () => {
    const logger = createTestLogger();
    new SlackAdapter({ config: baseConfig(), logger });
    expect(errorHandler).not.toBeNull();
    errorHandler!(new Error('boom'));
    expect(logger.error).toHaveBeenCalledWith('Unhandled Slack (Bolt) error', { error: 'boom' });
  });
});
