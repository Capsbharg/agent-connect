import type { Plugin, PluginContext } from './Plugin.js';

/**
 * Reference plugin (also the Plugin Guide's worked example): logs every
 * beforeExecution/afterExecution as a structured audit trail, using only the
 * public Plugin/EventPublisher surface — no core module imports this file.
 */
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
