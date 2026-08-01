import { App } from '@slack/bolt';
import type { SlackConfig } from '../../core/config/types.js';

/** Bolt App factory, Socket Mode only — no inbound HTTP port needed. */
export function createSlackApp(config: SlackConfig): App {
  return new App({
    token: config.botToken,
    signingSecret: config.signingSecret,
    socketMode: true,
    appToken: config.appToken,
  });
}
