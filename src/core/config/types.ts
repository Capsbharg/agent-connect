export interface SecurityConfig {
  allowedUsers: string[];
  allowedChannels: string[];
  allowedGroups: string[];
}

export interface AdminConfig {
  enabled: boolean;
  port: number;
}

export interface SlackConfig {
  botToken: string;
  signingSecret: string;
  appToken: string;
  editThrottleMs: number;
  progressMaxLines: number;
}

export interface TelegramConfig {
  botToken: string;
  editThrottleMs: number;
  progressMaxLines: number;
}

export interface ClaudeConfig {
  cliPath: string;
  timeoutMs: number;
  /** Passes `--dangerously-skip-permissions` to run headless. Defaults to true (including when omitted entirely) — set to false to require the CLI's own per-action confirmation (only meaningful if you run the CLI in a context that can prompt). */
  dangerouslySkipPermissions?: boolean;
}

export interface CursorConfig {
  cliPath: string;
  apiKey?: string;
  timeoutMs: number;
  /** Passes `--force` to run headless. Defaults to true (including when omitted entirely) — set to false to require the CLI's own per-action confirmation. */
  force?: boolean;
}

export interface CodexConfig {
  cliPath: string;
  timeoutMs: number;
}

export interface GeminiConfig {
  cliPath: string;
  timeoutMs: number;
  /** Passes `--yolo` to auto-approve every tool call, so the CLI can run headless. Defaults to true (including when omitted entirely) — set to false to require the CLI's own per-action confirmation. */
  yolo?: boolean;
}

/**
 * Everything AgentConnect.fromEnv() needs to assemble a fully working app.
 * Manual `new AgentConnect({...})` usage bypasses this entirely and injects
 * adapters/agents/providers directly.
 */
export interface ResolvedConfig {
  logLevel: string;
  redisUrl?: string;
  /** Prefixes every Redis key this app owns (session storage, and BullMQ's own queue keys) — set when a Redis instance is shared with other apps to avoid key collisions. */
  redisKeyPrefix?: string;
  projectsConfigPath: string;
  defaultAgent: string;
  agentWorkerConcurrency: number;
  /** Max executions (running + queued) a single identity may have outstanding at once; further prompts are rejected with a reminder instead of queuing indefinitely. 0 = unlimited. */
  maxQueuedPerIdentity: number;
  admin: AdminConfig;
  security: SecurityConfig;
  slack?: SlackConfig;
  telegram?: TelegramConfig;
  claude?: ClaudeConfig;
  cursor?: CursorConfig;
  codex?: CodexConfig;
  gemini?: GeminiConfig;
}
