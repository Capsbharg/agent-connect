# API Reference

Everything below is exported from the package root (`import { ... } from '@capsbharg/agent-connect'`). See `src/index.ts` for the authoritative list.

## `AgentConnect`

```ts
class AgentConnect {
  constructor(options: AgentConnectOptions);
  static fromEnv(env?: NodeJS.ProcessEnv): AgentConnect;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

`AgentConnectOptions`:

| Field                        | Type                                   | Default                                                      |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| `messaging`                  | `MessagingAdapter[]`                   | required, non-empty                                          |
| `agents`                     | `AgentAdapter[]`                       | required, non-empty                                          |
| `storage`                    | `StorageProvider`                      | `InMemoryStorageProvider`                                    |
| `queue`                      | `QueueProvider<ExecutionJobPayload>`   | `InMemoryQueueProvider`                                      |
| `authentication`             | `AuthenticationProvider`               | `PassthroughAuthenticationProvider`                          |
| `authorization`              | `AuthorizationProvider`                | `AllowListAuthorizationProvider` (empty allowlists)          |
| `events`                     | `EventPublisher`                       | `EventBus`                                                   |
| `logger`                     | `Logger`                               | `createLogger()`                                             |
| `plugins`                    | `Plugin[]`                             | `[]`                                                         |
| `projectsConfigPath`         | `string`                               | `./projects.json`                                            |
| `defaultAgent`               | `string`                               | first entry in `agents`                                      |
| `concurrency`                | `number`                               | `4`                                                          |
| `progressMaxLinesByPlatform` | `Record<string, number>`               | `{}` (falls back to 12 per platform)                         |
| `security`                   | `SecurityConfig`                       | all-empty allowlists (unrestricted — logs a startup warning) |
| `maxQueuedPerIdentity`       | `number`                               | `20` (`0` = unlimited)                                       |
| `admin`                      | `{ enabled?: boolean; port?: number }` | `{ enabled: false }`                                         |

## Messaging adapters

- `new SlackAdapter(options?: { config?: SlackConfig; logger?: Logger })`
- `new TelegramAdapter(options?: { config?: TelegramConfig; logger?: Logger })`

Both implement `MessagingAdapter` and resolve their config from environment variables when `config` is omitted.

## Agents

- `new ClaudeAgent(config?: ClaudeConfig)`
- `new CursorAgent(config?: CursorConfig)`
- `new CodexAgent(config?: CodexConfig)`
- `new GeminiAgent(config?: GeminiConfig)`

All four implement `AgentAdapter` and resolve their config from environment variables when omitted.

## The seven interfaces

See [architecture.md](./architecture.md#the-seven-interfaces-srcinterfaces) for the full table; each is a plain TypeScript `interface` exported as a type from `@capsbharg/agent-connect`.

## Providers you can construct directly

`RedisStorageProvider`, `InMemoryStorageProvider`, `BullMQQueueProvider`, `InMemoryQueueProvider`, `PassthroughAuthenticationProvider`, `AllowListAuthorizationProvider`, `EventBus`.

`new RedisStorageProvider(redisUrl, logger, keyPrefix?)` and `new BullMQQueueProvider(queueName, redisUrl, logger, keyPrefix?)` both take an optional trailing `keyPrefix` to namespace their Redis keys — set it when `redisUrl` points at an instance shared with other apps.

## Plugins

`Plugin`, `PluginContext` (types), `PluginManager`, `AuditLogPlugin` — see the [Plugin Guide](./plugin-guide.md).

## Config & logging

`loadFromEnv(env?): ResolvedConfig`, `createLogger(options?): Logger`, plus the `ResolvedConfig` sub-types (`SecurityConfig`, `AdminConfig`, `SlackConfig`, `TelegramConfig`, `ClaudeConfig`, `CursorConfig`, `CodexConfig`, `GeminiConfig`).

## Errors

`AgentConnectError` (base), `ConfigError`, `ProjectNotFoundError`, `AgentNotFoundError`.

## Domain types

`Identity`, `InboundMessage`, `InboundAttachment`, `ReplyContext`, `ReplyContent`, `StreamingResponder`, `AgentProgressChunk`, `AgentExecutionRequest`, `AgentExecutionResult`, `AgentExecutionHandle`, `AgentHealthStatus`, `ProjectSessionState`, `ExecutionJobPayload`, `ParsedCommand`, `CommandContext`, `CommandHandler`, `EventMap`, `EventName`.

## Advanced building blocks

Exposed for building a custom app or testing: `ProjectRegistry`, `ProjectSession`, `AgentRegistry`, `CommandRegistry`, `registerBuiltinCommands`, `Router`, `ExecutionManager`, `ActiveExecutionRegistry`, `QueueDashboard`.
