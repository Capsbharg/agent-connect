import IORedis from 'ioredis';
import { WebClient } from '@slack/web-api';
import { runCliProcess } from '../../agents/shared/CliProcessRunner.js';

interface CheckResult {
  label: string;
  ok: boolean;
  detail?: string;
}

function checkCli(label: string, cliPath: string): Promise<CheckResult> {
  return new Promise((resolve) => {
    const handle = runCliProcess(cliPath, ['--version'], { cwd: process.cwd(), timeoutMs: 10_000 });
    handle.done.then((result) => {
      resolve(
        result.exitCode === 0
          ? { label, ok: true }
          : { label, ok: false, detail: result.errorMessage ?? `"${cliPath}" not found on PATH` },
      );
    });
  });
}

async function checkRedis(url: string): Promise<CheckResult> {
  const client = new IORedis(url, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: true,
    connectTimeout: 3000,
  });
  try {
    await client.connect();
    await client.ping();
    return { label: `Redis (${url})`, ok: true };
  } catch (error) {
    return { label: `Redis (${url})`, ok: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    client.disconnect();
  }
}

async function checkSlack(botToken: string): Promise<CheckResult> {
  try {
    const client = new WebClient(botToken);
    const result = await client.auth.test();
    return { label: 'Slack token', ok: true, detail: `authenticated as ${result.user} in ${result.team}` };
  } catch (error) {
    return { label: 'Slack token', ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function checkTelegram(botToken: string): Promise<CheckResult> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const body = (await response.json()) as { ok: boolean; result?: { username?: string }; description?: string };
    return body.ok
      ? { label: 'Telegram token', ok: true, detail: `authenticated as @${body.result?.username}` }
      : { label: 'Telegram token', ok: false, detail: body.description };
  } catch (error) {
    return { label: 'Telegram token', ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** `agent-connect doctor`: checks agent CLIs on PATH, Redis connectivity, and platform tokens — all read from the current environment (.env is loaded before this runs). */
export async function runDoctor(): Promise<void> {
  const checks: Promise<CheckResult>[] = [];

  if (process.env.SLACK_BOT_TOKEN) checks.push(checkSlack(process.env.SLACK_BOT_TOKEN));
  if (process.env.TELEGRAM_BOT_TOKEN) checks.push(checkTelegram(process.env.TELEGRAM_BOT_TOKEN));
  if (process.env.REDIS_URL) checks.push(checkRedis(process.env.REDIS_URL));

  if (process.env.CLAUDE_ENABLED !== 'false') {
    checks.push(checkCli('Claude Code CLI', process.env.CLAUDE_CLI_PATH || 'claude'));
  }
  if (process.env.CURSOR_ENABLED === 'true') {
    checks.push(checkCli('Cursor CLI', process.env.CURSOR_CLI_PATH || 'cursor-agent'));
  }
  if (process.env.CODEX_ENABLED === 'true') {
    checks.push(checkCli('Codex CLI', process.env.CODEX_CLI_PATH || 'codex'));
  }

  console.log('\nagent-connect doctor\n');

  if (checks.length === 0) {
    console.log('Nothing to check yet — run "agent-connect init" first, or set env vars manually.');
    return;
  }

  const results = await Promise.all(checks);
  let allOk = true;
  for (const result of results) {
    const icon = result.ok ? '✅' : '❌';
    console.log(`${icon} ${result.label}${result.detail ? ` — ${result.detail}` : ''}`);
    if (!result.ok) allOk = false;
  }

  console.log('');
  if (!allOk) {
    console.log('Some checks failed — see above.');
    process.exitCode = 1;
  } else {
    console.log('Everything looks good.');
  }
}
