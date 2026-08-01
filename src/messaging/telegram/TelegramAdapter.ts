import { Bot, type Context } from 'grammy';
import type { MessagingAdapter, MessagingAdapterCapabilities } from '../../interfaces/MessagingAdapter.js';
import { loadFromEnv } from '../../core/config/index.js';
import type { TelegramConfig } from '../../core/config/types.js';
import { ConfigError } from '../../core/errors.js';
import { createLogger } from '../../core/logger/createLogger.js';
import type { Logger } from '../../core/logger/Logger.js';
import type { InboundAttachment, InboundMessage, ReplyContext, StreamingResponder } from '../../core/types.js';
import { TelegramMessageStream } from './TelegramMessageStream.js';

/**
 * Strips a leading "/" (Telegram slash-command syntax) and any "@BotName"
 * mention suffix, so "/help@MyBot" and "@MyBot help" both normalize to
 * "help" and flow through the same CommandParser as Slack's plain-word
 * commands.
 */
function normalizeText(rawText: string, botUsername: string | undefined): string {
  let text = rawText.trim();
  if (text.startsWith('/')) {
    text = text.slice(1);
  }
  if (botUsername) {
    text = text.replace(new RegExp(`@${botUsername}\\b`, 'gi'), '');
  }
  return text.trim();
}

export interface TelegramAdapterOptions {
  config?: TelegramConfig;
  logger?: Logger;
}

/**
 * MessagingAdapter for Telegram (long polling via grammY). Handles private
 * chats and groups; Telegram's own "group privacy mode" already limits which
 * group messages the bot receives (commands, replies to it, @mentions).
 */
export class TelegramAdapter implements MessagingAdapter {
  readonly platform = 'telegram';
  readonly capabilities: MessagingAdapterCapabilities = {
    threads: true, // forum "topics" via message_thread_id — best-effort
    fileUploads: true,
    slashCommands: true,
  };

  private readonly bot: Bot;
  private readonly config: TelegramConfig;
  private readonly logger: Logger;
  private messageHandler: ((message: InboundMessage) => void | Promise<void>) | null = null;

  constructor(opts: TelegramAdapterOptions = {}) {
    const config = opts.config ?? loadFromEnv().telegram;
    if (!config) {
      throw new ConfigError('TelegramAdapter: no config provided and TELEGRAM_BOT_TOKEN is not set.');
    }
    this.config = config;
    this.logger = opts.logger ?? createLogger();
    this.bot = new Bot(this.config.botToken);
    this.registerHandlers();
  }

  onMessage(handler: (message: InboundMessage) => void | Promise<void>): void {
    this.messageHandler = handler;
  }

  createResponder(context: ReplyContext): StreamingResponder {
    return new TelegramMessageStream({
      api: this.bot.api,
      chatId: context.channelId,
      messageThreadId: context.threadId ? Number(context.threadId) : undefined,
      editThrottleMs: this.config.editThrottleMs,
      logger: this.logger,
    });
  }

  async start(): Promise<void> {
    await this.bot.init();
    // bot.start() only resolves once stopped (it runs the long-polling loop
    // internally) — run it in the background rather than awaiting it here.
    this.bot.start({ drop_pending_updates: true }).catch((error: unknown) => {
      this.logger.error('Telegram long-polling loop crashed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    this.logger.info('Telegram adapter connected (long polling)');
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  private registerHandlers(): void {
    this.bot.on('message', async (ctx) => {
      if (!this.messageHandler) return;
      const message = await this.toInboundMessage(ctx);
      if (!message) return;

      try {
        await this.messageHandler(message);
      } catch (error) {
        this.logger.error('Failed to handle Telegram message', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    this.bot.catch((error) => {
      this.logger.error('Unhandled Telegram (grammY) error', { error: error.message });
    });
  }

  private async toInboundMessage(ctx: Context): Promise<InboundMessage | null> {
    const msg = ctx.message;
    if (!msg || !ctx.chat) return null;

    const isDirect = ctx.chat.type === 'private';
    const rawText = msg.text ?? msg.caption ?? '';
    const text = normalizeText(rawText, this.bot.botInfo?.username);
    if (!text && !msg.document && !msg.photo) return null;

    const attachments = await this.extractAttachments(msg);

    return {
      platform: this.platform,
      platformUserId: String(msg.from?.id ?? ''),
      channelId: String(ctx.chat.id),
      threadId: msg.message_thread_id ? String(msg.message_thread_id) : undefined,
      isDirect,
      isGroup: !isDirect,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
      raw: msg,
    };
  }

  private async extractAttachments(msg: NonNullable<Context['message']>): Promise<InboundAttachment[]> {
    const fileRef = msg.document ?? (Array.isArray(msg.photo) ? msg.photo.at(-1) : undefined);
    if (!fileRef) return [];

    try {
      const file = await this.bot.api.getFile(fileRef.file_id);
      // Contains the bot token — treat as a short-lived, sensitive URL; avoid
      // logging it verbatim.
      const url = file.file_path
        ? `https://api.telegram.org/file/bot${this.config.botToken}/${file.file_path}`
        : undefined;
      return [{ filename: msg.document?.file_name, mimeType: msg.document?.mime_type, url }];
    } catch (error) {
      this.logger.warn('Failed to resolve Telegram attachment URL', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
