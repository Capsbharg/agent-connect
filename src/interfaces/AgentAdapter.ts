import type { AgentExecutionHandle, AgentExecutionRequest, AgentHealthStatus } from '../core/types.js';

/**
 * The contract every AI coding agent (Claude Code, Cursor, Codex, and future
 * Gemini CLI/OpenHands/Amazon Q/custom agents) implements. A direct
 * generalization of this project's original `Agent` contract — same shape,
 * now with a project-agnostic name and optional session support.
 */
export interface AgentAdapter {
  readonly name: string;

  /** Cheap liveness/availability check (e.g. CLI on PATH, `--version`, auth ok). */
  healthCheck(): Promise<AgentHealthStatus>;

  /** Runs one prompt to completion. Streams progress via request.onProgress. */
  execute(request: AgentExecutionRequest): AgentExecutionHandle;
}
