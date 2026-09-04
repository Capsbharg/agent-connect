# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security vulnerability.**

Instead, email **capsbharg@gmail.com** with:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (a minimal repro is very helpful).
- The version of `@capsbharg/agent-connect` affected.

You should get an acknowledgment within a few days. Once a fix is available, it'll be released and you'll be credited in the release notes (unless you'd prefer otherwise).

## Supported versions

This project is early-stage (pre-1.x in spirit, currently versioned 1.x on npm) and does not yet maintain multiple release branches — only the latest published version receives fixes.

## Scope and known tradeoffs

A few things are **deliberate design tradeoffs, not bugs**, and don't need a report — they're documented here and in the README's [Security Notes](README.md#security-notes) so you can make an informed deployment decision:

- **Agents run headless.** `ClaudeAgent` passes `--dangerously-skip-permissions`, `CursorAgent` passes `--force`, and `GeminiAgent` passes `--yolo` by default (`CLAUDE_SKIP_PERMISSIONS` / `CURSOR_FORCE` / `GEMINI_YOLO`) — this is required for a CLI agent to respond to a chat message without a human approving every action in a terminal. The actual access boundary is `ALLOWED_USERS`/`ALLOWED_CHANNELS`/`ALLOWED_GROUPS`, not the agent CLI's own confirmation prompts.
- **An authorized user has full run-of-the-project access.** Once a user passes the `AuthorizationProvider` check, they can direct arbitrary file writes and shell command execution inside whichever registered project is active — there's no per-action, per-command approval step beyond that gate. If you need one, implement a custom `AuthorizationProvider` or a plugin hooking `beforeExecution`.
- **The admin dashboard has no authentication of its own** — it's bound to `127.0.0.1` deliberately and must never be exposed beyond localhost (e.g. via a reverse proxy) without adding your own auth layer in front of it.
- **`projects.json` is a local, operator-controlled allowlist.** A project name is matched as an exact key, never resolved as or joined into a filesystem path — but anyone authorized to prompt the bot can act anywhere inside any registered project's directory.

If you find a way to defeat one of these boundaries itself (e.g. escape the `projects.json` allowlist, bypass `AuthorizationProvider`, or achieve command injection through the argv-array spawn), that **is** a vulnerability worth reporting.
