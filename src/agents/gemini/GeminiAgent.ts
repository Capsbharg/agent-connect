import type { AgentAdapter } from '../../interfaces/AgentAdapter.js';
import { loadFromEnv } from '../../core/config/index.js';
import type { GeminiConfig } from '../../core/config/types.js';
import { ConfigError } from '../../core/errors.js';
import type {
  AgentExecutionHandle,
  AgentExecutionRequest,
  AgentHealthStatus,
} from '../../core/types.js';
import { runCliProcess } from '../shared/CliProcessRunner.js';
import { parseJsonLine } from '../shared/ndjsonParser.js';
import { translateGeminiEvent } from './GeminiStreamParser.js';

/** AgentAdapter backed by the Gemini CLI (`gemini`). Same spawn/stream/timeout/cancel pattern as ClaudeAgent. */
export class GeminiAgent implements AgentAdapter {
  readonly name = 'gemini';
  private readonly config: GeminiConfig;

  constructor(config?: GeminiConfig) {
    const resolved = config ?? loadFromEnv().gemini;
    if (!resolved) {
      throw new ConfigError('GeminiAgent: no config provided and GEMINI_ENABLED is not "true".');
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
    let finalResult: { success: boolean; outputText: string; errorMessage?: string } | null = null;

    const args = ['-p', request.prompt, '--output-format', 'stream-json'];
    // Runs headless (no human to answer the CLI's own per-action confirmation
    // prompts) — see the same note on ClaudeAgent's --dangerously-skip-permissions.
    // Set GEMINI_YOLO=false to require the CLI's own confirmation instead.
    if (this.config.yolo !== false) args.push('--yolo');

    const handle = runCliProcess(
      this.config.cliPath,
      args,
      { cwd: request.cwd, timeoutMs: request.timeoutMs ?? this.config.timeoutMs, env: request.env },
      {
        onLine: (line) => {
          const json = parseJsonLine(line);
          if (json === null) return;
          const { progressLines, answerDelta, final } = translateGeminiEvent(json);
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
      // Gemini's own "result" event carries no answer text (unlike Claude's) —
      // the accumulated assistant message deltas are the only source.
      outputText: answer || '',
      durationMs: runResult.durationMs,
      exitCode: runResult.exitCode,
      cancelled: runResult.cancelled,
      timedOut: runResult.timedOut,
      errorMessage: runResult.errorMessage ?? finalResult?.errorMessage,
    }));

    return { cancel: handle.cancel, result };
  }
}
