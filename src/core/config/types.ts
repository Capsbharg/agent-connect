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
}

export interface CursorConfig {
  cliPath: string;
  apiKey?: string;
  timeoutMs: number;
}

export interface CodexConfig {
  cliPath: string;
  timeoutMs: number;
}

/**
 * Everything AgentConnect.fromEnv() needs to assemble a fully working app.
 * Manual `new AgentConnect({...})` usage bypasses this entirely and injects
 * adapters/agents/providers directly.
 */
export interface ResolvedConfig {
  logLevel: string;
  redisUrl?: string;
  projectsConfigPath: string;
  defaultAgent: string;
  agentWorkerConcurrency: number;
  admin: AdminConfig;
  security: SecurityConfig;
  slack?: SlackConfig;
  telegram?: TelegramConfig;
  claude?: ClaudeConfig;
  cursor?: CursorConfig;
  codex?: CodexConfig;
}
