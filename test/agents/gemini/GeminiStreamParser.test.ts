import { describe, expect, it } from 'vitest';
import { translateGeminiEvent } from '../../../src/agents/gemini/GeminiStreamParser.js';

describe('translateGeminiEvent', () => {
  it('suppresses init events', () => {
    expect(translateGeminiEvent({ type: 'init', session_id: 's1', model: 'gemini-pro' })).toEqual(
      {},
    );
  });

  it('collects assistant message content as an answer delta', () => {
    const result = translateGeminiEvent({ type: 'message', role: 'assistant', content: 'Hello' });
    expect(result.answerDelta).toBe('Hello');
  });

  it('ignores user-role message events (the echoed prompt)', () => {
    expect(
      translateGeminiEvent({ type: 'message', role: 'user', content: 'do the thing' }),
    ).toEqual({});
  });

  it('turns a tool_use event into a human-readable progress line', () => {
    const result = translateGeminiEvent({
      type: 'tool_use',
      tool_name: 'read_file',
      tool_id: 't1',
      parameters: { path: 'src/foo.ts' },
    });
    expect(result.progressLines).toEqual(['Using read_file...']);
  });

  it('surfaces only failed tool_result events', () => {
    const ok = translateGeminiEvent({
      type: 'tool_result',
      tool_id: 't1',
      status: 'success',
      output: 'fine',
    });
    expect(ok).toEqual({});

    const failed = translateGeminiEvent({
      type: 'tool_result',
      tool_id: 't1',
      status: 'error',
      output: '',
      error: { type: 'TOOL_EXECUTION_ERROR', message: 'file not found' },
    });
    expect(failed.progressLines).toEqual(['Error: file not found']);
  });

  it('surfaces a top-level error event as a progress line', () => {
    const result = translateGeminiEvent({
      type: 'error',
      severity: 'warning',
      message: 'rate limited, retrying',
    });
    expect(result.progressLines).toEqual(['Error: rate limited, retrying']);
  });

  it('extracts a successful result event with no outputText (Gemini never carries the answer there)', () => {
    const result = translateGeminiEvent({
      type: 'result',
      status: 'success',
      stats: { total_tokens: 100 },
    });
    expect(result.final).toEqual({ success: true, outputText: '', errorMessage: undefined });
  });

  it('extracts a failed result event with its error message', () => {
    const result = translateGeminiEvent({
      type: 'result',
      status: 'error',
      error: { type: 'RESOURCE_EXHAUSTED', message: 'quota exceeded' },
    });
    expect(result.final).toEqual({
      success: false,
      outputText: '',
      errorMessage: 'quota exceeded',
    });
  });

  it('falls back to a generic error message when a failed result carries none', () => {
    const result = translateGeminiEvent({ type: 'result', status: 'error' });
    expect(result.final?.errorMessage).toBe('unknown error');
  });

  it('returns nothing for malformed input', () => {
    expect(translateGeminiEvent(null)).toEqual({});
    expect(translateGeminiEvent('not an object')).toEqual({});
    expect(translateGeminiEvent(42)).toEqual({});
  });

  it('returns nothing for an unrecognized event type', () => {
    expect(translateGeminiEvent({ type: 'something_new' })).toEqual({});
  });
});
