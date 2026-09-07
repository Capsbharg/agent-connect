/**
 * Shared domain types used across the framework. This module has no
 * dependencies on any interface or adapter — everything else depends on it,
 * it depends on nothing in this package.
 */

export interface Identity {
  /** Stable, platform-qualified id, e.g. "slack:U123". Used for allowlists/sessions. */
  id: string;
  platform: string;
  platformUserId: string;
  displayName?: string;
}

export interface InboundAttachment {
  filename?: string;
  mimeType?: string;
  url?: string;
  data?: Buffer;
}

export interface InboundMessage {
  platform: string;
  platformUserId: string;
  channelId: string;
  threadId?: string;
  /** True for a DM/private chat, false for a channel/group mention. */
  isDirect: boolean;
  /** True when a non-direct message came from a group chat rather than a channel (e.g. a Telegram group vs a Slack channel). Ignored when isDirect is true. */
  isGroup?: boolean;
  text: string;
  attachments?: InboundAttachment[];
  /** The platform SDK's native event object, for adapter-specific edge cases. */
  raw: unknown;
}

export interface ReplyContext {
  platform: string;
  channelId: string;
  threadId?: string;
}

export interface ReplyContent {
  text: string;
}

/**
 * Hides "Slack posts once then edits a thread message" vs "Telegram edits a
 * chat message" behind one shape. Every adapter's createResponder() returns
 * one of these.
 */
export interface StreamingResponder {
  post(content: ReplyContent): Promise<void>;
  update(content: ReplyContent): Promise<void>;
  complete(content: ReplyContent): Promise<void>;
}

export interface AgentProgressChunk {
  text: string;
}

export interface AgentExecutionRequest {
  prompt: string;
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Opaque per-agent conversation/session id, for agents that support resuming context. Currently wired for ClaudeAgent/CodexAgent only — see the comments in CursorAgent.ts/GeminiAgent.ts for why those two don't use it yet. */
  sessionId?: string;
  /** Overrides the agent's default model for this run (e.g. a project's configured `model`), passed as `--model`/`-m`. Unsupported values are rejected by the CLI itself. */
  model?: string;
  onProgress?: (chunk: AgentProgressChunk) => void;
}

export interface AgentExecutionResult {
  success: boolean;
  outputText: string;
  durationMs: number;
  exitCode: number | null;
  cancelled: boolean;
  timedOut: boolean;
  errorMessage?: string;
  sessionId?: string;
}

export interface AgentExecutionHandle {
  cancel(): void;
  result: Promise<AgentExecutionResult>;
}

export interface AgentHealthStatus {
  healthy: boolean;
  message?: string;
}

export interface ProjectSessionState {
  project: string;
  cwd: string;
  lastActivity: number;
  /** The last conversation/session id an agent reported for this identity+project, keyed by agent name — lets the next prompt continue that conversation instead of starting fresh. Reset whenever `use <project>` runs again (even re-selecting the same project), which is the intentional "start a new conversation" mechanism. */
  sessionIdsByAgent?: Record<string, string>;
}

export interface ExecutionJobPayload {
  identityId: string;
  platformUserId: string;
  platform: string;
  channelId: string;
  threadId?: string;
  prompt: string;
  projectName: string;
  cwd: string;
  agentName: string;
  /** From the active project's `model` override in projects.json, if set. */
  model?: string;
  attachments?: InboundAttachment[];
  /** The stored session id to continue, if this identity+project+agent has a prior conversation — see ProjectSessionState.sessionIdsByAgent. */
  sessionId?: string;
  requestedAt: number;
}

/**
 * Deliberately not a closed union: commands are an open set (plugins add
 * their own alongside the built-ins registered by CommandRegistry), so
 * parsing only needs to separate "a named command" from "a free-form prompt."
 */
export type ParsedCommand =
  { type: 'prompt'; text: string } | { type: 'command'; name: string; arg: string };

export interface CommandContext {
  identity: Identity;
  message: InboundMessage;
  responder: StreamingResponder;
}

export type CommandHandler = (arg: string, ctx: CommandContext) => Promise<void>;
