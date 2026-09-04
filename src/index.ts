// ============================================================================
// agent-connect — universal middleware between messaging platforms and AI
// coding agents. This file is the entire public API surface.
// ============================================================================

export { AgentConnect } from './core/AgentConnect.js';
export type { AgentConnectOptions, AgentConnectAdminOptions } from './core/AgentConnect.js';

// --- The seven contracts everything is built on ----------------------------
export type {
  MessagingAdapter,
  MessagingAdapterCapabilities,
  AgentAdapter,
  QueueProvider,
  QueueJobContext,
  QueuedJob,
  StorageProvider,
  AuthenticationProvider,
  AuthorizationProvider,
  AuthorizationContext,
  EventPublisher,
  EventListener,
} from './interfaces/index.js';

// --- Shared domain types ----------------------------------------------------
export type {
  Identity,
  InboundMessage,
  InboundAttachment,
  ReplyContext,
  ReplyContent,
  StreamingResponder,
  AgentProgressChunk,
  AgentExecutionRequest,
  AgentExecutionResult,
  AgentExecutionHandle,
  AgentHealthStatus,
  ProjectSessionState,
  ExecutionJobPayload,
  ParsedCommand,
  CommandContext,
  CommandHandler,
} from './core/types.js';
export type { EventMap, EventName } from './core/events/eventTypes.js';

// --- Messaging adapters ------------------------------------------------------
export { SlackAdapter } from './messaging/slack/SlackAdapter.js';
export type { SlackAdapterOptions } from './messaging/slack/SlackAdapter.js';
export { TelegramAdapter } from './messaging/telegram/TelegramAdapter.js';
export type { TelegramAdapterOptions } from './messaging/telegram/TelegramAdapter.js';

// --- Agents -------------------------------------------------------------
export { ClaudeAgent } from './agents/claude/ClaudeAgent.js';
export { CursorAgent } from './agents/cursor/CursorAgent.js';
export { CodexAgent } from './agents/codex/CodexAgent.js';

// --- Providers (swap any of these in via AgentConnectOptions) --------------
export { RedisStorageProvider } from './core/storage/RedisStorageProvider.js';
export { InMemoryStorageProvider } from './core/storage/InMemoryStorageProvider.js';
export { BullMQQueueProvider } from './core/queue/BullMQQueueProvider.js';
export { InMemoryQueueProvider } from './core/queue/InMemoryQueueProvider.js';
export { PassthroughAuthenticationProvider } from './core/auth/PassthroughAuthenticationProvider.js';
export { AllowListAuthorizationProvider } from './core/authz/AllowListAuthorizationProvider.js';
export { EventBus } from './core/events/EventBus.js';

// --- Plugins -----------------------------------------------------------
export type { Plugin, PluginContext } from './core/plugins/Plugin.js';
export { PluginManager } from './core/plugins/PluginManager.js';
export { AuditLogPlugin } from './core/plugins/AuditLogPlugin.js';

// --- Config & logging --------------------------------------------------
export { loadFromEnv } from './core/config/loadFromEnv.js';
export type {
  ResolvedConfig,
  SecurityConfig,
  AdminConfig,
  SlackConfig,
  TelegramConfig,
  ClaudeConfig,
  CursorConfig,
  CodexConfig,
} from './core/config/types.js';
export { createLogger } from './core/logger/createLogger.js';
export type { Logger } from './core/logger/Logger.js';

// --- Errors --------------------------------------------------------------
export {
  AgentConnectError,
  ConfigError,
  ProjectNotFoundError,
  AgentNotFoundError,
} from './core/errors.js';

// --- Advanced/testing building blocks (used when assembling a custom app) --
export { ProjectRegistry } from './core/project/ProjectRegistry.js';
export { ProjectSession } from './core/project/ProjectSession.js';
export { AgentRegistry } from './core/agentRegistry/AgentRegistry.js';
export { CommandRegistry } from './core/commands/CommandRegistry.js';
export { registerBuiltinCommands } from './core/commands/builtins.js';
export { Router } from './core/router/Router.js';
export { ExecutionManager } from './core/execution/ExecutionManager.js';
export { ActiveExecutionRegistry } from './core/execution/ActiveExecutionRegistry.js';
export { QueueDashboard } from './core/admin/QueueDashboard.js';
