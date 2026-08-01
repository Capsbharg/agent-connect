import type { AgentAdapter } from '../../interfaces/AgentAdapter.js';
import { loadFromEnv } from '../../core/config/index.js';
import type { ClaudeConfig } from '../../core/config/types.js';
import { ConfigError } from '../../core/errors.js';
import type { AgentExecutionHandle, AgentExecutionRequest, AgentHealthStatus } from '../../core/types.js';
import { runCliProcess } from '../shared/CliProcessRunner.js';
import { parseJsonLine } from '../shared/ndjsonParser.js';
import { translateClaudeEvent } from './ClaudeStreamParser.js';

/** AgentAdapter backed by the Claude Code CLI. The only module that imports CliProcessRunner/ClaudeStreamParser for Claude. */
export class ClaudeAgent implements AgentAdapter {
  readonly name = 'claude';
  private readonly config: ClaudeConfig;

  constructor(config?: ClaudeConfig) {
    const resolved = config ?? loadFromEnv().claude;
    if (!resolved) {
      throw new ConfigError('ClaudeAgent: no config provided and CLAUDE_ENABLED is false.');
    }
    this.config = resolved;
  }

  healthCheck(): Promise<AgentHealthStatus> {
    return new Promise((resolve) => {
      const handle = runCliProcess(this.config.cliPath, ['--version'], { cwd: process.cwd(), timeoutMs: 10_000 });
      handle.done.then((result) => {
        resolve(
          result.exitCode === 0
            ? { healthy: true }
            : { healthy: false, message: result.errorMessage ?? `exit code ${result.exitCode}` },
        );
      });
    });
  }

  execute(request: AgentExecutionRequest): AgentExecutionHandle {
    let answer = '';
    let finalResult: { success: boolean; outputText: string } | null = null;

    const handle = runCliProcess(
      this.config.cliPath,
      ['-p', request.prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
      { cwd: request.cwd, timeoutMs: request.timeoutMs ?? this.config.timeoutMs, env: request.env },
      {
        onLine: (line) => {
          const json = parseJsonLine(line);
          if (json === null) return;
          const { progressLines, answerDelta, final } = translateClaudeEvent(json);
          if (progressLines && request.onProgress) {
            for (const text of progressLines) request.onProgress({ text });
          }
          if (answerDelta) answer += answerDelta;
          if (final) finalResult = final;
        },
      },
    );

    const result = handle.done.then((runResult) => ({
      success: runResult.success && (!finalResult || finalResult.success),
      // The CLI's own "result" event is the authoritative final answer; the
      // streamed text deltas are a fallback for when that event is missing.
      outputText: finalResult?.outputText || answer || '',
      durationMs: runResult.durationMs,
      exitCode: runResult.exitCode,
      cancelled: runResult.cancelled,
      timedOut: runResult.timedOut,
      errorMessage: runResult.errorMessage,
    }));

    return { cancel: handle.cancel, result };
  }
}
