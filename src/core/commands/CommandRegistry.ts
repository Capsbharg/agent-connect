import type { CommandContext, CommandHandler, ParsedCommand } from '../types.js';
import { parseCommand, type CommandNameInfo } from './CommandParser.js';

interface CommandDefinition {
  description: string;
  takesArg: boolean;
  handler: CommandHandler;
}

/**
 * Open registry of command name -> handler. Built-in commands (help/projects/
 * use/current/agents/agent/status/cancel/clear) and plugin-registered
 * commands live side by side here — a plugin adds a command by calling
 * `register()` through its PluginContext, never by touching this file.
 */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  register(name: string, description: string, handler: CommandHandler, opts?: { takesArg?: boolean }): void {
    this.commands.set(name.toLowerCase(), {
      description,
      handler,
      takesArg: opts?.takesArg ?? false,
    });
  }

  parse(text: string): ParsedCommand {
    const info = new Map<string, CommandNameInfo>();
    for (const [name, def] of this.commands) {
      info.set(name, { takesArg: def.takesArg });
    }
    return parseCommand(text, info);
  }

  describeAll(): Array<{ name: string; description: string }> {
    return [...this.commands.entries()].map(([name, def]) => ({ name, description: def.description }));
  }

  async execute(name: string, arg: string, ctx: CommandContext): Promise<boolean> {
    const def = this.commands.get(name.toLowerCase());
    if (!def) return false;
    await def.handler(arg, ctx);
    return true;
  }
}
