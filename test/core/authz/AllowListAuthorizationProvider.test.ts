import { describe, expect, it } from 'vitest';
import { AllowListAuthorizationProvider } from '../../../src/core/authz/AllowListAuthorizationProvider.js';
import type { Identity } from '../../../src/core/types.js';

function identity(id: string, platformUserId = id): Identity {
  return { id, platform: 'test', platformUserId };
}

describe('AllowListAuthorizationProvider', () => {
  it('allows everything when all lists are empty', async () => {
    const provider = new AllowListAuthorizationProvider({
      allowedUsers: [],
      allowedChannels: [],
      allowedGroups: [],
    });
    await expect(provider.isAllowed(identity('u1'), { isDirect: true })).resolves.toBe(true);
    await expect(
      provider.isAllowed(identity('u1'), { isDirect: false, channelId: 'c1' }),
    ).resolves.toBe(true);
  });

  it('enforces allowedUsers by identity id or bare platform user id', async () => {
    const provider = new AllowListAuthorizationProvider({
      allowedUsers: ['test:u1'],
      allowedChannels: [],
      allowedGroups: [],
    });
    await expect(provider.isAllowed(identity('test:u1', 'u1'), { isDirect: true })).resolves.toBe(
      true,
    );
    await expect(provider.isAllowed(identity('test:u2', 'u2'), { isDirect: true })).resolves.toBe(
      false,
    );
  });

  it('enforces allowedChannels only for non-direct, non-group messages', async () => {
    const provider = new AllowListAuthorizationProvider({
      allowedUsers: [],
      allowedChannels: ['c1'],
      allowedGroups: [],
    });
    await expect(
      provider.isAllowed(identity('u1'), { isDirect: false, channelId: 'c1' }),
    ).resolves.toBe(true);
    await expect(
      provider.isAllowed(identity('u1'), { isDirect: false, channelId: 'c2' }),
    ).resolves.toBe(false);
    await expect(
      provider.isAllowed(identity('u1'), { isDirect: true, channelId: 'c2' }),
    ).resolves.toBe(true);
  });

  it('enforces allowedGroups independently of allowedChannels', async () => {
    const provider = new AllowListAuthorizationProvider({
      allowedUsers: [],
      allowedChannels: ['c1'],
      allowedGroups: ['g1'],
    });
    await expect(
      provider.isAllowed(identity('u1'), { isDirect: false, isGroup: true, channelId: 'g1' }),
    ).resolves.toBe(true);
    await expect(
      provider.isAllowed(identity('u1'), { isDirect: false, isGroup: true, channelId: 'c1' }),
    ).resolves.toBe(false);
  });
});
