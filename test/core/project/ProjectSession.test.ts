import { describe, expect, it } from 'vitest';
import { ProjectSession } from '../../../src/core/project/ProjectSession.js';
import { InMemoryStorageProvider } from '../../../src/core/storage/InMemoryStorageProvider.js';

describe('ProjectSession', () => {
  it('get() returns null when nothing is selected', async () => {
    const session = new ProjectSession(new InMemoryStorageProvider());
    expect(await session.get('U1')).toBeNull();
  });

  it('setActiveProject()/get() round-trip and record lastActivity', async () => {
    const session = new ProjectSession(new InMemoryStorageProvider());
    const before = Date.now();
    await session.setActiveProject('U1', 'demo', '/repo/demo');

    const state = await session.get('U1');
    expect(state).toMatchObject({ project: 'demo', cwd: '/repo/demo' });
    expect(state!.lastActivity).toBeGreaterThanOrEqual(before);
  });

  it('touchActivity() updates lastActivity without changing project/cwd', async () => {
    const session = new ProjectSession(new InMemoryStorageProvider());
    await session.setActiveProject('U1', 'demo', '/repo/demo');
    const first = await session.get('U1');

    await new Promise((resolve) => setTimeout(resolve, 5));
    await session.touchActivity('U1');
    const second = await session.get('U1');

    expect(second).toMatchObject({ project: 'demo', cwd: '/repo/demo' });
    expect(second!.lastActivity).toBeGreaterThan(first!.lastActivity);
  });

  it('touchActivity() is a no-op when there is no active session', async () => {
    const session = new ProjectSession(new InMemoryStorageProvider());
    await expect(session.touchActivity('U1')).resolves.toBeUndefined();
    expect(await session.get('U1')).toBeNull();
  });

  it('clear() removes the active project selection', async () => {
    const session = new ProjectSession(new InMemoryStorageProvider());
    await session.setActiveProject('U1', 'demo', '/repo/demo');
    await session.clear('U1');
    expect(await session.get('U1')).toBeNull();
  });

  it('keeps sessions independent per identity', async () => {
    const session = new ProjectSession(new InMemoryStorageProvider());
    await session.setActiveProject('U1', 'demo-a', '/repo/a');
    await session.setActiveProject('U2', 'demo-b', '/repo/b');

    expect((await session.get('U1'))?.project).toBe('demo-a');
    expect((await session.get('U2'))?.project).toBe('demo-b');
  });

  describe('getSessionId() / setSessionId()', () => {
    it('returns undefined when nothing has been stored for that agent', async () => {
      const session = new ProjectSession(new InMemoryStorageProvider());
      await session.setActiveProject('U1', 'demo', '/repo/demo');
      expect(await session.getSessionId('U1', 'claude')).toBeUndefined();
    });

    it('setSessionId()/getSessionId() round-trip, keyed independently per agent', async () => {
      const session = new ProjectSession(new InMemoryStorageProvider());
      await session.setActiveProject('U1', 'demo', '/repo/demo');

      await session.setSessionId('U1', 'claude', 'claude-session-1');
      await session.setSessionId('U1', 'codex', 'codex-session-1');

      expect(await session.getSessionId('U1', 'claude')).toBe('claude-session-1');
      expect(await session.getSessionId('U1', 'codex')).toBe('codex-session-1');
    });

    it('setSessionId() is a no-op when the identity has no active project', async () => {
      const session = new ProjectSession(new InMemoryStorageProvider());
      await expect(session.setSessionId('U1', 'claude', 'abc')).resolves.toBeUndefined();
      expect(await session.get('U1')).toBeNull();
    });

    it("setSessionId() does not disturb project/cwd or another agent's session id", async () => {
      const session = new ProjectSession(new InMemoryStorageProvider());
      await session.setActiveProject('U1', 'demo', '/repo/demo');
      await session.setSessionId('U1', 'claude', 'claude-session-1');

      await session.setSessionId('U1', 'codex', 'codex-session-1');

      const state = await session.get('U1');
      expect(state).toMatchObject({ project: 'demo', cwd: '/repo/demo' });
      expect(await session.getSessionId('U1', 'claude')).toBe('claude-session-1');
    });

    it('re-running setActiveProject (even for the same project) resets stored session ids — the intentional "start fresh" mechanism', async () => {
      const session = new ProjectSession(new InMemoryStorageProvider());
      await session.setActiveProject('U1', 'demo', '/repo/demo');
      await session.setSessionId('U1', 'claude', 'claude-session-1');

      await session.setActiveProject('U1', 'demo', '/repo/demo');

      expect(await session.getSessionId('U1', 'claude')).toBeUndefined();
    });

    it("clearSessionId() drops one agent's session id without touching another agent's or the project selection", async () => {
      const session = new ProjectSession(new InMemoryStorageProvider());
      await session.setActiveProject('U1', 'demo', '/repo/demo');
      await session.setSessionId('U1', 'claude', 'claude-session-1');
      await session.setSessionId('U1', 'codex', 'codex-session-1');

      await session.clearSessionId('U1', 'claude');

      expect(await session.getSessionId('U1', 'claude')).toBeUndefined();
      expect(await session.getSessionId('U1', 'codex')).toBe('codex-session-1');
      expect(await session.get('U1')).toMatchObject({ project: 'demo', cwd: '/repo/demo' });
    });

    it('clearSessionId() is a no-op when there is no active project or nothing stored for that agent', async () => {
      const session = new ProjectSession(new InMemoryStorageProvider());
      await expect(session.clearSessionId('U1', 'claude')).resolves.toBeUndefined();

      await session.setActiveProject('U1', 'demo', '/repo/demo');
      await expect(session.clearSessionId('U1', 'claude')).resolves.toBeUndefined();
      expect(await session.get('U1')).toMatchObject({ project: 'demo', cwd: '/repo/demo' });
    });

    it('clear() also drops any stored session ids along with the project selection', async () => {
      const session = new ProjectSession(new InMemoryStorageProvider());
      await session.setActiveProject('U1', 'demo', '/repo/demo');
      await session.setSessionId('U1', 'claude', 'claude-session-1');

      await session.clear('U1');
      await session.setActiveProject('U1', 'demo', '/repo/demo');

      expect(await session.getSessionId('U1', 'claude')).toBeUndefined();
    });
  });
});
