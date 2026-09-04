import path from 'node:path';
import { z } from 'zod';
import { ConfigError } from '../errors.js';
import type { ResolvedConfig } from './types.js';

const boolString = z
  .string()
  .optional()
  .transform((value) => value?.toLowerCase() !== 'false');

const rawEnvSchema = z.object({
  LOG_LEVEL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  REDIS_KEY_PREFIX: z.string().optional(),
  PROJECTS_CONFIG_PATH: z.string().optional(),
  DEFAULT_AGENT: z.string().optional(),
  AGENT_WORKER_CONCURRENCY: z.coerce.number().int().positive().optional(),
  MAX_QUEUED_PER_IDENTITY: z.coerce.number().int().nonnegative().optional(),
  ADMIN_ENABLED: boolString,
  ADMIN_PORT: z.coerce.number().int().positive().optional(),

  ALLOWED_USERS: z.string().optional(),
  ALLOWED_CHANNELS: z.string().optional(),
  ALLOWED_GROUPS: z.string().optional(),

  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_APP_TOKEN: z.string().optional(),
  SLACK_EDIT_THROTTLE_MS: z.coerce.number().int().nonnegative().optional(),
  SLACK_PROGRESS_MAX_LINES: z.coerce.number().int().positive().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_EDIT_THROTTLE_MS: z.coerce.number().int().nonnegative().optional(),
  TELEGRAM_PROGRESS_MAX_LINES: z.coerce.number().int().positive().optional(),

  CLAUDE_ENABLED: boolString,
  CLAUDE_CLI_PATH: z.string().optional(),
  CLAUDE_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  CLAUDE_SKIP_PERMISSIONS: boolString,

  CURSOR_ENABLED: z.string().optional(),
  CURSOR_CLI_PATH: z.string().optional(),
  CURSOR_API_KEY: z.string().optional(),
  CURSOR_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  CURSOR_FORCE: boolString,

  CODEX_ENABLED: z.string().optional(),
  CODEX_CLI_PATH: z.string().optional(),
  CODEX_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
});

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Parses and validates process.env into a ResolvedConfig, failing fast with a
 * clear error — same philosophy as the original src/config.js, generalized
 * across multiple optional messaging platforms and agents instead of one
 * hard-required Slack config.
 */
export function loadFromEnv(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const parsed = rawEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid environment configuration: ${parsed.error.message}`);
  }
  const raw = parsed.data;

  let slack: ResolvedConfig['slack'];
  const slackFieldsPresent = [
    raw.SLACK_BOT_TOKEN,
    raw.SLACK_SIGNING_SECRET,
    raw.SLACK_APP_TOKEN,
  ].filter(Boolean).length;
  if (slackFieldsPresent > 0) {
    const missing: string[] = [];
    if (!raw.SLACK_BOT_TOKEN) missing.push('SLACK_BOT_TOKEN');
    if (!raw.SLACK_SIGNING_SECRET) missing.push('SLACK_SIGNING_SECRET');
    if (!raw.SLACK_APP_TOKEN) missing.push('SLACK_APP_TOKEN');
    if (missing.length > 0) {
      throw new ConfigError(`Slack is partially configured; missing: ${missing.join(', ')}`);
    }
    slack = {
      botToken: raw.SLACK_BOT_TOKEN!,
      signingSecret: raw.SLACK_SIGNING_SECRET!,
      appToken: raw.SLACK_APP_TOKEN!,
      editThrottleMs: raw.SLACK_EDIT_THROTTLE_MS ?? 1500,
      progressMaxLines: raw.SLACK_PROGRESS_MAX_LINES ?? 12,
    };
  }

  let telegram: ResolvedConfig['telegram'];
  if (raw.TELEGRAM_BOT_TOKEN) {
    telegram = {
      botToken: raw.TELEGRAM_BOT_TOKEN,
      editThrottleMs: raw.TELEGRAM_EDIT_THROTTLE_MS ?? 1500,
      progressMaxLines: raw.TELEGRAM_PROGRESS_MAX_LINES ?? 12,
    };
  }

  const claude: ResolvedConfig['claude'] = raw.CLAUDE_ENABLED
    ? {
        cliPath: raw.CLAUDE_CLI_PATH ?? 'claude',
        timeoutMs: raw.CLAUDE_TIMEOUT_MS ?? 600_000,
        dangerouslySkipPermissions: raw.CLAUDE_SKIP_PERMISSIONS,
      }
    : undefined;

  const cursorEnabled = (raw.CURSOR_ENABLED ?? 'false').toLowerCase() === 'true';
  const cursor: ResolvedConfig['cursor'] = cursorEnabled
    ? {
        cliPath: raw.CURSOR_CLI_PATH ?? 'cursor-agent',
        apiKey: raw.CURSOR_API_KEY,
        timeoutMs: raw.CURSOR_TIMEOUT_MS ?? 600_000,
        force: raw.CURSOR_FORCE,
      }
    : undefined;

  const codexEnabled = (raw.CODEX_ENABLED ?? 'false').toLowerCase() === 'true';
  const codex: ResolvedConfig['codex'] = codexEnabled
    ? {
        cliPath: raw.CODEX_CLI_PATH ?? 'codex',
        timeoutMs: raw.CODEX_TIMEOUT_MS ?? 600_000,
      }
    : undefined;

  // Whole-app validation (at least one platform/agent configured, DEFAULT_AGENT
  // matches an enabled agent) is AgentConnect.fromEnv()'s job, not this
  // function's — a single adapter/agent class resolving just its own slice of
  // env config (e.g. `new SlackAdapter()`) must not fail because of an
  // unrelated agent being unconfigured.
  const defaultAgent = raw.DEFAULT_AGENT ?? 'claude';

  return {
    logLevel: raw.LOG_LEVEL ?? 'info',
    redisUrl: raw.REDIS_URL,
    redisKeyPrefix: raw.REDIS_KEY_PREFIX,
    projectsConfigPath: raw.PROJECTS_CONFIG_PATH ?? path.join(process.cwd(), 'projects.json'),
    defaultAgent,
    agentWorkerConcurrency: raw.AGENT_WORKER_CONCURRENCY ?? 4,
    maxQueuedPerIdentity: raw.MAX_QUEUED_PER_IDENTITY ?? 20,
    admin: {
      enabled: raw.ADMIN_ENABLED,
      port: raw.ADMIN_PORT ?? 3000,
    },
    security: {
      allowedUsers: splitList(raw.ALLOWED_USERS),
      allowedChannels: splitList(raw.ALLOWED_CHANNELS),
      allowedGroups: splitList(raw.ALLOWED_GROUPS),
    },
    slack,
    telegram,
    claude,
    cursor,
    codex,
  };
}
