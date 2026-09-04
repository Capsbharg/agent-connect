export interface CursorTranslated {
  progressLines?: string[];
  answerDelta?: string;
  final?: {
    success: boolean;
    outputText: string;
  };
}

function extractText(event: Record<string, unknown>): string {
  const candidate = event.text ?? event.delta ?? event.content ?? event.result ?? event.message;
  if (typeof candidate === 'string') return candidate;
  if (
    candidate &&
    typeof candidate === 'object' &&
    'text' in (candidate as Record<string, unknown>)
  ) {
    const inner = (candidate as Record<string, unknown>).text;
    return typeof inner === 'string' ? inner : '';
  }
  return '';
}

/**
 * Best-effort translation of `cursor-agent -p --output-format stream-json`
 * events. Cursor's CLI is newer and less publicly documented than Claude
 * Code's or Codex's, so this handles the commonly-seen shapes (assistant
 * text deltas, tool-call announcements, a terminal result/done event)
 * defensively rather than assuming one exact locked-in schema. Verify
 * against your installed cursor-agent version and adjust the field names
 * here if needed — nothing outside this file depends on them.
 */
export function translateCursorEvent(json: unknown): CursorTranslated {
  if (!json || typeof json !== 'object') return {};
  const event = json as Record<string, unknown>;
  const type = String(event.type ?? event.event ?? '');

  if (type === 'tool_call' || type === 'tool_use') {
    const toolName = String(event.tool ?? event.name ?? 'tool');
    return { progressLines: [`Using ${toolName}...`] };
  }

  if (type === 'assistant' || type === 'message' || type === 'text' || type === 'delta') {
    const text = extractText(event);
    return text ? { answerDelta: text } : {};
  }

  if (type === 'result' || type === 'done' || type === 'completed') {
    const success = event.is_error !== true && event.success !== false;
    return { final: { success, outputText: extractText(event) } };
  }

  if (type === 'error') {
    return { progressLines: [`Error: ${extractText(event) || 'unknown error'}`] };
  }

  return {};
}
