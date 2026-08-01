import { describe, expect, it } from 'vitest';
import { translateCursorEvent } from '../../../src/agents/cursor/CursorStreamParser.js';

describe('translateCursorEvent', () => {
  it('turns a tool_call event into a progress line', () => {
    expect(translateCursorEvent({ type: 'tool_call', tool: 'edit_file' })).toEqual({
      progressLines: ['Using edit_file...'],
    });
  });

  it('extracts an answer delta from a text-bearing event', () => {
    expect(translateCursorEvent({ type: 'assistant', text: 'Hi there' })).toEqual({ answerDelta: 'Hi there' });
    expect(translateCursorEvent({ type: 'delta', delta: 'more text' })).toEqual({ answerDelta: 'more text' });
  });

  it('produces a final result on a terminal event', () => {
    expect(translateCursorEvent({ type: 'result', result: 'Done!' })).toEqual({
      final: { success: true, outputText: 'Done!' },
    });
    expect(translateCursorEvent({ type: 'done', success: false, content: 'Failed.' })).toEqual({
      final: { success: false, outputText: 'Failed.' },
    });
  });

  it('surfaces error events as a progress line', () => {
    expect(translateCursorEvent({ type: 'error', message: 'boom' }).progressLines?.[0]).toContain('Error:');
  });

  it('returns nothing for unrecognized event types', () => {
    expect(translateCursorEvent({ type: 'something-unknown' })).toEqual({});
  });

  it('returns nothing for malformed input', () => {
    expect(translateCursorEvent(null)).toEqual({});
  });
});
