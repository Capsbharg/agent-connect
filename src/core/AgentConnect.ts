import path from 'node:path';
import type { AgentAdapter } from '../interfaces/AgentAdapter.js';
import type { AuthenticationProvider } from '../interfaces/AuthenticationProvider.js';
import type { AuthorizationProvider } from '../interfaces/AuthorizationProvider.js';
import type { EventPublisher } from '../interfaces/EventPublisher.js';
import type { MessagingAdapter } from '../interfaces/MessagingAdapter.js';
import type { QueueProvider } from '../interfaces/QueueProvider.js';
import type { StorageProvider } from '../interfaces/StorageProvider.js';
import { CodexAgent } from '../agents/codex/CodexAgent.js';
import { CursorAgent } from '../agents/cursor/CursorAgent.js';
import { ClaudeAgent } from '../agents/claude/ClaudeAgent.js';
import { SlackAdapter } from '../messaging/slack/SlackAdapter.js';
import { TelegramAdapter } from '../messaging/telegram/TelegramAdapter.js';
import { QueueDashboard } from './admin/QueueDashboard.js';
import { AgentRegistry } from './agentRegistry/AgentRegistry.js';
import { PassthroughAuthenticationProvider } from './auth/PassthroughAuthenticationProvider.js';
import { AllowListAuthorizationProvider } from './authz/AllowListAuthorizationProvider.js';
import { registerBuiltinCommands } from './commands/builtins.js';
import { CommandRegistry } from './commands/CommandRegistry.js';
import { loadFromEnv } from './config/loadFromEnv.js';
import type { ResolvedConfig, SecurityConfig } from './config/types.js';
import { ConfigError } from './errors.js';
import { EventBus } from './events/EventBus.js';
import { ActiveExecutionRegistry } from './execution/ActiveExecutionRegistry.js';
import { ExecutionManager } from './execution/ExecutionManager.js';
import { createLogger } from './logger/createLogger.js';
import type { Logger } from './logger/Logger.js';
import { PluginManager } from './plugins/index.js';
import type { Plugin } from './plugins/index.js';
import { ProjectRegistry } from './project/ProjectRegistry.js';
import { ProjectSession } from './project/ProjectSession.js';
import { BullMQQueueProvider } from './queue/BullMQQueueProvider.js';
import { InMemoryQueueProvider } from './queue/InMemoryQueueProvider.js';
import { Router } from './router/Router.js';
import { InMemoryStorageProvider } from './storage/InMemoryStorageProvider.js';
import { RedisStorageProvider } from './storage/RedisStorageProvider.js';
import type { ExecutionJobPayload } from './types.js';

export interface AgentConnectAdminOptions {
  enabled?: boolean;
  port?: number;
}

export interface AgentConnectOptions {
  messaging: MessagingAdapter[];
  agents: AgentAdapter[];
  storage?: StorageProvider;
  queue?: QueueProvider<ExecutionJobPayload>;
  authentication?: AuthenticationProvider;
  authorization?: AuthorizationProvider;
  events?: EventPublisher;
  logger?: Logger;
  plugins?: Plugin[];
  projectsConfigPath?: string;
  /** Which registered agent handles a user's prompts until they run `agent <name>`. Defaults to the first entry in `agents`. */
  defaultAgent?: string;
  /** Max executions processed concurrently across all users. Defaults to 4. */
  concurrency?: number;
  progressMaxLinesByPlatform?: Record<string, number>;
  security?: SecurityConfig;
  /** Max executions (running + queued) a single identity may have outstanding at once. Defaults to 20; 0 = unlimited. */
  maxQueuedPerIdentity?: number;
  /** Queue dashboard (Bull Board); only takes effect when `queue` is a BullMQQueueProvider. Off by default. */
  admin?: AgentConnectAdminOptions;
  /** Set internally by fromEnv() and handed to plugins via PluginContext.config. */
  resolvedConfig?: ResolvedConfig;
}

/**
 * The composition root. Wires every injected MessagingAdapter/AgentAdapter
 * through the Router -> Authentication -> Authorization -> Queue ->
 * ExecutionManager pipeline. This is the only module in the framework that
 * is allowed to import concrete adapters/agents/providers directly — every
 * other module (Router, ExecutionManager, CommandRegistry, ...) depends only
 * on the seven interfaces in src/interfaces.
 */
export class AgentConnect {
  private readonly logger: Logger;
  private readonly events: EventPublisher;
  private readonly storage: StorageProvider;
  private readonly queue: QueueProvider<ExecutionJobPayload>;
  private readonly messagingAdapters: MessagingAdapter[];
  private readonly agentRegistry: AgentRegistry;
  private readonly projectRegistry: ProjectRegistry;
  private readonly commands: CommandRegistry;
  private readonly router: Router;
  private readonly executionManager: ExecutionManager;
  private readonly pluginManager: PluginManager;
  private readonly adminDashboard: QueueDashboard | null;
  private readonly resolvedConfig: ResolvedConfig | undefined;
  private readonly authorizationIsUnrestricted: boolean;
  private started = false;

  constructor(opts: AgentConnectOptions) {
    if (opts.messaging.length === 0) {
      throw new ConfigError('AgentConnect: at least one messaging adapter is required.');
    }
    if (opts.agents.length === 0) {
      throw new ConfigError('AgentConnect: at least one agent is required.');
    }

    this.logger = opts.logger ?? createLogger();
    this.events = opts.events ?? new EventBus(this.logger);
    this.storage = opts.storage ?? new InMemoryStorageProvider();
    this.queue = opts.queue ?? new InMemoryQueueProvider<ExecutionJobPayload>();
    this.messagingAdapters = opts.messaging;
    this.resolvedConfig = opts.resolvedConfig;

    const authentication = opts.authentication ?? new PassthroughAuthenticationProvider();
    const security = opts.security ?? { allowedUsers: [], allowedChannels: [], allowedGroups: [] };
    const authorization = opts.authorization ?? new AllowListAuthorizationProvider(security);
    // Only meaningful for the default provider — a custom AuthorizationProvider
    // may enforce restrictions we have no way to inspect from here.
    this.authorizationIsUnrestricted =
      !opts.authorization &&
      security.allowedUsers.length === 0 &&
      security.allowedChannels.length === 0 &&
      security.allowedGroups.length === 0;

    this.agentRegistry = new AgentRegistry(
      opts.agents,
      opts.defaultAgent ?? opts.agents[0]!.name,
      this.storage,
    );
    this.projectRegistry = new ProjectRegistry(
      opts.projectsConfigPath ?? path.join(process.cwd(), 'projects.json'),
      this.logger,
    );
    const projectSession = new ProjectSession(this.storage);
    const activeExecutions = new ActiveExecutionRegistry();

    this.commands = new CommandRegistry();
    registerBuiltinCommands(this.commands, {
      projectRegistry: this.projectRegistry,
      projectSession,
      agentRegistry: this.agentRegistry,
      queue: this.queue,
      activeExecutions,
      logger: this.logger,
    });

    const maxQueuedPerIdentity = opts.maxQueuedPerIdentity ?? 20;

    this.router = new Router({
      messagingAdapters: this.messagingAdapters,
      authentication,
      authorization,
      commands: this.commands,
      projectSession,
      agentRegistry: this.agentRegistry,
      queue: this.queue,
      activeExecutions,
      events: this.events,
      logger: this.logger,
      maxQueuedPerIdentity: maxQueuedPerIdentity > 0 ? maxQueuedPerIdentity : undefined,
    });

    this.executionManager = new ExecutionManager({
      queue: this.queue,
      agentRegistry: this.agentRegistry,
      messagingAdapters: this.messagingAdapters,
      events: this.events,
      activeExecutions,
      logger: this.logger,
      concurrency: opts.concurrency ?? 4,
      progressMaxLinesByPlatform: opts.progressMaxLinesByPlatform,
    });

    this.pluginManager = new PluginManager(opts.plugins ?? []);

    this.adminDashboard =
      opts.admin?.enabled && this.queue instanceof BullMQQueueProvider
        ? new QueueDashboard({
            queue: this.queue,
            port: opts.admin.port ?? 3000,
            logger: this.logger,
          })
        : null;
  }

  async start(): Promise<void> {
    if (this.started) return;

    if (this.authorizationIsUnrestricted) {
      this.logger.warn(
        '⚠️  SECURITY: no ALLOWED_USERS/ALLOWED_CHANNELS/ALLOWED_GROUPS configured — anyone who can message this bot ' +
          'can run arbitrary prompts against every registered project, and agents run headless (Claude with ' +
          '--dangerously-skip-permissions, Cursor with --force) so those prompts execute without a confirmation step. ' +
          'Set an allowlist before deploying beyond solo/local use — see the Security Notes section of the README.',
      );
    }

    if (this.storage instanceof RedisStorageProvider) {
      await this.storage.ping();
    }

    this.projectRegistry.load();

    await this.pluginManager.registerAll({
      events: this.events,
      commands: this.commands,
      logger: this.logger,
      config: this.resolvedConfig,
    });

    this.router.attach();
    this.executionManager.start();

    await Promise.all(this.messagingAdapters.map((adapter) => adapter.start()));
    if (this.adminDashboard) {
      await this.adminDashboard.start();
    }

    this.started = true;
    this.logger.info('AgentConnect started', {
      platforms: this.messagingAdapters.map((adapter) => adapter.platform),
      agents: this.agentRegistry.list().map((agent) => agent.name),
    });

    // Fire-and-forget: a slow/unreachable agent CLI must never delay start()
    // resolving, but the operator should still find out about it.
    void this.runStartupHealthChecks();
  }

  private async runStartupHealthChecks(): Promise<void> {
    await Promise.all(
      this.agentRegistry.list().map(async (agent) => {
        try {
          const status = await agent.healthCheck();
          if (!status.healthy) {
            this.logger.warn(`Agent "${agent.name}" failed its startup health check`, {
              message: status.message,
            });
          }
        } catch (error) {
          this.logger.warn(`Agent "${agent.name}" health check threw`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    await Promise.all(this.messagingAdapters.map((adapter) => adapter.stop()));
    if (this.adminDashboard) await this.adminDashboard.stop();
    await this.queue.close();
    await this.storage.close();

    this.logger.info('AgentConnect stopped');
  }

  /**
   * Auto-configures everything from environment variables: which messaging
   * platforms/agents to enable, Redis vs in-memory storage/queue, security
   * allowlists, and the admin dashboard. See .env.example for every variable.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): AgentConnect {
    const config = loadFromEnv(env);
    const logger = createLogger({ level: config.logLevel });

    const messaging: MessagingAdapter[] = [];
    if (config.slack) messaging.push(new SlackAdapter({ config: config.slack, logger }));
    if (config.telegram) messaging.push(new TelegramAdapter({ config: config.telegram, logger }));
    if (messaging.length === 0) {
      throw new ConfigError(
        'AgentConnect.fromEnv(): no messaging platform configured. Set SLACK_BOT_TOKEN+SLACK_SIGNING_SECRET+SLACK_APP_TOKEN and/or TELEGRAM_BOT_TOKEN.',
      );
    }

    const agents: AgentAdapter[] = [];
    if (config.claude) agents.push(new ClaudeAgent(config.claude));
    if (config.cursor) agents.push(new CursorAgent(config.cursor));
    if (config.codex) agents.push(new CodexAgent(config.codex));
    if (agents.length === 0) {
      throw new ConfigError(
        'AgentConnect.fromEnv(): no agent enabled. Set CLAUDE_ENABLED=true (default), CURSOR_ENABLED=true, and/or CODEX_ENABLED=true.',
      );
    }
    if (!agents.some((agent) => agent.name === config.defaultAgent)) {
      throw new ConfigError(
        `AgentConnect.fromEnv(): DEFAULT_AGENT is "${config.defaultAgent}" but only these agents are enabled: ${agents
          .map((agent) => agent.name)
          .join(', ')}.`,
      );
    }

    const progressMaxLinesByPlatform: Record<string, number> = {};
    if (config.slack) progressMaxLinesByPlatform.slack = config.slack.progressMaxLines;
    if (config.telegram) progressMaxLinesByPlatform.telegram = config.telegram.progressMaxLines;

    let storage: StorageProvider;
    let queue: QueueProvider<ExecutionJobPayload>;
    if (config.redisUrl) {
      storage = new RedisStorageProvider(config.redisUrl, logger, config.redisKeyPrefix);
      queue = new BullMQQueueProvider<ExecutionJobPayload>(
        'agent-connect-executions',
        config.redisUrl,
        logger,
        config.redisKeyPrefix,
      );
    } else {
      logger.warn(
        'REDIS_URL not set — using in-memory storage/queue. Single-process only; fine for local dev, not for production.',
      );
      storage = new InMemoryStorageProvider();
      queue = new InMemoryQueueProvider<ExecutionJobPayload>();
    }

    return new AgentConnect({
      messaging,
      agents,
      storage,
      queue,
      authorization: new AllowListAuthorizationProvider(config.security),
      logger,
      projectsConfigPath: config.projectsConfigPath,
      defaultAgent: config.defaultAgent,
      concurrency: config.agentWorkerConcurrency,
      maxQueuedPerIdentity: config.maxQueuedPerIdentity,
      progressMaxLinesByPlatform,
      admin: { enabled: config.admin.enabled, port: config.admin.port },
      resolvedConfig: config,
    });
  }
}
