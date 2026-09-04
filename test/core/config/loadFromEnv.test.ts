import { describe, expect, it } from 'vitest';
import { loadFromEnv } from '../../../src/core/config/loadFromEnv.js';
import { ConfigError } from '../../../src/core/errors.js';

describe('loadFromEnv', () => {
  it('applies every documented default when the environment is otherwise empty', () => {
    const config = loadFromEnv({});

    expect(config.logLevel).toBe('info');
    expect(config.defaultAgent).toBe('claude');
    expect(config.agentWorkerConcurrency).toBe(4);
    expect(config.maxQueuedPerIdentity).toBe(20);
    expect(config.admin).toEqual({ enabled: true, port: 3000 });
    expect(config.security).toEqual({ allowedUsers: [], allowedChannels: [], allowedGroups: [] });
    expect(config.redisUrl).toBeUndefined();
    expect(config.redisKeyPrefix).toBeUndefined();
    expect(config.slack).toBeUndefined();
    expect(config.telegram).toBeUndefined();
    // Claude is enabled by default and defaults to the (documented, security-relevant) headless flags.
    expect(config.claude).toEqual({
      cliPath: 'claude',
      timeoutMs: 600_000,
      dangerouslySkipPermissions: true,
    });
    expect(config.cursor).toBeUndefined();
    expect(config.codex).toBeUndefined();
    expect(config.gemini).toBeUndefined();
  });

  it('throws a ConfigError when Slack is only partially configured', () => {
    expect(() => loadFromEnv({ SLACK_BOT_TOKEN: 'xoxb-1' })).toThrow(ConfigError);
    try {
      loadFromEnv({ SLACK_BOT_TOKEN: 'xoxb-1' });
    } catch (error) {
      expect((error as ConfigError).message).toContain('SLACK_SIGNING_SECRET');
      expect((error as ConfigError).message).toContain('SLACK_APP_TOKEN');
    }
  });

  it('resolves a fully-configured Slack block', () => {
    const config = loadFromEnv({
      SLACK_BOT_TOKEN: 'xoxb-1',
      SLACK_SIGNING_SECRET: 'secret',
      SLACK_APP_TOKEN: 'xapp-1',
    });
    expect(config.slack).toEqual({
      botToken: 'xoxb-1',
      signingSecret: 'secret',
      appToken: 'xapp-1',
      editThrottleMs: 1500,
      progressMaxLines: 12,
    });
  });

  it('CLAUDE_ENABLED=false disables Claude and stops it appearing in the resolved config', () => {
    const config = loadFromEnv({ CLAUDE_ENABLED: 'false' });
    expect(config.claude).toBeUndefined();
  });

  it('CLAUDE_SKIP_PERMISSIONS=false is honored (opt-out of the headless default)', () => {
    const config = loadFromEnv({ CLAUDE_SKIP_PERMISSIONS: 'false' });
    expect(config.claude?.dangerouslySkipPermissions).toBe(false);
  });

  it('CURSOR_ENABLED=true resolves a Cursor block with force defaulting to true', () => {
    const config = loadFromEnv({ CURSOR_ENABLED: 'true', CURSOR_API_KEY: 'key-1' });
    expect(config.cursor).toEqual({
      cliPath: 'cursor-agent',
      apiKey: 'key-1',
      timeoutMs: 600_000,
      force: true,
    });
  });

  it('CURSOR_FORCE=false is honored', () => {
    const config = loadFromEnv({ CURSOR_ENABLED: 'true', CURSOR_FORCE: 'false' });
    expect(config.cursor?.force).toBe(false);
  });

  it('parses ALLOWED_* comma-separated lists, trimming whitespace and dropping empties', () => {
    const config = loadFromEnv({ ALLOWED_USERS: ' U1, U2 ,,U3' });
    expect(config.security.allowedUsers).toEqual(['U1', 'U2', 'U3']);
  });

  it('MAX_QUEUED_PER_IDENTITY=0 is preserved as unlimited (not overridden by the default)', () => {
    const config = loadFromEnv({ MAX_QUEUED_PER_IDENTITY: '0' });
    expect(config.maxQueuedPerIdentity).toBe(0);
  });

  it('resolves REDIS_KEY_PREFIX when set', () => {
    const config = loadFromEnv({ REDIS_URL: 'redis://localhost:6379', REDIS_KEY_PREFIX: 'myapp:' });
    expect(config.redisKeyPrefix).toBe('myapp:');
  });

  it('rejects a non-numeric AGENT_WORKER_CONCURRENCY with a ConfigError', () => {
    expect(() => loadFromEnv({ AGENT_WORKER_CONCURRENCY: 'not-a-number' })).toThrow(ConfigError);
  });

  it('GEMINI_ENABLED=true resolves a Gemini block with yolo defaulting to true', () => {
    const config = loadFromEnv({ GEMINI_ENABLED: 'true' });
    expect(config.gemini).toEqual({ cliPath: 'gemini', timeoutMs: 600_000, yolo: true });
  });

  it('GEMINI_YOLO=false is honored (opt-out of the headless default)', () => {
    const config = loadFromEnv({ GEMINI_ENABLED: 'true', GEMINI_YOLO: 'false' });
    expect(config.gemini?.yolo).toBe(false);
  });

  it('Gemini stays disabled by default even though it is not gated the same way Claude is', () => {
    expect(loadFromEnv({}).gemini).toBeUndefined();
    expect(loadFromEnv({ GEMINI_CLI_PATH: '/custom/gemini' }).gemini).toBeUndefined();
  });
});
