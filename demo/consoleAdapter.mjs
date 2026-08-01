/**
 * Minimal MessagingAdapter that prints bot replies to stdout instead of
 * talking to Slack/Telegram. Lets the demo exercise the real
 * Router -> CommandRegistry -> ExecutionManager pipeline from the published
 * package without needing platform credentials.
 */
export class ConsoleAdapter {
  platform = 'console';
  capabilities = { threads: false, fileUploads: false, slashCommands: false };
  #handler = null;

  async start() {}
  async stop() {}

  onMessage(handler) {
    this.#handler = handler;
  }

  createResponder() {
    return {
      async post(content) {
        console.log(`\n[bot] ${content.text}`);
      },
      async update(content) {
        console.log(`[bot:update] ${content.text}`);
      },
      async complete(content) {
        console.log(`[bot:done] ${content.text}`);
      },
    };
  }

  /** Test-only helper: feeds one inbound message through the pipeline as if a user sent it. */
  async simulateMessage(text, overrides = {}) {
    if (!this.#handler) throw new Error('ConsoleAdapter: start() the app before simulating messages.');
    console.log(`\n> ${text}`);
    await this.#handler({
      platform: 'console',
      platformUserId: 'demo-user',
      channelId: 'demo-channel',
      isDirect: true,
      text,
      raw: null,
      ...overrides,
    });
  }
}
