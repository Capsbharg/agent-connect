import type { Api } from 'grammy';
import type { ReplyContent, StreamingResponder } from '../../core/types.js';
import type { Logger } from '../../core/logger/Logger.js';

// Telegram hard-caps message length at 4096 characters.
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

function clampToTelegramLimit(text: string): string {
  return text.length > TELEGRAM_MAX_MESSAGE_LENGTH
    ? `${text.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - 20)}...\n\n_(truncated)_`
    : text;
}

export interface TelegramMessageStreamOptions {
  api: Api;
  chatId: number | string;
  messageThreadId?: number;
  editThrottleMs: number;
  logger: Logger;
}

/**
 * "Post once, edit repeatedly" Telegram StreamingResponder: the first call
 * (post) sends a message; every subsequent call (update/complete) edits that
 * same message via editMessageText, throttled the same way SlackThreadStream is.
 */
export class TelegramMessageStream implements StreamingResponder {
  private readonly api: Api;
  private readonly chatId: number | string;
  private readonly messageThreadId: number | undefined;
  private readonly editThrottleMs: number;
  private readonly logger: Logger;

  private messageId: number | null = null;
  private pendingText: string | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEditAt = 0;
  private lastSentText: string | null = null;
  private editChain: Promise<void> = Promise.resolve();

  constructor(opts: TelegramMessageStreamOptions) {
    this.api = opts.api;
    this.chatId = opts.chatId;
    this.messageThreadId = opts.messageThreadId;
    this.editThrottleMs = opts.editThrottleMs;
    this.logger = opts.logger;
  }

  async post(content: ReplyContent): Promise<void> {
    try {
      const text = clampToTelegramLimit(content.text);
      const result = await this.api.sendMessage(this.chatId, text, {
        message_thread_id: this.messageThreadId,
      });
      this.messageId = result.message_id;
      this.lastSentText = text;
      this.lastEditAt = Date.now();
    } catch (error) {
      this.logger.error('Failed to send Telegram message', {
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
      if (!this.messageId) return;
      const clamped = clampToTelegramLimit(text);
      if (clamped === this.lastSentText) return; // Telegram rejects a no-op edit as an error

      try {
        await this.api.editMessageText(this.chatId, this.messageId, clamped);
        this.lastSentText = clamped;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('message is not modified')) {
          this.logger.error('Failed to update Telegram message', { error: message });
        }
      } finally {
        this.lastEditAt = Date.now();
      }
    });
    return this.editChain;
  }
}
