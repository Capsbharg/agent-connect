export interface CodexTranslated {
  progressLines?: string[];
  answerDelta?: string;
  final?: {
    success: boolean;
    outputText: string;
  };
}

function extractText(obj: Record<string, unknown>): string {
  const candidate = obj.text ?? obj.content ?? obj.message ?? obj.output_text ?? obj.result;
  return typeof candidate === 'string' ? candidate : '';
}

/**
 * Best-effort translation of `codex exec --json` events. The top-level event
 * types (thread.started / turn.started / turn.completed / turn.failed /
 * item.* / error) are documented by OpenAI's Codex CLI non-interactive mode;
 * the nested `item` payload's exact shape is not locked in here — verify
 * against your installed codex version and adjust the field names if needed.
 * Nothing outside this file depends on them.
 */
export function translateCodexEvent(json: unknown): CodexTranslated {
  if (!json || typeof json !== 'object') return {};
  const event = json as Record<string, unknown>;
  const type = String(event.type ?? '');

  if (type === 'thread.started' || type === 'turn.started') {
    return {};
  }

  if (type.startsWith('item.')) {
    const item = (event.item as Record<string, unknown> | undefined) ?? {};
    const itemType = String(item.type ?? item.role ?? '');

    if (itemType === 'agent_message' || itemType === 'assistant' || itemType === 'message') {
      const text = extractText(item);
      return text ? { answerDelta: text } : {};
    }

    const label = String(item.command ?? item.tool ?? item.name ?? (itemType || 'tool'));
    return { progressLines: [`Using ${label}...`] };
  }

  if (type === 'turn.completed') {
    const turn = (event.turn as Record<string, unknown> | undefined) ?? {};
    return { final: { success: true, outputText: extractText(event) || extractText(turn) } };
  }

  if (type === 'turn.failed') {
    return { final: { success: false, outputText: extractText(event) } };
  }

  if (type === 'error') {
    return { progressLines: [`Error: ${extractText(event) || 'unknown error'}`] };
  }

  return {};
}
