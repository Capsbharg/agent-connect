import type { App } from '@slack/bolt';
import type {
  MessagingAdapter,
  MessagingAdapterCapabilities,
} from '../../interfaces/MessagingAdapter.js';
import { loadFromEnv } from '../../core/config/index.js';
import type { SlackConfig } from '../../core/config/types.js';
import { ConfigError } from '../../core/errors.js';
import { createLogger } from '../../core/logger/createLogger.js';
import type { Logger } from '../../core/logger/Logger.js';
import type { InboundMessage, ReplyContext, StreamingResponder } from '../../core/types.js';
import { createSlackApp } from './SlackApp.js';
import { SlackThreadStream } from './SlackThreadStream.js';

/** Exported for unit testing — Slack's mention syntax is `<@U123>` / `<@U123|display>`. */
export function stripMentionTags(text: string): string {
  return text.replace(/<@[^>]+>/g, '').trim();
}

/** The subset of a Slack event's shape this adapter reads, regardless of exact event type. */
interface SlackEventLike {
  user?: string;
  text?: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
}

export interface SlackAdapterOptions {
  config?: SlackConfig;
  logger?: Logger;
}

/**
 * MessagingAdapter for Slack (Socket Mode). Handles app_mention (threaded)
 * and message.im (DM, unthreaded) — the same two surfaces the original bot
 * supported. Ports slack.js + threadUpdater.js.
 */
export class SlackAdapter implements MessagingAdapter {
  readonly platform = 'slack';
  readonly capabilities: MessagingAdapterCapabilities = {
    threads: true,
    fileUploads: true,
    slashCommands: true,
  };

  private readonly app: App;
  private readonly config: SlackConfig;
  private readonly logger: Logger;
  private messageHandler: ((message: InboundMessage) => void | Promise<void>) | null = null;

  constructor(opts: SlackAdapterOptions = {}) {
    const config = opts.config ?? loadFromEnv().slack;
    if (!config) {
      throw new ConfigError(
        'SlackAdapter: no config provided and SLACK_BOT_TOKEN/SLACK_SIGNING_SECRET/SLACK_APP_TOKEN are not set.',
      );
    }
    this.config = config;
    this.logger = opts.logger ?? createLogger();
    this.app = createSlackApp(this.config);
    this.registerEventHandlers();
  }

  onMessage(handler: (message: InboundMessage) => void | Promise<void>): void {
    this.messageHandler = handler;
  }

  createResponder(context: ReplyContext): StreamingResponder {
    return new SlackThreadStream({
      client: this.app.client,
      channel: context.channelId,
      threadTs: context.threadId,
      editThrottleMs: this.config.editThrottleMs,
      logger: this.logger,
    });
  }

  async start(): Promise<void> {
    await this.app.start();
    this.logger.info('Slack adapter connected (Socket Mode)');
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  private registerEventHandlers(): void {
    this.app.event('app_mention', async ({ event }) => {
      await this.dispatch(event as unknown as SlackEventLike, { isDirect: false });
    });

    this.app.event('message', async ({ event }) => {
      await this.dispatch(event as unknown as SlackEventLike, { isDirect: true });
    });

    this.app.error(async (error) => {
      this.logger.error('Unhandled Slack (Bolt) error', { error: error.message });
    });
  }

  private async dispatch(event: SlackEventLike, opts: { isDirect: boolean }): Promise<void> {
    if (!this.messageHandler) return;
    // event.subtype is set for message_changed/message_deleted/channel_join/
    // bot messages/etc. — those don't carry a normal user/text shape and must
    // never be routed to a command or enqueued as a prompt.
    if (event.bot_id || event.subtype) return;

    const message: InboundMessage = {
      platform: this.platform,
      platformUserId: event.user ?? '',
      channelId: event.channel,
      threadId: opts.isDirect ? undefined : (event.thread_ts ?? event.ts),
      isDirect: opts.isDirect,
      isGroup: false,
      text: stripMentionTags(event.text ?? ''),
      raw: event,
    };

    try {
      await this.messageHandler(message);
    } catch (error) {
      this.logger.error('Failed to handle Slack message', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
