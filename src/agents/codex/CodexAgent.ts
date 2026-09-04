import type { AgentAdapter } from '../../interfaces/AgentAdapter.js';
import { loadFromEnv } from '../../core/config/index.js';
import type { CodexConfig } from '../../core/config/types.js';
import { ConfigError } from '../../core/errors.js';
import type {
  AgentExecutionHandle,
  AgentExecutionRequest,
  AgentHealthStatus,
} from '../../core/types.js';
import { runCliProcess } from '../shared/CliProcessRunner.js';
import { parseJsonLine } from '../shared/ndjsonParser.js';
import { translateCodexEvent } from './CodexStreamParser.js';

/** AgentAdapter backed by the OpenAI Codex CLI (`codex exec --json`). Same spawn/stream/timeout/cancel pattern as ClaudeAgent. */
export class CodexAgent implements AgentAdapter {
  readonly name = 'codex';
  private readonly config: CodexConfig;

  constructor(config?: CodexConfig) {
    const resolved = config ?? loadFromEnv().codex;
    if (!resolved) {
      throw new ConfigError('CodexAgent: no config provided and CODEX_ENABLED is not "true".');
    }
    this.config = resolved;
  }

  healthCheck(): Promise<AgentHealthStatus> {
    return new Promise((resolve) => {
      const handle = runCliProcess(this.config.cliPath, ['--version'], {
        cwd: process.cwd(),
        timeoutMs: 10_000,
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

    const handle = runCliProcess(
      this.config.cliPath,
      ['exec', '--json', '--sandbox', 'workspace-write', request.prompt],
      { cwd: request.cwd, timeoutMs: request.timeoutMs ?? this.config.timeoutMs, env: request.env },
      {
        onLine: (line) => {
          const json = parseJsonLine(line);
          if (json === null) return;
          const { progressLines, answerDelta, final } = translateCodexEvent(json);
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
