import { describe, expect, it } from 'vitest';
import { runCliProcess } from '../../../src/agents/shared/CliProcessRunner.js';

describe('runCliProcess', () => {
  it('streams stdout lines and resolves successfully on a clean exit', async () => {
    const lines: string[] = [];
    const handle = runCliProcess(
      process.execPath,
      ['-e', "console.log('one'); console.log('two');"],
      { cwd: process.cwd(), timeoutMs: 10_000 },
      { onLine: (line) => lines.push(line) },
    );

    const result = await handle.done;

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(lines).toEqual(['one', 'two']);
  });

  it('reports a non-zero exit as unsuccessful', async () => {
    const handle = runCliProcess(process.execPath, ['-e', 'process.exit(3)'], {
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });

    const result = await handle.done;

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(3);
  });

  it('cancel() kills the process and marks the result as cancelled', async () => {
    const handle = runCliProcess(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      cwd: process.cwd(),
      timeoutMs: 60_000,
    });

    handle.cancel();
    const result = await handle.done;

    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(false);
  }, 10_000);

  it('times out a long-running process', async () => {
    const handle = runCliProcess(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      cwd: process.cwd(),
      timeoutMs: 200,
    });

    const result = await handle.done;

    expect(result.timedOut).toBe(true);
    expect(result.success).toBe(false);
  }, 10_000);
});
