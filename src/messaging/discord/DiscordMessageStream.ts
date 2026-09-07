import type { Client } from 'discord.js';
import type { Message } from 'discord.js';
import type { ReplyContent, StreamingResponder } from '../../core/types.js';
import type { Logger } from '../../core/logger/Logger.js';

// Discord hard-caps regular message content at 2000 characters.
const DISCORD_MAX_MESSAGE_LENGTH = 2000;

function clampToDiscordLimit(text: string): string {
  return text.length > DISCORD_MAX_MESSAGE_LENGTH
    ? `${text.slice(0, DISCORD_MAX_MESSAGE_LENGTH - 20)}...\n\n_(truncated)_`
    : text;
}

export interface DiscordMessageStreamOptions {
  client: Client;
  channelId: string;
  editThrottleMs: number;
  logger: Logger;
}

/**
 * "Post once, edit repeatedly" Discord StreamingResponder: the first call
 * (post) fetches the channel and sends a message; every subsequent call
 * (update/complete) edits that same message, throttled the same way
 * SlackThreadStream/TelegramMessageStream are. The channel is only fetched
 * once, in post() — every later edit goes straight through the Message
 * object discord.js hands back, no extra fetch needed.
 */
export class DiscordMessageStream implements StreamingResponder {
  private readonly client: Client;
  private readonly channelId: string;
  private readonly editThrottleMs: number;
  private readonly logger: Logger;

  private message: Message | null = null;
  private pendingText: string | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEditAt = 0;
  private lastSentText: string | null = null;
  private editChain: Promise<void> = Promise.resolve();

  constructor(opts: DiscordMessageStreamOptions) {
    this.client = opts.client;
    this.channelId = opts.channelId;
    this.editThrottleMs = opts.editThrottleMs;
    this.logger = opts.logger;
  }

  async post(content: ReplyContent): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(this.channelId);
      if (!channel || !channel.isSendable()) {
        this.logger.error('Discord channel is missing or cannot receive messages', {
          channelId: this.channelId,
        });
        return;
      }
      const text = clampToDiscordLimit(content.text);
      this.message = await channel.send(text);
      this.lastSentText = text;
      this.lastEditAt = Date.now();
    } catch (error) {
      this.logger.error('Failed to send Discord message', {
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
      if (!this.message) return;
      const clamped = clampToDiscordLimit(text);
      if (clamped === this.lastSentText) return; // avoid a pointless API call for a no-op edit

      try {
        await this.message.edit(clamped);
        this.lastSentText = clamped;
      } catch (error) {
        this.logger.error('Failed to update Discord message', {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.lastEditAt = Date.now();
      }
    });
    return this.editChain;
  }
}
