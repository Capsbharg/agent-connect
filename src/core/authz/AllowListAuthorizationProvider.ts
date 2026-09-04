import type {
  AuthorizationContext,
  AuthorizationProvider,
} from '../../interfaces/AuthorizationProvider.js';
import type { SecurityConfig } from '../config/types.js';
import type { Identity } from '../types.js';

/**
 * Exact-allowlist authorization, generalized from the current bot's
 * project-registry allowlist pattern: empty lists mean "no restriction" for
 * that dimension (fine for a private single-user bot); a non-empty list is a
 * strict allowlist matched against both the platform-qualified identity id
 * (e.g. "slack:U123") and the bare platform user id (e.g. "U123"), so a
 * single-platform deployment can use either form in ALLOWED_USERS.
 */
export class AllowListAuthorizationProvider implements AuthorizationProvider {
  constructor(private readonly security: SecurityConfig) {}

  async isAllowed(identity: Identity, context: AuthorizationContext): Promise<boolean> {
    const { allowedUsers, allowedChannels, allowedGroups } = this.security;

    if (
      allowedUsers.length > 0 &&
      !allowedUsers.includes(identity.id) &&
      !allowedUsers.includes(identity.platformUserId)
    ) {
      return false;
    }

    if (context.isDirect) {
      return true;
    }

    const allowlist = context.isGroup ? allowedGroups : allowedChannels;
    if (allowlist.length > 0 && context.channelId && !allowlist.includes(context.channelId)) {
      return false;
    }

    return true;
  }
}
