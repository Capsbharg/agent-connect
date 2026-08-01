import fs from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import { runDoctor } from './doctor.js';

const EXAMPLE_APP = `import { AgentConnect } from '@capsbharg/agent-connect';

const app = AgentConnect.fromEnv();

process.on('SIGINT', () => void app.stop().then(() => process.exit(0)));
process.on('SIGTERM', () => void app.stop().then(() => process.exit(0)));

await app.start();
`;

function cancelAndExit(): never {
  clack.cancel('Cancelled.');
  process.exit(1);
}

async function requiredText(message: string, placeholder?: string): Promise<string> {
  const value = await clack.text({ message, placeholder });
  if (clack.isCancel(value)) cancelAndExit();
  return value;
}

async function optionalText(message: string, placeholder?: string): Promise<string> {
  const value = await clack.text({ message, placeholder, defaultValue: '' });
  if (clack.isCancel(value)) cancelAndExit();
  return value;
}

interface RenderEnvOptions {
  platforms: string[];
  agents: string[];
  slack: { botToken: string; signingSecret: string; appToken: string };
  telegram: { botToken: string };
  redisUrl: string;
}

function renderEnv(opts: RenderEnvOptions): string {
  const lines: string[] = [
    'LOG_LEVEL=info',
    `REDIS_URL=${opts.redisUrl}`,
    'PROJECTS_CONFIG_PATH=./projects.json',
    `DEFAULT_AGENT=${opts.agents[0] ?? 'claude'}`,
    'AGENT_WORKER_CONCURRENCY=4',
    'ADMIN_ENABLED=true',
    'ADMIN_PORT=3000',
    '',
    'ALLOWED_USERS=',
    'ALLOWED_CHANNELS=',
    'ALLOWED_GROUPS=',
    '',
  ];

  if (opts.platforms.includes('slack')) {
    lines.push(
      `SLACK_BOT_TOKEN=${opts.slack.botToken}`,
      `SLACK_SIGNING_SECRET=${opts.slack.signingSecret}`,
      `SLACK_APP_TOKEN=${opts.slack.appToken}`,
      'SLACK_EDIT_THROTTLE_MS=1500',
      'SLACK_PROGRESS_MAX_LINES=12',
      '',
    );
  }
  if (opts.platforms.includes('telegram')) {
    lines.push(`TELEGRAM_BOT_TOKEN=${opts.telegram.botToken}`, 'TELEGRAM_EDIT_THROTTLE_MS=1500', 'TELEGRAM_PROGRESS_MAX_LINES=12', '');
  }

  lines.push(
    `CLAUDE_ENABLED=${opts.agents.includes('claude')}`,
    'CLAUDE_CLI_PATH=claude',
    'CLAUDE_TIMEOUT_MS=600000',
    '',
    `CURSOR_ENABLED=${opts.agents.includes('cursor')}`,
    'CURSOR_CLI_PATH=cursor-agent',
    'CURSOR_API_KEY=',
    'CURSOR_TIMEOUT_MS=600000',
    '',
    `CODEX_ENABLED=${opts.agents.includes('codex')}`,
    'CODEX_CLI_PATH=codex',
    'CODEX_TIMEOUT_MS=600000',
    '',
  );

  return lines.join('\n');
}

/** `agent-connect init`: interactively writes .env, projects.json, and a minimal example entrypoint into the current directory. */
export async function runInit(): Promise<void> {
  clack.intro('agent-connect init');

  const cwd = process.cwd();
  const envPath = path.join(cwd, '.env');
  const projectsPath = path.join(cwd, 'projects.json');
  const examplePath = path.join(cwd, 'agent-connect.example.mjs');

  if (fs.existsSync(envPath)) {
    const overwrite = await clack.confirm({ message: '.env already exists. Overwrite it?', initialValue: false });
    if (clack.isCancel(overwrite) || !overwrite) {
      clack.outro('Left .env untouched.');
      return;
    }
  }

  const platformsResult = await clack.multiselect({
    message: 'Which messaging platforms do you want to enable?',
    options: [
      { value: 'slack', label: 'Slack' },
      { value: 'telegram', label: 'Telegram' },
    ],
    required: true,
  });
  if (clack.isCancel(platformsResult)) cancelAndExit();
  const platforms = platformsResult as string[];

  const agentsResult = await clack.multiselect({
    message: 'Which AI agents do you want to enable?',
    options: [
      { value: 'claude', label: 'Claude Code', hint: 'recommended' },
      { value: 'cursor', label: 'Cursor CLI' },
      { value: 'codex', label: 'OpenAI Codex CLI' },
    ],
    initialValues: ['claude'],
    required: true,
  });
  if (clack.isCancel(agentsResult)) cancelAndExit();
  const agents = agentsResult as string[];

  const slack = { botToken: '', signingSecret: '', appToken: '' };
  if (platforms.includes('slack')) {
    slack.botToken = await requiredText('Slack bot token', 'xoxb-...');
    slack.signingSecret = await requiredText('Slack signing secret');
    slack.appToken = await requiredText('Slack app-level token', 'xapp-...');
  }

  const telegram = { botToken: '' };
  if (platforms.includes('telegram')) {
    telegram.botToken = await requiredText('Telegram bot token', 'from @BotFather');
  }

  const redisUrl = await optionalText(
    'Redis URL (leave blank to use in-memory storage/queue — dev only)',
    'redis://127.0.0.1:6379',
  );

  const projectName = await requiredText('Name your first project', 'my-app');
  const projectPath = await requiredText(`Absolute path to "${projectName}"`, cwd);

  fs.writeFileSync(envPath, renderEnv({ platforms, agents, slack, telegram, redisUrl }), 'utf8');
  fs.writeFileSync(projectsPath, `${JSON.stringify({ [projectName]: projectPath }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(examplePath, EXAMPLE_APP, 'utf8');

  clack.outro(
    `Wrote .env, projects.json, and ${path.basename(examplePath)}.\n` +
      `Run "node ${path.basename(examplePath)}" to start once "@capsbharg/agent-connect" is installed as a dependency.`,
  );

  await runDoctor();
}
