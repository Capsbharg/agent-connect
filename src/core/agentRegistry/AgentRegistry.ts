import type { AgentAdapter } from '../../interfaces/AgentAdapter.js';
import type { StorageProvider } from '../../interfaces/StorageProvider.js';
import { AgentNotFoundError } from '../errors.js';

function key(identityId: string): string {
  return `agent-session:${identityId}`;
}

/**
 * Registry of every configured AgentAdapter by name, plus a per-identity
 * "which agent handles my prompts" selection (backed by StorageProvider, same
 * pattern as ProjectSession) — needed now that Claude/Cursor/Codex can all be
 * registered at once, where the original bot only ever had Claude.
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentAdapter>();

  constructor(
    agents: AgentAdapter[],
    private readonly defaultAgentName: string,
    private readonly storage: StorageProvider,
  ) {
    for (const agent of agents) {
      this.agents.set(agent.name, agent);
    }
    if (!this.agents.has(defaultAgentName)) {
      throw new AgentNotFoundError(defaultAgentName);
    }
  }

  list(): AgentAdapter[] {
    return [...this.agents.values()];
  }

  get(name: string): AgentAdapter {
    const agent = this.agents.get(name);
    if (!agent) throw new AgentNotFoundError(name);
    return agent;
  }

  has(name: string): boolean {
    return this.agents.has(name);
  }

  async getActiveAgentName(identityId: string): Promise<string> {
    const selected = await this.storage.get<string>(key(identityId));
    return selected && this.agents.has(selected) ? selected : this.defaultAgentName;
  }

  async setActiveAgent(identityId: string, agentName: string): Promise<void> {
    if (!this.agents.has(agentName)) throw new AgentNotFoundError(agentName);
    await this.storage.set<string>(key(identityId), agentName);
  }
}
