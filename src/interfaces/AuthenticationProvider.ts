import type { Identity, InboundMessage } from '../core/types.js';

/**
 * Resolves "who is this" for an inbound message into a stable Identity.
 * Returning null rejects the message before it ever reaches authorization or
 * the router's command/prompt handling. The default implementation just
 * trusts the platform (Slack/Telegram already authenticate the transport);
 * this exists as a seam for e.g. a future SSO/identity-mapping provider.
 */
export interface AuthenticationProvider {
  authenticate(message: InboundMessage): Promise<Identity | null>;
}
