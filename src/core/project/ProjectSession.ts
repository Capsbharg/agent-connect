import type { StorageProvider } from '../../interfaces/StorageProvider.js';
import type { ProjectSessionState } from '../types.js';

function key(identityId: string): string {
  return `project-session:${identityId}`;
}

/** Per-identity active project selection, backed by any StorageProvider. */
export class ProjectSession {
  constructor(private readonly storage: StorageProvider) {}

  async get(identityId: string): Promise<ProjectSessionState | null> {
    return this.storage.get<ProjectSessionState>(key(identityId));
  }

  async setActiveProject(identityId: string, project: string, cwd: string): Promise<void> {
    await this.storage.set<ProjectSessionState>(key(identityId), {
      project,
      cwd,
      lastActivity: Date.now(),
    });
  }

  async touchActivity(identityId: string): Promise<void> {
    const existing = await this.get(identityId);
    if (!existing) return;
    await this.storage.set<ProjectSessionState>(key(identityId), {
      ...existing,
      lastActivity: Date.now(),
    });
  }

  /** The stored conversation id to continue for this identity+project+agent, if any. */
  async getSessionId(identityId: string, agentName: string): Promise<string | undefined> {
    const existing = await this.get(identityId);
    return existing?.sessionIdsByAgent?.[agentName];
  }

  /**
   * Records the session id an agent reported so the next prompt continues
   * that conversation. A no-op if the identity no longer has an active
   * project (e.g. it was cleared mid-execution) — there's nothing to attach
   * the session id to.
   */
  async setSessionId(identityId: string, agentName: string, sessionId: string): Promise<void> {
    const existing = await this.get(identityId);
    if (!existing) return;
    await this.storage.set<ProjectSessionState>(key(identityId), {
      ...existing,
      sessionIdsByAgent: { ...existing.sessionIdsByAgent, [agentName]: sessionId },
    });
  }

  /**
   * Drops a stored session id for one agent, e.g. after a failed `--resume`
   * (the CLI's session storage expired/was pruned/became incompatible) so the
   * next prompt starts a fresh conversation instead of retrying the same
   * broken resume forever. A no-op if there's no active project or nothing
   * was stored for that agent.
   */
  async clearSessionId(identityId: string, agentName: string): Promise<void> {
    const existing = await this.get(identityId);
    if (!existing?.sessionIdsByAgent || !(agentName in existing.sessionIdsByAgent)) return;
    const sessionIdsByAgent = { ...existing.sessionIdsByAgent };
    delete sessionIdsByAgent[agentName];
    await this.storage.set<ProjectSessionState>(key(identityId), {
      ...existing,
      sessionIdsByAgent,
    });
  }

  async clear(identityId: string): Promise<void> {
    await this.storage.delete(key(identityId));
  }
}
