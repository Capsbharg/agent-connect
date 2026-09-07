import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same pattern as headlessFlagDefaults.test.ts — capture argv without spawning.
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
const { CodexAgent } = await import('../../src/agents/codex/CodexAgent.js');
const { GeminiAgent } = await import('../../src/agents/gemini/GeminiAgent.js');

/**
 * `AgentExecutionRequest.model` (set from a project's `model` override in
 * projects.json) should be passed through as `--model <value>` on every
 * CLI-based agent, and omitted entirely when not set. Each flag/spelling was
 * verified against the real CLI: `claude --help`, `codex exec --help`
 * (`-m, --model`), and Gemini's own source (`-m, --model`); Cursor's is
 * per its public docs only (`--model "gpt-5"`), not independently verified
 * via a real cursor-agent install — see the comment in CursorAgent.ts.
 */
describe('per-project model override passthrough', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ClaudeAgent passes --model when set, and omits it when not', () => {
    spawnCalls.length = 0;
    new ClaudeAgent({ cliPath: 'claude', timeoutMs: 1000 }).execute({
      prompt: 'hi',
      cwd: '.',
      model: 'opus',
    });
    expect(spawnCalls[0]).toEqual(expect.arrayContaining(['--model', 'opus']));

    spawnCalls.length = 0;
    new ClaudeAgent({ cliPath: 'claude', timeoutMs: 1000 }).execute({ prompt: 'hi', cwd: '.' });
    expect(spawnCalls[0]).not.toContain('--model');
  });

  it('CursorAgent passes --model when set, and omits it when not', () => {
    spawnCalls.length = 0;
    new CursorAgent({ cliPath: 'cursor-agent', timeoutMs: 1000 }).execute({
      prompt: 'hi',
      cwd: '.',
      model: 'gpt-5',
    });
    expect(spawnCalls[0]).toEqual(expect.arrayContaining(['--model', 'gpt-5']));

    spawnCalls.length = 0;
    new CursorAgent({ cliPath: 'cursor-agent', timeoutMs: 1000 }).execute({
      prompt: 'hi',
      cwd: '.',
    });
    expect(spawnCalls[0]).not.toContain('--model');
  });

  it('CodexAgent passes --model when set, and omits it when not', () => {
    spawnCalls.length = 0;
    new CodexAgent({ cliPath: 'codex', timeoutMs: 1000 }).execute({
      prompt: 'hi',
      cwd: '.',
      model: 'o3',
    });
    expect(spawnCalls[0]).toEqual(expect.arrayContaining(['--model', 'o3']));

    spawnCalls.length = 0;
    new CodexAgent({ cliPath: 'codex', timeoutMs: 1000 }).execute({ prompt: 'hi', cwd: '.' });
    expect(spawnCalls[0]).not.toContain('--model');
  });

  it('GeminiAgent passes --model when set, and omits it when not', () => {
    spawnCalls.length = 0;
    new GeminiAgent({ cliPath: 'gemini', timeoutMs: 1000 }).execute({
      prompt: 'hi',
      cwd: '.',
      model: 'gemini-2.5-pro',
    });
    expect(spawnCalls[0]).toEqual(expect.arrayContaining(['--model', 'gemini-2.5-pro']));

    spawnCalls.length = 0;
    new GeminiAgent({ cliPath: 'gemini', timeoutMs: 1000 }).execute({ prompt: 'hi', cwd: '.' });
    expect(spawnCalls[0]).not.toContain('--model');
  });

  it('the prompt still ends up as the trailing positional argument alongside --model', () => {
    spawnCalls.length = 0;
    new CodexAgent({ cliPath: 'codex', timeoutMs: 1000 }).execute({
      prompt: 'implement the thing',
      cwd: '.',
      model: 'o3',
    });
    expect(spawnCalls[0]!.at(-1)).toBe('implement the thing');
  });
});
