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
    let capturedSessionId: string | undefined;

    const args = ['-p', request.prompt, '--output-format', 'stream-json'];
    if (request.model) args.push('--model', request.model);
    // Continues a prior conversation by its session id — verified against a
    // real install: --resume accepts a raw session_id UUID and correctly
    // restores prior context, despite `gemini --help` only documenting
    // "latest"/an index for this flag (the CLI's own error text on an
    // invalid id confirms UUID resume is sanctioned). See GeminiStreamParser.ts.
    if (request.sessionId) args.push('--resume', request.sessionId);
    // Runs headless (no human to answer the CLI's own per-action confirmation
    // prompts) — see the same note on ClaudeAgent's --dangerously-skip-permissions.
    // Set GEMINI_YOLO=false to require the CLI's own confirmation instead.
    if (this.config.yolo !== false) args.push('--yolo');
    // Headless runs have no interactive terminal to answer Gemini's own
    // "do you trust this directory?" prompt for a workspace it hasn't seen
    // before — without this, every run against a project not already
    // manually trusted via an interactive `gemini` session fails outright
    // (verified: a real run against an untrusted directory exits with
    // "Gemini CLI is not running in a trusted directory..." before doing
    // anything else). Unlike the flags above, there's no legitimate reason to
    // want the interactive prompt back in this headless architecture, so
    // this one isn't gated behind a config toggle.
    args.push('--skip-trust');

    const handle = runCliProcess(
      this.config.cliPath,
      args,
      { cwd: request.cwd, timeoutMs: request.timeoutMs ?? this.config.timeoutMs, env: request.env },
      {
        onLine: (line) => {
          const json = parseJsonLine(line);
          if (json === null) return;
          const { progressLines, answerDelta, final, sessionId } = translateGeminiEvent(json);
          if (progressLines && request.onProgress) {
            for (const text of progressLines) request.onProgress({ text });
          }
          if (answerDelta) answer += answerDelta;
          if (final) finalResult = final;
          if (sessionId) capturedSessionId = sessionId;
        },
      },
    );

    const result = handle.done.then((runResult) => {
      const success = runResult.success && (!finalResult || finalResult.success);
      return {
        success,
        // Gemini's own "result" event carries no answer text (unlike
        // Claude's) — the accumulated assistant message deltas are the only
        // source.
        outputText: answer || '',
        durationMs: runResult.durationMs,
        exitCode: runResult.exitCode,
        cancelled: runResult.cancelled,
        timedOut: runResult.timedOut,
        errorMessage: runResult.errorMessage ?? finalResult?.errorMessage,
        // A failed resume attempt (invalid/expired session id) exits before
        // any "init" event streams, so capturedSessionId stays undefined —
        // fall back to the original id only on success, so a genuine failure
        // reports no session id and ExecutionManager can clear the stale one
        // instead of re-persisting it forever.
        sessionId: capturedSessionId ?? (success ? request.sessionId : undefined),
      };
    });

    return { cancel: handle.cancel, result };
  }
}
