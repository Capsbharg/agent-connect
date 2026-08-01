import crossSpawn from 'cross-spawn';
import treeKill from 'tree-kill';

export interface CliProcessResult {
  success: boolean;
  exitCode: number | null;
  durationMs: number;
  cancelled: boolean;
  timedOut: boolean;
  errorMessage?: string;
}

export interface CliProcessRunOptions {
  /** Called once per complete stdout line (NDJSON or otherwise). */
  onLine?: (line: string) => void;
}

export interface CliProcessHandle {
  cancel: () => void;
  done: Promise<CliProcessResult>;
}

/**
 * Generalized low-level child_process management, shared by every CLI-based
 * AgentAdapter (Claude Code, Cursor, Codex). No agent-specific knowledge here
 * — just spawn (argv array, never a shell string), line-buffer stdout,
 * timeout, cancel (tree-kill, so child processes die too), and cleanup.
 * Ports claudeRunner.js.
 */
export function runCliProcess(
  command: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: Record<string, string> },
  { onLine }: CliProcessRunOptions = {},
): CliProcessHandle {
  const startedAt = Date.now();
  let cleaned = false;
  let cancelled = false;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const child = crossSpawn(command, args, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let resolveDone!: (result: CliProcessResult) => void;
  const done = new Promise<CliProcessResult>((resolve) => {
    resolveDone = resolve;
  });

  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    child.removeAllListeners();
  }

  function killTree(): void {
    if (child.pid) treeKill(child.pid);
  }

  function cancel(): void {
    cancelled = true;
    killTree();
  }

  timer = setTimeout(() => {
    timedOut = true;
    killTree();
  }, opts.timeoutMs);

  let stdoutBuffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8');
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && onLine) onLine(trimmed);
    }
  });

  let stderrOutput = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrOutput += chunk.toString('utf8');
  });

  child.on('error', (error) => {
    // e.g. ENOENT because the CLI isn't installed/on PATH.
    cleanup();
    resolveDone({
      success: false,
      exitCode: null,
      durationMs: Date.now() - startedAt,
      cancelled: false,
      timedOut: false,
      errorMessage: error.message,
    });
  });

  function flushRemainingBuffer(): void {
    const trimmed = stdoutBuffer.trim();
    stdoutBuffer = '';
    if (trimmed && onLine) onLine(trimmed);
  }

  child.on('close', (exitCode) => {
    // The CLI doesn't guarantee its final line ends with a newline; without
    // this, a trailing event could be silently dropped.
    flushRemainingBuffer();
    cleanup();
    resolveDone({
      success: !cancelled && !timedOut && exitCode === 0,
      exitCode,
      durationMs: Date.now() - startedAt,
      cancelled,
      timedOut,
      errorMessage: !cancelled && !timedOut && exitCode !== 0 ? truncate(stderrOutput, 500) : undefined,
    });
  });

  return { done, cancel };
}

function truncate(text: string, maxLength: number): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}
