import type { AuthenticationProvider } from '../../interfaces/AuthenticationProvider.js';
import type { AuthorizationProvider } from '../../interfaces/AuthorizationProvider.js';
import type { EventPublisher } from '../../interfaces/EventPublisher.js';
import type { MessagingAdapter } from '../../interfaces/MessagingAdapter.js';
import type { QueueProvider } from '../../interfaces/QueueProvider.js';
import type { AgentRegistry } from '../agentRegistry/AgentRegistry.js';
import type { CommandRegistry } from '../commands/CommandRegistry.js';
import type { ActiveExecutionRegistry } from '../execution/ActiveExecutionRegistry.js';
import type { Logger } from '../logger/Logger.js';
import type { ProjectRegistry } from '../project/ProjectRegistry.js';
import type { ProjectSession } from '../project/ProjectSession.js';
import type { ExecutionJobPayload, InboundMessage } from '../types.js';

export interface RouterOptions {
  messagingAdapters: MessagingAdapter[];
  authentication: AuthenticationProvider;
  authorization: AuthorizationProvider;
  commands: CommandRegistry;
  projectSession: ProjectSession;
  projectRegistry: ProjectRegistry;
  agentRegistry: AgentRegistry;
  queue: QueueProvider<ExecutionJobPayload>;
  activeExecutions: ActiveExecutionRegistry;
  events: EventPublisher;
  logger: Logger;
  /** Max executions (running + queued) a single identity may have outstanding at once. Undefined = unlimited. */
  maxQueuedPerIdentity?: number;
}

/**
 * Wires every registered MessagingAdapter's onMessage() into the shared
 * pipeline: Authentication -> Authorization -> command-or-prompt -> Queue.
 * This is the only module that ties adapters, providers, and the command/
 * execution layers together — none of them import each other directly.
 */
export class Router {
  constructor(private readonly opts: RouterOptions) {}

  attach(): void {
    for (const adapter of this.opts.messagingAdapters) {
      adapter.onMessage((message) => this.handleMessage(message));
    }
  }

  private async handleMessage(message: InboundMessage): Promise<void> {
    const {
      authentication,
      authorization,
      commands,
      projectSession,
      projectRegistry,
      agentRegistry,
      queue,
      activeExecutions,
      events,
      logger,
      maxQueuedPerIdentity,
    } = this.opts;

    await events.emit('beforeMessage', { message });

    const identity = await authentication.authenticate(message);
    if (!identity) {
      await events.emit('afterMessage', { message, identity: null });
      return;
    }

    const allowed = await authorization.isAllowed(identity, {
      channelId: message.channelId,
      threadId: message.threadId,
      isDirect: message.isDirect,
      isGroup: message.isGroup,
    });
    if (!allowed) {
      logger.warn('Rejected message: not authorized', {
        identityId: identity.id,
        channelId: message.channelId,
      });
      await events.emit('afterMessage', { message, identity });
      return;
    }

    const responder = this.getAdapter(message.platform).createResponder({
      platform: message.platform,
      channelId: message.channelId,
      threadId: message.threadId,
    });

    const parsed = commands.parse(message.text);

    if (parsed.type === 'command') {
      const handled = await commands.execute(parsed.name, parsed.arg, {
        identity,
        message,
        responder,
      });
      if (!handled) {
        logger.warn(`Parsed command "${parsed.name}" had no registered handler`, {
          identityId: identity.id,
        });
      }
      await events.emit('afterMessage', { message, identity });
      return;
    }

    const session = await projectSession.get(identity.id);
    if (!session) {
      await responder.post({
        text: 'No project selected. Use `use <project>` to pick one, or `projects` to see the list.',
      });
      await events.emit('afterMessage', { message, identity });
      return;
    }

    if (maxQueuedPerIdentity !== undefined) {
      const outstanding = await queue.listPending((p) => p.identityId === identity.id);
      const running = activeExecutions.get(identity.id) ? 1 : 0;
      if (outstanding.length + running >= maxQueuedPerIdentity) {
        await responder.post({
          text: `You already have ${outstanding.length + running} execution(s) running/queued (max ${maxQueuedPerIdentity}). Wait for one to finish, or run \`cancel\` first.`,
        });
        await events.emit('afterMessage', { message, identity });
        return;
      }
    }

    const agentName = await agentRegistry.getActiveAgentName(
      identity.id,
      projectRegistry.getAgentOverride(session.project),
    );

    const payload: ExecutionJobPayload = {
      identityId: identity.id,
      platformUserId: identity.platformUserId,
      platform: message.platform,
      channelId: message.channelId,
      threadId: message.threadId,
      prompt: parsed.text,
      projectName: session.project,
      cwd: session.cwd,
      agentName,
      model: projectRegistry.getModelOverride(session.project),
      attachments: message.attachments,
      sessionId: await projectSession.getSessionId(identity.id, agentName),
      requestedAt: Date.now(),
    };

    await queue.enqueue(payload);
    await responder.post({
      text: `Got it — working on: ${parsed.text}\nI'll keep you posted as I go.`,
    });
    await events.emit('afterMessage', { message, identity });
  }

  private getAdapter(platform: string): MessagingAdapter {
    const adapter = this.opts.messagingAdapters.find(
      (candidate) => candidate.platform === platform,
    );
    if (!adapter) {
      throw new Error(`No messaging adapter registered for platform "${platform}"`);
    }
    return adapter;
  }
}
