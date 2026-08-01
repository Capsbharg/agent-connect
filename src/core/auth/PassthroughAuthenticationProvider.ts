import type { AuthenticationProvider } from '../../interfaces/AuthenticationProvider.js';
import type { Identity, InboundMessage } from '../types.js';

/**
 * Default AuthenticationProvider: trusts the transport (Slack/Telegram have
 * already authenticated the request by the time it reaches us) and derives a
 * stable, platform-qualified Identity. Swap this out for e.g. an SSO-backed
 * provider without touching any adapter or the Router.
 */
export class PassthroughAuthenticationProvider implements AuthenticationProvider {
  async authenticate(message: InboundMessage): Promise<Identity | null> {
    return {
      id: `${message.platform}:${message.platformUserId}`,
      platform: message.platform,
      platformUserId: message.platformUserId,
    };
  }
}
