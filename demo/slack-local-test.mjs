import 'dotenv/config';
import { AgentConnect, SlackAdapter, ClaudeAgent, createLogger } from '@capsbharg/agent-connect';

// Temporary local-test variant of slack.mjs — same Slack+Claude wiring, but
// in-memory storage/queue instead of Redis/BullMQ (no Redis available on
// this machine right now). Not part of the tracked demo; safe to delete.
const logger = createLogger();

const CLAUDE_CLI_PATH =
  process.env.CLAUDE_CLI_PATH ??
  'C:/Users/me/AppData/Local/Temp/agent-cli-inspect/node_modules/.bin/claude.cmd';
const claude = new ClaudeAgent({ cliPath: CLAUDE_CLI_PATH, timeoutMs: 600_000 });

const health = await claude.healthCheck();
if (!health.healthy) {
  console.warn(`[warn] claude CLI health check failed: ${health.message ?? 'unknown reason'}`);
}

const app = new AgentConnect({
  messaging: [new SlackAdapter()],
  agents: [claude],
  logger,
  projectsConfigPath: new URL('./projects.json', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    '$1',
  ),
});

process.on('SIGINT', () => void app.stop().then(() => process.exit(0)));
process.on('SIGTERM', () => void app.stop().then(() => process.exit(0)));

await app.start();
console.log('\n=== Connected to Slack (Socket Mode) — in-memory storage/queue for this test ===');
console.log('DM the bot, or mention it in a channel it\'s in. Try: "use demo", then give it a task.');
console.log('Press Ctrl+C to stop.\n');
