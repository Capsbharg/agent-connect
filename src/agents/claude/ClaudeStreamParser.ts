/**
 * Pure translation from a single parsed `claude --output-format stream-json`
 * event into something a StreamingResponder can show a human. No state, no I/O.
 * Ports streamTranslator.js.
 */

export interface ClaudeTranslated {
  progressLines?: string[];
  answerDelta?: string;
  final?: {
    success: boolean;
    outputText: string;
    durationMs?: number;
    numTurns?: number;
  };
}

function truncate(text: unknown, maxLength: number): string {
  if (typeof text !== 'string') return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

const TOOL_VERBS: Record<string, (input: Record<string, unknown>) => string> = {
  Read: (input) => `Reading \`${input.file_path}\`...`,
  Edit: (input) => `Editing \`${input.file_path}\`...`,
  Write: (input) => `Writing \`${input.file_path}\`...`,
  Bash: (input) => `Running \`${truncate(input.command, 80)}\`...`,
  Grep: (input) => `Searching for "${input.pattern}"...`,
  Glob: (input) => `Finding files matching ${input.pattern}...`,
  Task: (input) => `Delegating to subagent: ${input.description ?? input.subagent_type ?? 'task'}...`,
  WebFetch: (input) => `Fetching ${input.url}...`,
  WebSearch: (input) => `Searching the web for "${input.query}"...`,
  TodoWrite: () => 'Updating task list...',
};

function toolNameToVerb(name: string, input: Record<string, unknown> | undefined): string {
  const format = TOOL_VERBS[name];
  if (!format) return `Using ${name}...`;
  try {
    return format(input ?? {});
  } catch {
    return `Using ${name}...`;
  }
}

export function translateClaudeEvent(json: unknown): ClaudeTranslated {
  if (!json || typeof json !== 'object') return {};
  const event = json as Record<string, unknown>;

  switch (event.type) {
    case 'system':
      // e.g. subtype "init" — suppressed, the caller emits its own
      // "Starting..." line when the process spawns.
      return {};

    case 'assistant': {
      // A single assistant turn can contain multiple content blocks — e.g.
      // commentary text alongside a tool call, or several parallel tool
      // calls. Walk every block rather than picking just the first match.
      const message = event.message as { content?: unknown[] } | undefined;
      const content = message?.content ?? [];
      const progressLines: string[] = [];
      let answerDelta = '';

      for (const blockRaw of content) {
        const block = blockRaw as Record<string, unknown>;
        if (block.type === 'tool_use') {
          progressLines.push(toolNameToVerb(String(block.name), block.input as Record<string, unknown>));
        } else if (block.type === 'text' && typeof block.text === 'string') {
          answerDelta += block.text;
        }
      }

      const result: ClaudeTranslated = {};
      if (progressLines.length > 0) result.progressLines = progressLines;
      if (answerDelta) result.answerDelta = answerDelta;
      return result;
    }

    case 'user': {
      // Tool results echoed back to the model. Only surface errors —
      // successful tool output is noisy and not useful as a progress line.
      const message = event.message as { content?: unknown[] } | undefined;
      const content = message?.content ?? [];
      const progressLines = content
        .map((block) => block as Record<string, unknown>)
        .filter((block) => block.type === 'tool_result' && block.is_error)
        .map((block) => {
          const blockContent = block.content;
          const text = Array.isArray(blockContent)
            ? blockContent.map((c) => (c as Record<string, unknown>).text ?? '').join(' ')
            : String(blockContent ?? '');
          return `Error: ${truncate(text, 160)}`;
        });
      return progressLines.length > 0 ? { progressLines } : {};
    }

    case 'result':
      return {
        final: {
          success: event.subtype === 'success' && !event.is_error,
          outputText: (event.result as string | undefined) ?? '',
          durationMs: event.duration_ms as number | undefined,
          numTurns: event.num_turns as number | undefined,
        },
      };

    default:
      return {};
  }
}
