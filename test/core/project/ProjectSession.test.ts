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
});
