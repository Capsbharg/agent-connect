import type { Identity } from '../core/types.js';

export interface AuthorizationContext {
  channelId?: string;
  threadId?: string;
  isDirect: boolean;
  isGroup?: boolean;
}

/**
 * Decides whether an already-authenticated Identity may proceed. The default
 * AllowListAuthorizationProvider checks allowedUsers/allowedChannels/
 * allowedGroups from config; a project could swap in RBAC, OPA, etc.
 */
export interface AuthorizationProvider {
  isAllowed(identity: Identity, context: AuthorizationContext): Promise<boolean>;
}
