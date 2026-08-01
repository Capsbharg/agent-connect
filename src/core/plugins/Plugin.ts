import type { EventPublisher } from '../../interfaces/EventPublisher.js';
import type { CommandRegistry } from '../commands/CommandRegistry.js';
import type { ResolvedConfig } from '../config/types.js';
import type { Logger } from '../logger/Logger.js';

export interface PluginContext {
  events: EventPublisher;
  commands: CommandRegistry;
  logger: Logger;
  /** Only present when the app was built via AgentConnect.fromEnv(). */
  config?: Readonly<ResolvedConfig>;
}

/**
 * A plugin registers itself — new commands, event listeners — without the
 * core ever importing it. AgentConnect calls register() on every configured
 * plugin during start(), before adapters begin listening.
 */
export interface Plugin {
  name: string;
  register(ctx: PluginContext): void | Promise<void>;
}
