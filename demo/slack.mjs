import 'dotenv/config';
import {
  AgentConnect,
  SlackAdapter,
  ClaudeAgent,
  BullMQQueueProvider,
  RedisStorageProvider,
  createLogger,
} from '@capsbharg/agent-connect';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const ADMIN_PORT = Number(process.env.ADMIN_PORT ?? 3000);
const logger = createLogger();

const claude = new ClaudeAgent({ cliPath: 'claude', timeoutMs: 600_000 });

const health = await claude.healthCheck();
if (!health.healthy) {
  console.warn(`[warn] claude CLI health check failed: ${health.message ?? 'unknown reason'}`);
  console.warn(
    '[warn] Make sure `claude` is on PATH and that you have run `claude` once to log in.',
  );
}

const app = new AgentConnect({
  messaging: [new SlackAdapter()],
  agents: [claude],
  storage: new RedisStorageProvider(REDIS_URL, logger),
  queue: new BullMQQueueProvider('agent-connect-demo', REDIS_URL, logger),
  admin: { enabled: true, port: ADMIN_PORT },
  projectsConfigPath: new URL('./projects.json', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    '$1',
  ),
});

process.on('SIGINT', () => void app.stop().then(() => process.exit(0)));
process.on('SIGTERM', () => void app.stop().then(() => process.exit(0)));

await app.start();
console.log('\n=== Connected to Slack (Socket Mode) ===');
console.log(
  'DM the bot, or mention it in a channel it\'s in. Try: "use demo", then give it a task.',
);
console.log(
  'Your next prompt in the same project automatically continues that conversation — ' +
    'attach a file to a message and Claude can read it too.',
);
console.log(`Queue dashboard: http://127.0.0.1:${ADMIN_PORT}/admin/queues`);
console.log('Press Ctrl+C to stop.\n');
