import type { AgentAdapter } from '../../interfaces/AgentAdapter.js';
import { loadFromEnv } from '../../core/config/index.js';
import type { CursorConfig } from '../../core/config/types.js';
import { ConfigError } from '../../core/errors.js';
import type {
  AgentExecutionHandle,
  AgentExecutionRequest,
  AgentHealthStatus,
} from '../../core/types.js';
import { runCliProcess } from '../shared/CliProcessRunner.js';
import { parseJsonLine } from '../shared/ndjsonParser.js';
import { translateCursorEvent } from './CursorStreamParser.js';

/**
 * AgentAdapter backed by the Cursor CLI (`cursor-agent`). Same
 * spawn/stream/timeout/cancel pattern as ClaudeAgent — see CursorStreamParser
 * for the caveat on its event schema being best-effort.
 */
export class CursorAgent implements AgentAdapter {
  readonly name = 'cursor';
  private readonly config: CursorConfig;

  constructor(config?: CursorConfig) {
    const resolved = config ?? loadFromEnv().cursor;
    if (!resolved) {
      throw new ConfigError('CursorAgent: no config provided and CURSOR_ENABLED is not "true".');
    }
    this.config = resolved;
  }

  private buildEnv(extra?: Record<string, string>): Record<string, string> {
    return {
      ...(extra ?? {}),
      ...(this.config.apiKey ? { CURSOR_API_KEY: this.config.apiKey } : {}),
    };
  }

  healthCheck(): Promise<AgentHealthStatus> {
    return new Promise((resolve) => {
      const handle = runCliProcess(this.config.cliPath, ['--version'], {
        cwd: process.cwd(),
        timeoutMs: 10_000,
        env: this.buildEnv(),
      });
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

    const args = ['-p', '--output-format', 'stream-json'];
    // Runs headless (no human to answer the CLI's own per-action confirmation
    // prompts) — see the same note on ClaudeAgent's --dangerously-skip-permissions.
    // Set CURSOR_FORCE=false to require the CLI's own confirmation instead.
    if (this.config.force) args.push('--force');
    args.push(request.prompt);

    const handle = runCliProcess(
      this.config.cliPath,
      args,
      {
        cwd: request.cwd,
        timeoutMs: request.timeoutMs ?? this.config.timeoutMs,
        env: this.buildEnv(request.env),
      },
      {
        onLine: (line) => {
          const json = parseJsonLine(line);
          if (json === null) return;
          const { progressLines, answerDelta, final } = translateCursorEvent(json);
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
