const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Minimal AgentAdapter standing in for Claude Code/Cursor/Codex, so the demo
 * doesn't require an installed+authenticated agent CLI. Streams a couple of
 * fake progress lines, then "completes" by echoing the prompt back.
 */
export class EchoAgent {
  name = 'echo';

  async healthCheck() {
    return { healthy: true };
  }

  execute(request) {
    let cancelled = false;
    const start = Date.now();

    const result = (async () => {
      request.onProgress?.({ text: `Reading task: "${request.prompt}"` });
      await sleep(300);
      if (cancelled) return this.#cancelledResult(start);

      request.onProgress?.({ text: `Working in ${request.cwd}...` });
      await sleep(300);
      if (cancelled) return this.#cancelledResult(start);

      return {
        success: true,
        outputText: `Echo agent received: "${request.prompt}"`,
        durationMs: Date.now() - start,
        exitCode: 0,
        cancelled: false,
        timedOut: false,
      };
    })();

    return {
      cancel: () => {
        cancelled = true;
      },
      result,
    };
  }

  #cancelledResult(start) {
    return {
      success: false,
      outputText: '',
      durationMs: Date.now() - start,
      exitCode: null,
      cancelled: true,
      timedOut: false,
    };
  }
}
