# Developer Guide

## Two ways to build an app

### 1. `AgentConnect.fromEnv()` — everything from environment variables

```js
import { AgentConnect } from '@capsbharg/agent-connect';

const app = AgentConnect.fromEnv();
await app.start();
```

Reads `.env` (see `.env.example` at the repo root, or generate one with `npx @capsbharg/agent-connect init`) and auto-configures:

- **Messaging**: `SlackAdapter` if `SLACK_BOT_TOKEN`+`SLACK_SIGNING_SECRET`+`SLACK_APP_TOKEN` are set; `TelegramAdapter` if `TELEGRAM_BOT_TOKEN` is set. At least one is required.
- **Agents**: `ClaudeAgent` (on by default), `CursorAgent`/`CodexAgent` if `CURSOR_ENABLED=true`/`CODEX_ENABLED=true`. At least one is required.
- **Storage/queue**: `RedisStorageProvider` + `BullMQQueueProvider` if `REDIS_URL` is set; otherwise `InMemoryStorageProvider` + `InMemoryQueueProvider` (single-process, dev only — a warning is logged).
- **Security**: `AllowListAuthorizationProvider` from `ALLOWED_USERS`/`ALLOWED_CHANNELS`/`ALLOWED_GROUPS`.
- **Admin dashboard**: Bull Board at `http://127.0.0.1:<ADMIN_PORT>/admin/queues` when `ADMIN_ENABLED=true` (default) and a Redis queue is in use.

Every full env var reference is in `.env.example`.

### 2. `new AgentConnect({...})` — explicit dependency injection

```js
import {
  AgentConnect,
  SlackAdapter,
  TelegramAdapter,
  ClaudeAgent,
  CursorAgent,
  CodexAgent,
} from '@capsbharg/agent-connect';

const app = new AgentConnect({
  messaging: [new SlackAdapter(), new TelegramAdapter()],
  agents: [new ClaudeAgent(), new CursorAgent(), new CodexAgent()],
});

await app.start();
```

Each adapter/agent's constructor argument is **optional** — omit it and the class resolves its own slice of config from environment variables (the same values `fromEnv()` would use), or pass an explicit config object for full control:

```js
new SlackAdapter({
  config: { botToken, signingSecret, appToken, editThrottleMs: 1500, progressMaxLines: 12 },
  logger: myLogger, // any object implementing the Logger interface
});
```

`AgentConnectOptions` also accepts `storage`, `queue`, `authentication`, `authorization`, `events`, `logger`, `plugins`, `projectsConfigPath`, `defaultAgent`, `concurrency`, `progressMaxLinesByPlatform`, `security`, `maxQueuedPerIdentity` (default `20`; `0` = unlimited), and `admin` — every one of them defaults sensibly (see `core/AgentConnect.ts`) so you only override what you actually need to change. This is the seam for swapping in your own `QueueProvider`, a custom `AuthorizationProvider` (RBAC, OPA, ...), etc.

Passing `authorization` yourself takes over the empty-allowlist startup warning too — `AgentConnect.start()` only checks whether the default `AllowListAuthorizationProvider` would allow everyone; a custom provider's restrictions aren't inspectable from outside it.

## Projects

Claude/Cursor/Codex only ever run inside a project directory you've explicitly registered — never an arbitrary path. Map project names to absolute local paths in `projects.json` (gitignored; copy `projects.example.json`):

```json
{
  "backend-api": "/path/to/your/backend-api",
  "frontend-web": "/path/to/your/frontend-web"
}
```

A user runs `use <project>` to select one; the name is matched **exactly** against a key in this file.

## Commands

| Command         | Description                                                              |
| --------------- | ------------------------------------------------------------------------ |
| `help`          | List available commands                                                  |
| `projects`      | List registered projects                                                 |
| `current`       | Show your active project                                                 |
| `use <project>` | Switch your active project                                               |
| `agents`        | List registered agents                                                   |
| `agent [name]`  | Show or switch which agent handles your prompts                          |
| `status`        | Show your running/queued executions, with their ids                      |
| `cancel [id]`   | Stop/clear everything, or cancel just one execution by id (see `status`) |
| `health`        | Check every registered agent's CLI/availability                          |
| `clear`         | Clear your active project selection                                      |

Anything else is sent to your active agent as a prompt (requires an active project). Plugins can register additional commands through `PluginContext.commands` — see the [Plugin Guide](./plugin-guide.md).

## Logging

Pass any object implementing the `Logger` interface (`debug`/`info`/`warn`/`error`/`child`) as `logger`. `createLogger()` returns the built-in pino-backed implementation (pretty-printed in a TTY, JSON otherwise).

## CLI

```bash
npx @capsbharg/agent-connect init     # interactively write .env, projects.json, and an example entrypoint
npx @capsbharg/agent-connect doctor   # check agent CLIs on PATH, Redis connectivity, and platform tokens
```
