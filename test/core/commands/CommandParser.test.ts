import { describe, expect, it } from 'vitest';
import { parseCommand } from '../../../src/core/commands/CommandParser.js';

const KNOWN = new Map([
  ['help', { takesArg: false }],
  ['use', { takesArg: true }],
]);

describe('parseCommand', () => {
  it('recognizes a bare known command with no arguments', () => {
    expect(parseCommand('help', KNOWN)).toEqual({ type: 'command', name: 'help', arg: '' });
  });

  it('is case-insensitive on the command keyword', () => {
    expect(parseCommand('HELP', KNOWN)).toEqual({ type: 'command', name: 'help', arg: '' });
  });

  it('treats trailing text after a no-arg command as a prompt instead', () => {
    expect(parseCommand('help me implement X', KNOWN)).toEqual({
      type: 'prompt',
      text: 'help me implement X',
    });
  });

  it('captures the remainder as an argument for a command that takes one', () => {
    expect(parseCommand('use backend-api', KNOWN)).toEqual({ type: 'command', name: 'use', arg: 'backend-api' });
  });

  it('treats unknown keywords as a prompt', () => {
    expect(parseCommand('do the thing', KNOWN)).toEqual({ type: 'prompt', text: 'do the thing' });
  });

  it('treats empty input as an empty prompt', () => {
    expect(parseCommand('', KNOWN)).toEqual({ type: 'prompt', text: '' });
  });
});
