# Plugin Guide

A plugin registers itself against the running app — new commands, event listeners — without the core ever importing it or knowing it exists.

## The interface

```ts
interface PluginContext {
  events: EventPublisher; // on(event, listener) / emit(event, payload)
  commands: CommandRegistry; // register(name, description, handler, { takesArg? })
  logger: Logger;
  config?: Readonly<ResolvedConfig>; // only set when the app was built via AgentConnect.fromEnv()
}

interface Plugin {
  name: string;
  register(ctx: PluginContext): void | Promise<void>;
}
```

Pass plugins to `AgentConnect`:

```js
import { AgentConnect, AuditLogPlugin } from '@capsbharg/agent-connect';

const app = new AgentConnect({
  messaging: [...],
  agents: [...],
  plugins: [new AuditLogPlugin(), new MyPlugin()],
});
```

`register()` runs once, during `app.start()`, before any messaging adapter begins listening.

## Events

| Event             | Fires                                                                           | Payload                         |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------------- |
| `beforeMessage`   | Every inbound message, before auth                                              | `{ message }`                   |
| `afterMessage`    | After a message finished routing (command handled, prompt enqueued, or dropped) | `{ message, identity }`         |
| `beforeExecution` | Right before an agent starts running a prompt                                   | `{ payload, identity }`         |
| `afterExecution`  | Right after an agent finishes                                                   | `{ payload, identity, result }` |
| `beforeReply`     | Right before the final answer is sent back                                      | `{ payload, content }`          |
| `afterReply`      | Right after it's sent                                                           | `{ payload, content }`          |

`events.on(name, listener)` returns an unsubscribe function. A throwing listener is logged and does not stop other listeners from running.

## Worked example: `AuditLogPlugin`

This ships with the framework (`core/plugins/AuditLogPlugin.ts`) as the reference implementation — it only uses the public `Plugin`/`EventPublisher` surface, exactly like a third-party plugin would:

```ts
export class AuditLogPlugin implements Plugin {
  readonly name = 'audit-log';

  register(ctx: PluginContext): void {
    ctx.events.on('beforeExecution', ({ payload, identity }) => {
      ctx.logger.info('audit: execution starting', {
        identityId: identity.id,
        project: payload.projectName,
        agent: payload.agentName,
      });
    });

    ctx.events.on('afterExecution', ({ payload, identity, result }) => {
      ctx.logger.info('audit: execution finished', {
        identityId: identity.id,
        project: payload.projectName,
        agent: payload.agentName,
        success: result.success,
        durationMs: result.durationMs,
      });
    });
  }
}
```

## Registering a command

```ts
class DeployStatusPlugin implements Plugin {
  readonly name = 'deploy-status';

  register(ctx: PluginContext): void {
    ctx.commands.register('deploy-status', 'show the last deploy result', async (_arg, cmdCtx) => {
      await cmdCtx.responder.post({ text: 'Last deploy: ✅ 2 minutes ago' });
    });
  }
}
```

Commands you register this way show up in `help` output automatically (`CommandRegistry.describeAll()` includes every registered command, built-in or plugin-added).

## Planned, not implemented

GitHub, GitLab, and Jira integrations are natural plugins (react to `afterExecution` to comment on an issue/PR, register a `/deploy` command, etc.) but are intentionally left as documented extension points rather than shipped — build one following the pattern above.
