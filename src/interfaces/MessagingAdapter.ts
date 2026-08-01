import type { InboundMessage, ReplyContext, StreamingResponder } from '../core/types.js';

export interface MessagingAdapterCapabilities {
  threads: boolean;
  fileUploads: boolean;
  slashCommands: boolean;
}

/**
 * The contract every messaging platform (Slack, Telegram, and future
 * WhatsApp/Discord/Teams/etc.) implements. Core code (Router, ExecutionManager,
 * CommandRegistry) only ever depends on this — never on a concrete adapter.
 */
export interface MessagingAdapter {
  readonly platform: string;
  readonly capabilities: MessagingAdapterCapabilities;

  start(): Promise<void>;
  stop(): Promise<void>;

  /** Registered once by the Router; called for every inbound DM/mention. */
  onMessage(handler: (message: InboundMessage) => void | Promise<void>): void;

  /** Creates a per-conversation streaming responder for the given reply target. */
  createResponder(context: ReplyContext): StreamingResponder;
}
