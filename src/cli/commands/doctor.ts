import { Redis as IORedis } from 'ioredis';
import { WebClient } from '@slack/web-api';
import { ClaudeAgent } from '../../agents/claude/ClaudeAgent.js';
import { CursorAgent } from '../../agents/cursor/CursorAgent.js';
import { CodexAgent } from '../../agents/codex/CodexAgent.js';
import { GeminiAgent } from '../../agents/gemini/GeminiAgent.js';
import type { AgentAdapter } from '../../interfaces/AgentAdapter.js';

interface CheckResult {
  label: string;
  ok: boolean;
  detail?: string;
}

/** Reuses each agent's own healthCheck() rather than re-implementing a CLI probe here, so `doctor` and a running app agree on what "healthy" means. */
async function checkAgent(label: string, agent: AgentAdapter): Promise<CheckResult> {
  const status = await agent.healthCheck();
  return status.healthy
    ? { label, ok: true }
    : { label, ok: false, detail: status.message ?? 'not found on PATH' };
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
    return {
      label: `Redis (${url})`,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    client.disconnect();
  }
}

async function checkSlack(botToken: string): Promise<CheckResult> {
  try {
    const client = new WebClient(botToken);
    const result = await client.auth.test();
    return {
      label: 'Slack token',
      ok: true,
      detail: `authenticated as ${result.user} in ${result.team}`,
    };
  } catch (error) {
    return {
      label: 'Slack token',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkTelegram(botToken: string): Promise<CheckResult> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const body = (await response.json()) as {
      ok: boolean;
      result?: { username?: string };
      description?: string;
    };
    return body.ok
      ? { label: 'Telegram token', ok: true, detail: `authenticated as @${body.result?.username}` }
      : { label: 'Telegram token', ok: false, detail: body.description };
  } catch (error) {
    return {
      label: 'Telegram token',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Uses Discord's REST API directly (not discord.js) so checking a token never opens a real gateway connection. */
async function checkDiscord(botToken: string): Promise<CheckResult> {
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      return {
        label: 'Discord token',
        ok: false,
        detail: body?.message ?? `HTTP ${response.status}`,
      };
    }
    const body = (await response.json()) as { username?: string };
    return { label: 'Discord token', ok: true, detail: `authenticated as ${body.username}` };
  } catch (error) {
    return {
      label: 'Discord token',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** `agent-connect doctor`: checks agent CLIs on PATH, Redis connectivity, and platform tokens — all read from the current environment (.env is loaded before this runs). */
export async function runDoctor(): Promise<void> {
  const checks: Promise<CheckResult>[] = [];

  if (process.env.SLACK_BOT_TOKEN) checks.push(checkSlack(process.env.SLACK_BOT_TOKEN));
  if (process.env.TELEGRAM_BOT_TOKEN) checks.push(checkTelegram(process.env.TELEGRAM_BOT_TOKEN));
  if (process.env.DISCORD_BOT_TOKEN) checks.push(checkDiscord(process.env.DISCORD_BOT_TOKEN));
  if (process.env.REDIS_URL) checks.push(checkRedis(process.env.REDIS_URL));

  // Built directly from process.env (not loadFromEnv()) so an unrelated
  // misconfiguration — e.g. Slack partially set up — can never prevent
  // `doctor` from reporting on the agents that ARE configured correctly.
  if (process.env.CLAUDE_ENABLED !== 'false') {
    checks.push(
      checkAgent(
        'Claude Code CLI',
        new ClaudeAgent({
          cliPath: process.env.CLAUDE_CLI_PATH || 'claude',
          timeoutMs: Number(process.env.CLAUDE_TIMEOUT_MS) || 600_000,
          dangerouslySkipPermissions: true,
        }),
      ),
    );
  }
  if (process.env.CURSOR_ENABLED === 'true') {
    checks.push(
      checkAgent(
        'Cursor CLI',
        new CursorAgent({
          cliPath: process.env.CURSOR_CLI_PATH || 'cursor-agent',
          apiKey: process.env.CURSOR_API_KEY,
          timeoutMs: Number(process.env.CURSOR_TIMEOUT_MS) || 600_000,
          force: true,
        }),
      ),
    );
  }
  if (process.env.CODEX_ENABLED === 'true') {
    checks.push(
      checkAgent(
        'Codex CLI',
        new CodexAgent({
          cliPath: process.env.CODEX_CLI_PATH || 'codex',
          timeoutMs: Number(process.env.CODEX_TIMEOUT_MS) || 600_000,
        }),
      ),
    );
  }
  if (process.env.GEMINI_ENABLED === 'true') {
    checks.push(
      checkAgent(
        'Gemini CLI',
        new GeminiAgent({
          cliPath: process.env.GEMINI_CLI_PATH || 'gemini',
          timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 600_000,
          yolo: true,
        }),
      ),
    );
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
