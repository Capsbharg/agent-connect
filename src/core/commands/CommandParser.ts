import type { ParsedCommand } from '../types.js';

export interface CommandNameInfo {
  takesArg: boolean;
}

/**
 * Pure parser: separates a known command invocation from a free-form prompt.
 * A command word is only recognized as a command if it's registered, and —
 * for commands that don't take an argument — there's no trailing text. That
 * second rule is what keeps "help me implement X" from being swallowed by
 * the `help` command instead of reaching the agent as a prompt.
 */
export function parseCommand(
  text: string,
  knownCommands: ReadonlyMap<string, CommandNameInfo>,
): ParsedCommand {
  const trimmed = (text ?? '').trim();
  const [firstWord, ...rest] = trimmed.split(/\s+/);
  const keyword = (firstWord ?? '').toLowerCase();
  const info = knownCommands.get(keyword);

  if (!info) {
    return { type: 'prompt', text: trimmed };
  }
  if (!info.takesArg && rest.length > 0) {
    return { type: 'prompt', text: trimmed };
  }

  return { type: 'command', name: keyword, arg: rest.join(' ').trim() };
}
