import { describe, expect, it } from 'vitest';
import { translateCodexEvent } from '../../../src/agents/codex/CodexStreamParser.js';

describe('translateCodexEvent', () => {
  it('suppresses thread/turn start events with no thread_id', () => {
    expect(translateCodexEvent({ type: 'thread.started' })).toEqual({});
    expect(translateCodexEvent({ type: 'turn.started' })).toEqual({});
  });

  it('extracts thread_id from thread.started as the session id, for continuing the conversation later', () => {
    const result = translateCodexEvent({
      type: 'thread.started',
      thread_id: '01a07d21-9a14-7fd3-8511-47d5ca30e93d',
    });
    expect(result.sessionId).toBe('01a07d21-9a14-7fd3-8511-47d5ca30e93d');
  });

  it('ignores a non-string thread_id rather than throwing', () => {
    expect(translateCodexEvent({ type: 'thread.started', thread_id: 12345 })).toEqual({});
  });

  it('turns an agent_message item into an answer delta', () => {
    const result = translateCodexEvent({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'Hello' },
    });
    expect(result.answerDelta).toBe('Hello');
  });

  it('turns a non-message item into a progress line', () => {
    const result = translateCodexEvent({
      type: 'item.completed',
      item: { type: 'command_execution', command: 'npm test' },
    });
    expect(result.progressLines).toEqual(['Using npm test...']);
  });

  it('produces a successful final result on turn.completed', () => {
    const result = translateCodexEvent({ type: 'turn.completed', turn: { text: 'All good.' } });
    expect(result.final).toEqual({ success: true, outputText: 'All good.' });
  });

  it('produces a failed final result on turn.failed', () => {
    const result = translateCodexEvent({ type: 'turn.failed', message: 'went wrong' });
    expect(result.final).toEqual({ success: false, outputText: 'went wrong' });
  });

  it('surfaces error events as a progress line', () => {
    expect(translateCodexEvent({ type: 'error', message: 'boom' }).progressLines?.[0]).toContain(
      'Error:',
    );
  });

  it('returns nothing for malformed input', () => {
    expect(translateCodexEvent(undefined)).toEqual({});
  });
});
