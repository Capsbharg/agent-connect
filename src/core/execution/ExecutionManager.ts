import fs from 'node:fs';
import type { AgentAdapter } from '../../interfaces/AgentAdapter.js';
import type { EventPublisher } from '../../interfaces/EventPublisher.js';
import type { MessagingAdapter } from '../../interfaces/MessagingAdapter.js';
import type { QueueJobContext, QueueProvider } from '../../interfaces/QueueProvider.js';
import type { AgentRegistry } from '../agentRegistry/AgentRegistry.js';
import type { Logger } from '../logger/Logger.js';
import type { ProjectSession } from '../project/ProjectSession.js';
import type { AgentExecutionResult, ExecutionJobPayload, Identity } from '../types.js';
import type { ActiveExecutionRegistry } from './ActiveExecutionRegistry.js';
import {
  cleanupAttachments,
  describeAttachmentsForPrompt,
  downloadAttachments,
} from './attachmentDownloader.js';
import { PerIdentityMutex } from './perIdentityMutex.js';

// Kept well under Telegram's ~4096-char message limit (and Slack's much
// larger one), so a long agent answer never causes an edit to silently fail.
const MAX_RESULT_TEXT_LENGTH = 3500;
const DEFAULT_PROGRESS_MAX_LINES = 12;
// Overflow beyond the first chunk is sent as follow-up messages (via
// responder.post()) rather than silently dropped — capped so a pathologically
// huge result can't flood the conversation.
const MAX_OVERFLOW_MESSAGES = 5;

function renderHeader(prompt: string): string {
  const truncated = prompt.length > 200 ? `${prompt.slice(0, 200)}...` : prompt;
  return `🤖 Working on: ${truncated}`;
}

function renderProgress(prompt: string, lines: string[], maxLines: number): string {
  const recent = lines.slice(-maxLines);
  return [renderHeader(prompt), '', ...recent, '', '⏳ In progress...'].join('\n');
}

function splitIntoChunks(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

interface RenderedFinal {
  text: string;
  /** Additional messages to post() after complete() carrying the rest of a truncated result. */
  overflow: string[];
}

function renderFinal(
  prompt: string,
  lines: string[],
  maxLines: number,
  result: AgentExecutionResult,
): RenderedFinal {
  const recent = lines.slice(-maxLines);
  let footer: string;
  let overflow: string[] = [];

  if (result.cancelled) {
    footer = '🚫 Cancelled.';
  } else if (result.timedOut) {
    footer = '⏱️ Timed out.';
  } else if (!result.success) {
    footer = `❌ Failed: ${result.errorMessage || 'unknown error'}`;
  } else {
    const outputText = result.outputText || '(no output)';
    if (outputText.length > MAX_RESULT_TEXT_LENGTH) {
      const head = outputText.slice(0, MAX_RESULT_TEXT_LENGTH);
      const rest = splitIntoChunks(
        outputText.slice(MAX_RESULT_TEXT_LENGTH),
        MAX_RESULT_TEXT_LENGTH,
      );
      overflow = rest.slice(0, MAX_OVERFLOW_MESSAGES);
      const omitted = rest.length - overflow.length;
      const note =
        overflow.length > 0
          ? `_(continued in ${overflow.length} more message${overflow.length === 1 ? '' : 's'} below${omitted > 0 ? `, ${omitted} chunk(s) omitted` : ''})_`
          : '_(truncated)_';
      footer = `✅ Done.\n\n${head}\n\n${note}`;
    } else {
      footer = `✅ Done.\n\n${outputText}`;
    }
  }

  return { text: [renderHeader(prompt), '', ...recent, '', footer].join('\n'), overflow };
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
  /** Where a run's returned sessionId (if any) is persisted, so the next prompt for the same identity+project+agent can continue it. */
  projectSession: ProjectSession;
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
  private readonly projectSession: ProjectSession;
  private readonly mutex = new PerIdentityMutex();

  constructor(opts: ExecutionManagerOptions) {
    this.queue = opts.queue;
    this.agentRegistry = opts.agentRegistry;
    this.adaptersByPlatform = new Map(
      opts.messagingAdapters.map((adapter) => [adapter.platform, adapter]),
    );
    this.events = opts.events;
    this.activeExecutions = opts.activeExecutions;
    this.logger = opts.logger;
    this.concurrency = opts.concurrency;
    this.progressMaxLinesByPlatform = opts.progressMaxLinesByPlatform ?? {};
    this.projectSession = opts.projectSession;
  }

  start(): void {
    this.queue.process(
      (payload, ctx) => this.mutex.run(payload.identityId, () => this.execute(payload, ctx)),
      {
        concurrency: this.concurrency,
      },
    );
  }

  private async execute(payload: ExecutionJobPayload, ctx: QueueJobContext): Promise<void> {
    const adapter = this.adaptersByPlatform.get(payload.platform);
    if (!adapter) {
      this.logger.error(`No messaging adapter registered for platform "${payload.platform}"`, {
        jobId: ctx.jobId,
      });
      return;
    }

    const responder = adapter.createResponder({
      platform: payload.platform,
      channelId: payload.channelId,
      threadId: payload.threadId,
    });
    const maxLines =
      this.progressMaxLinesByPlatform[payload.platform] ?? DEFAULT_PROGRESS_MAX_LINES;
    const identity: Identity = {
      id: payload.identityId,
      platform: payload.platform,
      platformUserId: payload.platformUserId,
    };

    if (!fs.existsSync(payload.cwd)) {
      await responder.post({ text: renderHeader(payload.prompt) });
      const text = `❌ Project "${payload.projectName}" no longer exists at \`${payload.cwd}\`.`;
      await responder.complete({ text });
      this.logger.error(`Project "${payload.projectName}" no longer exists`, {
        cwd: payload.cwd,
        jobId: ctx.jobId,
      });
      return;
    }

    let agent: AgentAdapter;
    try {
      agent = this.agentRegistry.get(payload.agentName);
    } catch (error) {
      await responder.post({
        text: `❌ ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }

    const lines = ['Starting...'];
    const downloadedAttachments = await downloadAttachments(
      payload.attachments,
      payload.cwd,
      ctx.jobId,
      this.logger,
    );
    if (payload.attachments && payload.attachments.length > downloadedAttachments.length) {
      lines.push(
        `⚠️ ${payload.attachments.length - downloadedAttachments.length} attachment(s) could not be downloaded.`,
      );
    }

    await responder.post({ text: renderProgress(payload.prompt, lines, maxLines) });
    await this.events.emit('beforeExecution', { payload, identity });

    const effectivePrompt = payload.prompt + describeAttachmentsForPrompt(downloadedAttachments);

    const handle = agent.execute({
      prompt: effectivePrompt,
      cwd: payload.cwd,
      model: payload.model,
      sessionId: payload.sessionId,
      onProgress: (chunk) => {
        lines.push(chunk.text);
        responder
          .update({ text: renderProgress(payload.prompt, lines, maxLines) })
          .catch((error: unknown) => {
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
      if (downloadedAttachments.length > 0) {
        await cleanupAttachments(payload.cwd, ctx.jobId, this.logger);
      }
    }

    if (result.sessionId) {
      await this.projectSession
        .setSessionId(payload.identityId, payload.agentName, result.sessionId)
        .catch((error: unknown) => {
          this.logger.warn('Failed to persist session id for continuation', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    } else if (payload.sessionId && !result.success && !result.cancelled && !result.timedOut) {
      // This run tried to resume a stored conversation and failed outright
      // (not cancelled/timed out) without reporting a new session id — most
      // likely the stored one is no longer valid. Drop it so the next prompt
      // starts fresh instead of retrying the same broken resume forever.
      await this.projectSession
        .clearSessionId(payload.identityId, payload.agentName)
        .catch((error: unknown) => {
          this.logger.warn('Failed to clear stale session id', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }

    const { text: finalText, overflow } = renderFinal(payload.prompt, lines, maxLines, result);
    await this.events.emit('beforeReply', { payload, content: { text: finalText } });
    await responder.complete({ text: finalText });
    for (const chunk of overflow) {
      await responder.post({ text: chunk }).catch((error: unknown) => {
        this.logger.error('Failed to post overflow output', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
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
