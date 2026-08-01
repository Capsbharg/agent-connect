export class AgentConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigError extends AgentConnectError {}

export class ProjectNotFoundError extends AgentConnectError {
  constructor(public readonly projectName: string) {
    super(`Unknown project "${projectName}".`);
  }
}

export class AgentNotFoundError extends AgentConnectError {
  constructor(public readonly agentName: string) {
    super(`Unknown agent "${agentName}".`);
  }
}
