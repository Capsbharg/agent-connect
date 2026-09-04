# Contributing to Agent Connect

Thanks for considering a contribution! This project is small and the architecture rule is simple, so most contributions fit one of a few well-defined shapes.

## The one rule

`core/router`, `core/execution`, and `core/commands` depend only on the seven interfaces in `src/interfaces/` — never on a concrete `MessagingAdapter`, `AgentAdapter`, `QueueProvider`, `StorageProvider`, `AuthenticationProvider`, `AuthorizationProvider`, or `EventPublisher`. `src/core/AgentConnect.ts` is the one file allowed to import concrete classes directly, so it can wire whichever ones you pass it.

In practice this means:

- **Adding a messaging platform** (Discord, WhatsApp, ...) → implement `MessagingAdapter` under `src/messaging/<platform>/`, following the shape of `SlackAdapter`/`TelegramAdapter`. You should not need to touch `core/`.
- **Adding an agent CLI** (Amazon Q, OpenHands, ...) → implement `AgentAdapter` under `src/agents/<agent>/`, following `ClaudeAgent`/`CursorAgent`/`CodexAgent`/`GeminiAgent`. `src/agents/shared/CliProcessRunner.ts` already handles spawn/stream/timeout/cancel for any CLI-based agent.
- **Adding a plugin** (GitHub, Jira, ...) → implement `Plugin` (`register(ctx)`), following `AuditLogPlugin`. See [docs/plugin-guide.md](docs/plugin-guide.md).

If a change to add a platform/agent/plugin needs to touch `core/router`, `core/execution`, or `core/commands`, that's a sign the interface is missing something — open an issue to discuss before writing the PR.

## Setup

```bash
git clone https://github.com/Capsbharg/agent-connect.git
cd agent-connect
npm install
```

## Before opening a PR

Run everything CI runs:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

- **Tests**: `vitest`, files live under `test/`, mirroring the `src/` structure. Use `test/helpers/testLogger.ts` for a mock `Logger`. New adapters/providers should ship with a unit test alongside the interface contract they implement — see `test/core/execution/ExecutionManager.test.ts` for the fake-adapter/fake-agent pattern used throughout.
- **Lint/format**: `eslint` (flat config) + `prettier`. `npm run lint:fix` / `npm run format` fix most issues automatically.
- **Types**: strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`). `npm run typecheck` must pass with zero errors.

## PR checklist

- [ ] `npm run lint && npm run typecheck && npm test && npm run build` all pass locally
- [ ] New public behavior has a test
- [ ] New env vars are documented in `.env.example` and the README's environment variables table
- [ ] `docs/architecture.md` updated if the module map or the seven interfaces changed
- [ ] No secrets, tokens, or real local paths committed (double-check `git diff` before pushing)

## Reporting bugs / requesting features

Open a GitHub issue. Include Node version, which messaging platform(s)/agent(s) you're using, and (redacted) logs if relevant — never paste `.env` or `projects.json` contents.

## Reporting a security vulnerability

Do not open a public issue. See [SECURITY.md](SECURITY.md).
