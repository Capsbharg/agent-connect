# Migration Guide: from the original Slack + Claude bot

This project used to be a single-purpose CommonJS app (`claude-slack-agent`): Slack + Claude Code CLI + BullMQ + Redis. It is now `agent-connect`, a general framework — Slack/Telegram in, Claude/Cursor/Codex out, all behind dependency-injected interfaces. Every behavior from the original bot still exists; almost everything just moved.

## What's unchanged

- `projects.json` format is identical — no changes needed to your existing file.
- The security model is identical: exact-allowlist project lookup, CLI agents always `spawn`ed with an argv array, fail-fast env validation.
- The command set (`help`, `projects`, `current`, `use`, `status`, `cancel`, `clear`) still works exactly the same way, plus two new ones: `agents` and `agent <name>` (needed now that more than one agent can be registered at once).
- The "post once, edit repeatedly" streaming behavior in Slack is unchanged.

## What changed

- **Language & entrypoint**: the app is now a TypeScript library, not a standalone script. Where you used to run `node src/app.js`, you now either run `AgentConnect.fromEnv()` from your own tiny entrypoint (see `examples/slack-claude-minimal/`) or use the new CLI (`npx @capsbharg/agent-connect init` scaffolds that entrypoint for you).
- **Environment variables**: most are unchanged (`REDIS_URL`, `PROJECTS_CONFIG_PATH`, `SLACK_*`, `CLAUDE_TIMEOUT_MS`). Renamed/generalized:
  - `CLAUDE_WORKER_CONCURRENCY` → `AGENT_WORKER_CONCURRENCY`
  - `BULL_BOARD_ENABLED` → `ADMIN_ENABLED`, `PORT` (for the dashboard) → `ADMIN_PORT`
  - New: `DEFAULT_AGENT`, `CLAUDE_ENABLED` (default `true`), `CURSOR_ENABLED`/`CODEX_ENABLED` (default `false`) plus their own `*_CLI_PATH`/`*_TIMEOUT_MS`, `TELEGRAM_BOT_TOKEN` + `TELEGRAM_EDIT_THROTTLE_MS`/`TELEGRAM_PROGRESS_MAX_LINES`, `ALLOWED_USERS`/`ALLOWED_CHANNELS`/`ALLOWED_GROUPS`.
  - See `.env.example` for the complete, current list.
- **Redis is now optional.** If `REDIS_URL` is unset, `fromEnv()` falls back to in-memory storage/queue providers (single-process, dev-only — a warning is logged). Set `REDIS_URL` for anything beyond local development, exactly as before.
- **Multiple agents can now be registered at once.** Each user has an active agent selection (`agent <name>`), defaulting to `DEFAULT_AGENT` — previously there was only ever Claude.
- **The Slack thread streaming code moved** from `src/slack/threadUpdater.js` to `SlackThreadStream` behind the generic `StreamingResponder` interface; Telegram gets the equivalent `TelegramMessageStream`.

## Cursor & Codex: verify before relying on them

`CursorAgent` and `CodexAgent` are real, working implementations, but both CLIs are newer and less publicly documented than Claude Code's:

- **Cursor**: invoked as `cursor-agent -p --force --output-format stream-json "<prompt>"`. The stream-json event schema is not fully documented publicly; `CursorStreamParser` handles the commonly-seen shapes defensively. If progress lines look off, check `src/agents/cursor/CursorStreamParser.ts` against your installed `cursor-agent` version's actual output.
- **Codex**: invoked as `codex exec --json --sandbox workspace-write "<prompt>"`. The top-level event types (`thread.started`/`turn.started`/`turn.completed`/`turn.failed`/`item.*`/`error`) are documented; the nested `item` payload shape is not locked in. Check `src/agents/codex/CodexStreamParser.ts` similarly if needed.

Both isolate all of their CLI-specific assumptions inside their own module — a flag or schema fix never touches core.

## File-by-file map

See the "Migration map" table in the pull request description / `docs/architecture.md`'s module map for exactly where each old file's logic now lives (e.g. `src/queue/claudeWorker.js` → `core/execution/ExecutionManager.ts`).
