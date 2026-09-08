import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same pattern as headlessFlagDefaults.test.ts/modelOverride.test.ts, but the
// fake child here is a real EventEmitter so a test can simulate real stdout
// lines and a clean exit — needed to verify sessionId actually flows end to
// end through CliProcessRunner, not just that the right argv was built.
const spawnCalls: string[][] = [];
let lastChild: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number };

vi.mock('cross-spawn', () => ({
  default: (_command: string, args: string[]) => {
    spawnCalls.push(args);
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      pid: 1234,
    });
    lastChild = child;
    return child;
  },
}));

function emitLineAndClose(json: unknown): void {
  lastChild.stdout.emit('data', Buffer.from(`${JSON.stringify(json)}\n`));
  lastChild.emit('close', 0);
}

const { ClaudeAgent } = await import('../../src/agents/claude/ClaudeAgent.js');
const { CodexAgent } = await import('../../src/agents/codex/CodexAgent.js');
const { GeminiAgent } = await import('../../src/agents/gemini/GeminiAgent.js');

describe('session resume — argv construction', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
  });

  it('ClaudeAgent passes --resume <id> when sessionId is set, and omits it for a fresh conversation', () => {
    new ClaudeAgent({ cliPath: 'claude', timeoutMs: 1000 }).execute({
      prompt: 'hi',
      cwd: '.',
      sessionId: 'abc-123',
    });
    expect(spawnCalls[0]).toEqual(expect.arrayContaining(['--resume', 'abc-123']));

    spawnCalls.length = 0;
    new ClaudeAgent({ cliPath: 'claude', timeoutMs: 1000 }).execute({ prompt: 'hi', cwd: '.' });
    expect(spawnCalls[0]).not.toContain('--resume');
  });

  it('CodexAgent uses `exec resume <id>` when sessionId is set, and plain `exec` (with --sandbox) otherwise', () => {
    new CodexAgent({ cliPath: 'codex', timeoutMs: 1000 }).execute({
      prompt: 'hi',
      cwd: '.',
      sessionId: 'thread-abc',
    });
    expect(spawnCalls[0]!.slice(0, 3)).toEqual(['exec', 'resume', 'thread-abc']);
    // resume doesn't support --sandbox (verified against `codex exec resume --help`).
    expect(spawnCalls[0]).not.toContain('--sandbox');

    spawnCalls.length = 0;
    new CodexAgent({ cliPath: 'codex', timeoutMs: 1000 }).execute({ prompt: 'hi', cwd: '.' });
    expect(spawnCalls[0]!.slice(0, 1)).toEqual(['exec']);
    expect(spawnCalls[0]).toContain('--sandbox');
    expect(spawnCalls[0]).not.toContain('resume');
  });

  it('GeminiAgent passes --resume <id> when sessionId is set, and always passes --skip-trust', () => {
    new GeminiAgent({ cliPath: 'gemini', timeoutMs: 1000 }).execute({
      prompt: 'hi',
      cwd: '.',
      sessionId: 'gemini-session-abc',
    });
    expect(spawnCalls[0]).toEqual(expect.arrayContaining(['--resume', 'gemini-session-abc']));
    expect(spawnCalls[0]).toContain('--skip-trust');

    spawnCalls.length = 0;
    new GeminiAgent({ cliPath: 'gemini', timeoutMs: 1000 }).execute({ prompt: 'hi', cwd: '.' });
    expect(spawnCalls[0]).not.toContain('--resume');
    // Headless runs have no terminal to answer Gemini's own directory-trust
    // prompt, so this is never conditional on sessionId being set.
    expect(spawnCalls[0]).toContain('--skip-trust');
  });
});

describe('session resume — end-to-end sessionId capture', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ClaudeAgent reports the session_id from the result event on AgentExecutionResult', async () => {
    const handle = new ClaudeAgent({ cliPath: 'claude', timeoutMs: 1000 }).execute({
      prompt: 'hi',
      cwd: '.',
    });

    emitLineAndClose({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      session_id: 'claude-session-xyz',
    });

    const result = await handle.result;
    expect(result.sessionId).toBe('claude-session-xyz');
  });

  it('CodexAgent reports the thread_id from thread.started on AgentExecutionResult', async () => {
    const handle = new CodexAgent({ cliPath: 'codex', timeoutMs: 1000 }).execute({
      prompt: 'hi',
      cwd: '.',
    });

    lastChild.stdout.emit(
      'data',
      Buffer.from(`${JSON.stringify({ type: 'thread.started', thread_id: 'codex-thread-xyz' })}\n`),
    );
    emitLineAndClose({ type: 'turn.completed', turn: { text: 'done' } });

    const result = await handle.result;
    expect(result.sessionId).toBe('codex-thread-xyz');
  });

  it('CodexAgent falls back to the original sessionId if a successful resume never re-emits thread.started', async () => {
    const handle = new CodexAgent({ cliPath: 'codex', timeoutMs: 1000 }).execute({
      prompt: 'hi',
      cwd: '.',
      sessionId: 'thread-abc',
    });

    emitLineAndClose({ type: 'turn.completed', turn: { text: 'done' } });

    const result = await handle.result;
    expect(result.sessionId).toBe('thread-abc');
  });

  it('CodexAgent reports no sessionId when a resume attempt fails outright, instead of the stale id', async () => {
    const handle = new CodexAgent({ cliPath: 'codex', timeoutMs: 1000 }).execute({
      prompt: 'hi',
      cwd: '.',
      sessionId: 'thread-abc',
    });

    // A failed resume (e.g. unknown/expired thread id) never emits
    // thread.started or turn.completed — it just exits non-zero.
    lastChild.stdout.emit('data', Buffer.from(''));
    lastChild.emit('close', 1);

    const result = await handle.result;
    expect(result.success).toBe(false);
    expect(result.sessionId).toBeUndefined();
  });

  it('GeminiAgent reports the session_id from the init event on AgentExecutionResult', async () => {
    const handle = new GeminiAgent({ cliPath: 'gemini', timeoutMs: 1000 }).execute({
      prompt: 'hi',
      cwd: '.',
    });

    lastChild.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({ type: 'init', session_id: 'gemini-session-xyz', model: 'auto' })}\n`,
      ),
    );
    emitLineAndClose({ type: 'result', status: 'success', stats: {} });

    const result = await handle.result;
    expect(result.sessionId).toBe('gemini-session-xyz');
  });

  it('GeminiAgent reports no sessionId when a resume attempt fails outright, instead of the stale id', async () => {
    const handle = new GeminiAgent({ cliPath: 'gemini', timeoutMs: 1000 }).execute({
      prompt: 'hi',
      cwd: '.',
      sessionId: 'gemini-session-stale',
    });

    // A failed resume (e.g. unknown/expired session id) exits non-zero
    // before any "init" event ever streams — verified against a real
    // install (`gemini ... --resume <bogus-uuid>` exits 42 with no events).
    lastChild.stdout.emit('data', Buffer.from(''));
    lastChild.emit('close', 42);

    const result = await handle.result;
    expect(result.success).toBe(false);
    expect(result.sessionId).toBeUndefined();
  });
});
