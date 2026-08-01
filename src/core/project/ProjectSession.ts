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
    await this.storage.set<ProjectSessionState>(key(identityId), { ...existing, lastActivity: Date.now() });
  }

  async clear(identityId: string): Promise<void> {
    await this.storage.delete(key(identityId));
  }
}
