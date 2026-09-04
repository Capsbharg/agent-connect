import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Captures the argv each agent would spawn its CLI with, without actually
// spawning anything — cross-spawn is the one thing every CliProcessRunner
// call bottoms out on.
const spawnCalls: string[][] = [];
vi.mock('cross-spawn', () => ({
  default: (_command: string, args: string[]) => {
    spawnCalls.push(args);
    return {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: () => {},
      pid: 1234,
    };
  },
}));

const { ClaudeAgent } = await import('../../src/agents/claude/ClaudeAgent.js');
const { CursorAgent } = await import('../../src/agents/cursor/CursorAgent.js');
const { GeminiAgent } = await import('../../src/agents/gemini/GeminiAgent.js');

/**
 * The three headless-mode flags (Claude's --dangerously-skip-permissions,
 * Cursor's --force, Gemini's --yolo) all default to "on" — including when
 * the config field is omitted entirely, not just when it's explicitly
 * `true`. This matters because these config types are public API: a caller
 * who constructs `new ClaudeAgent({ cliPath, timeoutMs })` without the flag
 * must see the same behavior as before the flag existed, or a minor version
 * bump would silently break them (only `false` is allowed to opt out).
 */
describe('headless-mode flag defaults', () => {
  // The fake spawn() below never emits 'close', so CliProcessRunner's own
  // timeout timer would otherwise leak past the end of each test (and its
  // callback would call tree-kill against a made-up pid). Fake timers keep
  // that timer from ever actually firing.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ClaudeAgent passes --dangerously-skip-permissions when the field is omitted, and omits it when explicitly false', () => {
    spawnCalls.length = 0;
    new ClaudeAgent({ cliPath: 'claude', timeoutMs: 1000 }).execute({ prompt: 'hi', cwd: '.' });
    expect(spawnCalls[0]).toContain('--dangerously-skip-permissions');

    spawnCalls.length = 0;
    new ClaudeAgent({
      cliPath: 'claude',
      timeoutMs: 1000,
      dangerouslySkipPermissions: false,
    }).execute({
      prompt: 'hi',
      cwd: '.',
    });
    expect(spawnCalls[0]).not.toContain('--dangerously-skip-permissions');
  });

  it('CursorAgent passes --force when the field is omitted, and omits it when explicitly false', () => {
    spawnCalls.length = 0;
    new CursorAgent({ cliPath: 'cursor-agent', timeoutMs: 1000 }).execute({
      prompt: 'hi',
      cwd: '.',
    });
    expect(spawnCalls[0]).toContain('--force');

    spawnCalls.length = 0;
    new CursorAgent({ cliPath: 'cursor-agent', timeoutMs: 1000, force: false }).execute({
      prompt: 'hi',
      cwd: '.',
    });
    expect(spawnCalls[0]).not.toContain('--force');
  });

  it('GeminiAgent passes --yolo when the field is omitted, and omits it when explicitly false', () => {
    spawnCalls.length = 0;
    new GeminiAgent({ cliPath: 'gemini', timeoutMs: 1000 }).execute({ prompt: 'hi', cwd: '.' });
    expect(spawnCalls[0]).toContain('--yolo');

    spawnCalls.length = 0;
    new GeminiAgent({ cliPath: 'gemini', timeoutMs: 1000, yolo: false }).execute({
      prompt: 'hi',
      cwd: '.',
    });
    expect(spawnCalls[0]).not.toContain('--yolo');
  });
});
