import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import type { Message } from 'discord.js';
import type {
  MessagingAdapter,
  MessagingAdapterCapabilities,
} from '../../interfaces/MessagingAdapter.js';
import { loadFromEnv } from '../../core/config/index.js';
import type { DiscordConfig } from '../../core/config/types.js';
import { ConfigError } from '../../core/errors.js';
import { createLogger } from '../../core/logger/createLogger.js';
import type { Logger } from '../../core/logger/Logger.js';
import type {
  InboundAttachment,
  InboundMessage,
  ReplyContext,
  StreamingResponder,
} from '../../core/types.js';
import { DiscordMessageStream } from './DiscordMessageStream.js';

/** Discord's mention syntax is `<@ID>` or the legacy nickname-mention form `<@!ID>`. */
export function stripMentionTags(text: string): string {
  return text.replace(/<@!?\d+>/g, '').trim();
}

function extractAttachments(message: Message): InboundAttachment[] {
  return [...message.attachments.values()].map((attachment) => ({
    filename: attachment.name,
    mimeType: attachment.contentType ?? undefined,
    url: attachment.url,
  }));
}

export interface DiscordAdapterOptions {
  config?: DiscordConfig;
  logger?: Logger;
}

/**
 * MessagingAdapter for Discord (gateway, via discord.js). Handles DMs
 * (always) and guild channel messages that explicitly @mention the bot —
 * Discord delivers every message the bot can see (given the Message Content
 * intent), so unlike Slack's dedicated `app_mention` event, the "must be
 * mentioned" gate for guild channels is enforced here in the adapter.
 *
 * A Discord thread is just another channel id from the API's point of view,
 * so replying to a message already inside a thread naturally posts back
 * into that same thread with no special handling — but replying *into a new
 * thread* from its parent channel (Slack's thread_ts model) isn't
 * implemented, hence `capabilities.threads: false`.
 */
export class DiscordAdapter implements MessagingAdapter {
  readonly platform = 'discord';
  readonly capabilities: MessagingAdapterCapabilities = {
    threads: false,
    fileUploads: true,
    slashCommands: false,
  };

  private readonly client: Client;
  private readonly config: DiscordConfig;
  private readonly logger: Logger;
  private messageHandler: ((message: InboundMessage) => void | Promise<void>) | null = null;

  constructor(opts: DiscordAdapterOptions = {}) {
    const config = opts.config ?? loadFromEnv().discord;
    if (!config) {
      throw new ConfigError('DiscordAdapter: no config provided and DISCORD_BOT_TOKEN is not set.');
    }
    this.config = config;
    this.logger = opts.logger ?? createLogger();
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        // Privileged — must also be enabled for the bot in the Discord
        // Developer Portal (Bot -> Privileged Gateway Intents), or messages
        // arrive with empty content.
        GatewayIntentBits.MessageContent,
      ],
      // DM channels aren't always cached; without this, message.channel can
      // come back as a partial that fails to send/fetch correctly.
      partials: [Partials.Channel],
    });
    this.registerHandlers();
  }

  onMessage(handler: (message: InboundMessage) => void | Promise<void>): void {
    this.messageHandler = handler;
  }

  createResponder(context: ReplyContext): StreamingResponder {
    return new DiscordMessageStream({
      client: this.client,
      channelId: context.channelId,
      editThrottleMs: this.config.editThrottleMs,
      logger: this.logger,
    });
  }

  async start(): Promise<void> {
    // client.user (needed to detect @mentions) is only populated once the
    // gateway handshake finishes, which happens after login() resolves —
    // wait for it so a message can't race a not-yet-ready client.
    const ready = new Promise<void>((resolve) => {
      this.client.once(Events.ClientReady, () => resolve());
    });
    await this.client.login(this.config.botToken);
    await ready;
    this.logger.info('Discord adapter connected (gateway)');
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }

  private registerHandlers(): void {
    this.client.on(Events.MessageCreate, (message) => {
      void this.dispatch(message);
    });

    this.client.on(Events.Error, (error) => {
      this.logger.error('Unhandled Discord (discord.js) error', { error: error.message });
    });
  }

  private async dispatch(message: Message): Promise<void> {
    if (!this.messageHandler) return;

    const inbound = this.toInboundMessage(message);
    if (!inbound) return;

    try {
      await this.messageHandler(inbound);
    } catch (error) {
      this.logger.error('Failed to handle Discord message', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private toInboundMessage(message: Message): InboundMessage | null {
    // Never respond to another bot, or to ourselves.
    if (message.author.bot) return null;

    const isDirect = message.guildId === null;
    if (!isDirect) {
      const mentioned = this.client.user ? message.mentions.has(this.client.user) : false;
      if (!mentioned) return null;
    }

    const text = stripMentionTags(message.content);
    const attachments = extractAttachments(message);
    if (!text && attachments.length === 0) return null;

    return {
      platform: this.platform,
      platformUserId: message.author.id,
      channelId: message.channelId,
      isDirect,
      isGroup: false,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
      raw: message,
    };
  }
}
