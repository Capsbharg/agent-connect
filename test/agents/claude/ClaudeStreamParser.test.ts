import { describe, expect, it } from 'vitest';
import { translateClaudeEvent } from '../../../src/agents/claude/ClaudeStreamParser.js';

describe('translateClaudeEvent', () => {
  it('suppresses system events', () => {
    expect(translateClaudeEvent({ type: 'system', subtype: 'init' })).toEqual({});
  });

  it('turns a tool_use block into a human-readable progress line', () => {
    const result = translateClaudeEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/foo.ts' } }],
      },
    });
    expect(result.progressLines).toEqual(['Reading `src/foo.ts`...']);
  });

  it('falls back to a generic verb for an unrecognized tool', () => {
    const result = translateClaudeEvent({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'MysteryTool', input: {} }] },
    });
    expect(result.progressLines).toEqual(['Using MysteryTool...']);
  });

  it('collects a text block as an answer delta', () => {
    const result = translateClaudeEvent({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello' }] },
    });
    expect(result.answerDelta).toBe('Hello');
  });

  it('surfaces only error tool results from user events', () => {
    const okResult = translateClaudeEvent({
      type: 'user',
      message: { content: [{ type: 'tool_result', is_error: false, content: 'fine' }] },
    });
    expect(okResult).toEqual({});

    const errorResult = translateClaudeEvent({
      type: 'user',
      message: { content: [{ type: 'tool_result', is_error: true, content: 'bad file' }] },
    });
    expect(errorResult.progressLines?.[0]).toContain('Error:');
  });

  it('extracts the final answer from a successful result event', () => {
    const result = translateClaudeEvent({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'All done.',
    });
    expect(result.final).toEqual({
      success: true,
      outputText: 'All done.',
      durationMs: undefined,
      numTurns: undefined,
    });
  });

  it('marks a result event as failed when is_error is set', () => {
    const result = translateClaudeEvent({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: '',
    });
    expect(result.final?.success).toBe(false);
  });

  it('returns nothing for malformed input', () => {
    expect(translateClaudeEvent(null)).toEqual({});
    expect(translateClaudeEvent('not an object')).toEqual({});
  });
});
