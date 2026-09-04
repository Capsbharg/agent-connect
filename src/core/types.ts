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
  /** Opaque per-agent conversation/session id, for agents that support resuming context. */
  sessionId?: string;
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
