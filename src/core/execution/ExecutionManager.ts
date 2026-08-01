import fs from 'node:fs';
import type { AgentAdapter } from '../../interfaces/AgentAdapter.js';
import type { EventPublisher } from '../../interfaces/EventPublisher.js';
import type { MessagingAdapter } from '../../interfaces/MessagingAdapter.js';
import type { QueueJobContext, QueueProvider } from '../../interfaces/QueueProvider.js';
import type { AgentRegistry } from '../agentRegistry/AgentRegistry.js';
import type { Logger } from '../logger/Logger.js';
import type { AgentExecutionResult, ExecutionJobPayload, Identity } from '../types.js';
import type { ActiveExecutionRegistry } from './ActiveExecutionRegistry.js';
import { PerIdentityMutex } from './perIdentityMutex.js';

// Kept well under Telegram's ~4096-char message limit (and Slack's much
// larger one), so a long agent answer never causes an edit to silently fail.
const MAX_RESULT_TEXT_LENGTH = 3500;
const DEFAULT_PROGRESS_MAX_LINES = 12;

function renderHeader(prompt: string): string {
  const truncated = prompt.length > 200 ? `${prompt.slice(0, 200)}...` : prompt;
  return `🤖 Working on: ${truncated}`;
}

function renderProgress(prompt: string, lines: string[], maxLines: number): string {
  const recent = lines.slice(-maxLines);
  return [renderHeader(prompt), '', ...recent, '', '⏳ In progress...'].join('\n');
}

function renderFinal(prompt: string, lines: string[], maxLines: number, result: AgentExecutionResult): string {
  const recent = lines.slice(-maxLines);
  let footer: string;

  if (result.cancelled) {
    footer = '🚫 Cancelled.';
  } else if (result.timedOut) {
    footer = '⏱️ Timed out.';
  } else if (!result.success) {
    footer = `❌ Failed: ${result.errorMessage || 'unknown error'}`;
  } else {
    const outputText = result.outputText || '(no output)';
    const truncated =
      outputText.length > MAX_RESULT_TEXT_LENGTH
        ? `${outputText.slice(0, MAX_RESULT_TEXT_LENGTH)}...\n\n_(truncated)_`
        : outputText;
    footer = `✅ Done.\n\n${truncated}`;
  }

  return [renderHeader(prompt), '', ...recent, '', footer].join('\n');
}

export interface ExecutionManagerOptions {
  queue: QueueProvider<ExecutionJobPayload>;
  agentRegistry: AgentRegistry;
  messagingAdapters: MessagingAdapter[];
  events: EventPublisher;
  activeExecutions: ActiveExecutionRegistry;
  logger: Logger;
  concurrency: number;
  /** Recent-progress-lines cap per platform; falls back to DEFAULT_PROGRESS_MAX_LINES. */
  progressMaxLinesByPlatform?: Record<string, number>;
}

/**
 * The "Agent Manager" step of the flow: consumes the queue, resolves the
 * user's active agent, runs it, streams progress into a fresh
 * StreamingResponder built for the job's conversation, and tracks the
 * running handle so the `cancel` command can find it. Generalizes
 * claudeWorker.js across any registered MessagingAdapter/AgentAdapter.
 */
export class ExecutionManager {
  private readonly queue: QueueProvider<ExecutionJobPayload>;
  private readonly agentRegistry: AgentRegistry;
  private readonly adaptersByPlatform: Map<string, MessagingAdapter>;
  private readonly events: EventPublisher;
  private readonly activeExecutions: ActiveExecutionRegistry;
  private readonly logger: Logger;
  private readonly concurrency: number;
  private readonly progressMaxLinesByPlatform: Record<string, number>;
  private readonly mutex = new PerIdentityMutex();

  constructor(opts: ExecutionManagerOptions) {
    this.queue = opts.queue;
    this.agentRegistry = opts.agentRegistry;
    this.adaptersByPlatform = new Map(opts.messagingAdapters.map((adapter) => [adapter.platform, adapter]));
    this.events = opts.events;
    this.activeExecutions = opts.activeExecutions;
    this.logger = opts.logger;
    this.concurrency = opts.concurrency;
    this.progressMaxLinesByPlatform = opts.progressMaxLinesByPlatform ?? {};
  }

  start(): void {
    this.queue.process((payload, ctx) => this.mutex.run(payload.identityId, () => this.execute(payload, ctx)), {
      concurrency: this.concurrency,
    });
  }

  private async execute(payload: ExecutionJobPayload, ctx: QueueJobContext): Promise<void> {
    const adapter = this.adaptersByPlatform.get(payload.platform);
    if (!adapter) {
      this.logger.error(`No messaging adapter registered for platform "${payload.platform}"`, { jobId: ctx.jobId });
      return;
    }

    const responder = adapter.createResponder({
      platform: payload.platform,
      channelId: payload.channelId,
      threadId: payload.threadId,
    });
    const maxLines = this.progressMaxLinesByPlatform[payload.platform] ?? DEFAULT_PROGRESS_MAX_LINES;
    const identity: Identity = {
      id: payload.identityId,
      platform: payload.platform,
      platformUserId: payload.platformUserId,
    };

    if (!fs.existsSync(payload.cwd)) {
      await responder.post({ text: renderHeader(payload.prompt) });
      const text = `❌ Project "${payload.projectName}" no longer exists at \`${payload.cwd}\`.`;
      await responder.complete({ text });
      this.logger.error(`Project "${payload.projectName}" no longer exists`, { cwd: payload.cwd, jobId: ctx.jobId });
      return;
    }

    let agent: AgentAdapter;
    try {
      agent = this.agentRegistry.get(payload.agentName);
    } catch (error) {
      await responder.post({ text: `❌ ${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    await responder.post({ text: renderProgress(payload.prompt, ['Starting...'], maxLines) });

    const lines = ['Starting...'];
    await this.events.emit('beforeExecution', { payload, identity });

    const handle = agent.execute({
      prompt: payload.prompt,
      cwd: payload.cwd,
      onProgress: (chunk) => {
        lines.push(chunk.text);
        responder.update({ text: renderProgress(payload.prompt, lines, maxLines) }).catch((error: unknown) => {
          this.logger.error('Failed to stream progress update', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      },
    });

    this.activeExecutions.register(payload.identityId, ctx.jobId, handle.cancel);

    let result: AgentExecutionResult;
    try {
      result = await handle.result;
    } finally {
      this.activeExecutions.clear(payload.identityId, ctx.jobId);
    }

    const finalText = renderFinal(payload.prompt, lines, maxLines, result);
    await this.events.emit('beforeReply', { payload, content: { text: finalText } });
    await responder.complete({ text: finalText });
    await this.events.emit('afterReply', { payload, content: { text: finalText } });
    await this.events.emit('afterExecution', { payload, identity, result });

    this.logger.info('Execution finished', {
      identityId: payload.identityId,
      project: payload.projectName,
      agent: payload.agentName,
      jobId: ctx.jobId,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      success: result.success,
    });

    if (!result.success && !result.cancelled) {
      throw new Error(result.errorMessage || `Agent exited with code ${result.exitCode}`);
    }
  }
}
