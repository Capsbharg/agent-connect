import type { WebClient } from '@slack/web-api';
import type { ReplyContent, StreamingResponder } from '../../core/types.js';
import type { Logger } from '../../core/logger/Logger.js';

export interface SlackThreadStreamOptions {
  client: WebClient;
  channel: string;
  threadTs?: string;
  editThrottleMs: number;
  logger: Logger;
}

/**
 * "Post once, edit repeatedly" Slack StreamingResponder: the first call
 * (post) creates a message; every subsequent call (update/complete) edits
 * that same message via chat.update, throttled so streaming progress never
 * spams Slack's rate limits. Ports threadUpdater.js behind StreamingResponder.
 */
export class SlackThreadStream implements StreamingResponder {
  private readonly client: WebClient;
  private readonly channel: string;
  private readonly threadTs: string | undefined;
  private readonly editThrottleMs: number;
  private readonly logger: Logger;

  private messageTs: string | null = null;
  private pendingText: string | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEditAt = 0;
  // Every edit is chained onto this so calls resolve strictly in call order —
  // without it, an out-of-order network response for an in-flight throttled
  // edit could land after (and overwrite) the final "complete" edit.
  private editChain: Promise<void> = Promise.resolve();

  constructor(opts: SlackThreadStreamOptions) {
    this.client = opts.client;
    this.channel = opts.channel;
    this.threadTs = opts.threadTs;
    this.editThrottleMs = opts.editThrottleMs;
    this.logger = opts.logger;
  }

  async post(content: ReplyContent): Promise<void> {
    try {
      const result = await this.client.chat.postMessage({
        channel: this.channel,
        thread_ts: this.threadTs,
        text: content.text,
      });
      this.messageTs = (result.ts as string | undefined) ?? null;
      this.lastEditAt = Date.now();
    } catch (error) {
      this.logger.error('Failed to post Slack message', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async update(content: ReplyContent): Promise<void> {
    const elapsed = Date.now() - this.lastEditAt;
    if (elapsed >= this.editThrottleMs) {
      await this.editNow(content.text);
      return;
    }

    this.pendingText = content.text;
    if (!this.pendingTimer) {
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null;
        const toSend = this.pendingText;
        this.pendingText = null;
        if (toSend !== null) void this.editNow(toSend);
      }, this.editThrottleMs - elapsed);
    }
  }

  async complete(content: ReplyContent): Promise<void> {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.pendingText = null;
    await this.editNow(content.text);
  }

  private editNow(text: string): Promise<void> {
    this.editChain = this.editChain.then(async () => {
      if (!this.messageTs) return;
      try {
        await this.client.chat.update({ channel: this.channel, ts: this.messageTs, text });
      } catch (error) {
        this.logger.error('Failed to update Slack message', {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.lastEditAt = Date.now();
      }
    });
    return this.editChain;
  }
}
