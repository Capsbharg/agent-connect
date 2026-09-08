export interface GeminiTranslated {
  progressLines?: string[];
  answerDelta?: string;
  sessionId?: string;
  final?: {
    success: boolean;
    outputText: string;
    errorMessage?: string;
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Translation of `gemini -p --output-format stream-json` events. Verified
 * directly against the CLI's own source (packages/core/src/output/
 * stream-json-formatter.ts and its call sites) in @google/gemini-cli 0.58.0 —
 * not scraped from docs, which are inconsistent about this schema. Re-check
 * against your installed version if progress lines look off; nothing outside
 * this file depends on these field names.
 *
 * Event shapes seen:
 *   { type: "init", session_id, model }
 *   { type: "message", role: "user"|"assistant", content, delta? }
 *   { type: "tool_use", tool_name, tool_id, parameters }
 *   { type: "tool_result", tool_id, status: "success"|"error", output, error? }
 *   { type: "error", severity: "warning"|"error", message }
 *   { type: "result", status: "success"|"error", stats, error? }
 * Unlike Claude's `result` event, Gemini's carries no final answer text —
 * the answer is only ever available as accumulated "message"/assistant
 * content deltas, so `final.outputText` here is always empty; the caller
 * falls back to its own accumulated answer, same as Cursor/Codex.
 *
 * `init.session_id` is a real, resumable conversation id — confirmed against
 * a live install: `--resume <that-uuid>` correctly restores prior context
 * despite `gemini --help` only documenting "latest"/an index for `--resume`;
 * the CLI's own error text on an invalid id ("...--resume {uuid}...")
 * confirms this is sanctioned, not an accident. See GeminiAgent.ts.
 */
export function translateGeminiEvent(json: unknown): GeminiTranslated {
  if (!json || typeof json !== 'object') return {};
  const event = json as Record<string, unknown>;

  switch (event.type) {
    case 'init': {
      // The caller emits its own "Starting..." line when the process spawns.
      const sessionId = asString(event.session_id);
      return sessionId ? { sessionId } : {};
    }

    case 'message': {
      if (event.role !== 'assistant') return {};
      const content = asString(event.content);
      return content ? { answerDelta: content } : {};
    }

    case 'tool_use': {
      const toolName = asString(event.tool_name) ?? 'tool';
      return { progressLines: [`Using ${toolName}...`] };
    }

    case 'tool_result': {
      if (event.status !== 'error') return {};
      const error = event.error as Record<string, unknown> | undefined;
      const message = asString(error?.message) ?? asString(event.output) ?? 'unknown error';
      return { progressLines: [`Error: ${message}`] };
    }

    case 'error': {
      const message = asString(event.message) ?? 'unknown error';
      return { progressLines: [`Error: ${message}`] };
    }

    case 'result': {
      const success = event.status === 'success';
      const error = event.error as Record<string, unknown> | undefined;
      return {
        final: {
          success,
          outputText: '',
          errorMessage: success ? undefined : (asString(error?.message) ?? 'unknown error'),
        },
      };
    }

    default:
      return {};
  }
}
