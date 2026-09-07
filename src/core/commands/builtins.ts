import type { QueueProvider } from '../../interfaces/QueueProvider.js';
import type { AgentRegistry } from '../agentRegistry/AgentRegistry.js';
import type { ActiveExecutionRegistry } from '../execution/ActiveExecutionRegistry.js';
import type { Logger } from '../logger/Logger.js';
import type { ProjectRegistry, ProjectSession } from '../project/index.js';
import type { ExecutionJobPayload } from '../types.js';
import type { CommandRegistry } from './CommandRegistry.js';

export interface BuiltinCommandDeps {
  projectRegistry: ProjectRegistry;
  projectSession: ProjectSession;
  agentRegistry: AgentRegistry;
  queue: QueueProvider<ExecutionJobPayload>;
  activeExecutions: ActiveExecutionRegistry;
  logger: Logger;
}

/** Registers the same command set the original bot exposed, plus `agents`/`agent` for multi-agent selection. */
export function registerBuiltinCommands(registry: CommandRegistry, deps: BuiltinCommandDeps): void {
  const { projectRegistry, projectSession, agentRegistry, queue, activeExecutions, logger } = deps;

  registry.register('help', 'show this message', async (_arg, ctx) => {
    const lines = [
      '*Commands*',
      ...registry.describeAll().map((c) => `\`${c.name}\` - ${c.description}`),
      'Anything else is sent to your active agent as a prompt (requires an active project).',
    ];
    await ctx.responder.post({ text: lines.join('\n') });
  });

  registry.register('projects', 'list available projects', async (_arg, ctx) => {
    const names = projectRegistry.listNames();
    const text =
      names.length === 0
        ? 'No projects are configured. Add entries to `projects.json`.'
        : `*Available projects*\n${names.map((n) => `- ${n}`).join('\n')}`;
    await ctx.responder.post({ text });
  });

  registry.register('current', 'show your active project', async (_arg, ctx) => {
    const session = await projectSession.get(ctx.identity.id);
    if (!session) {
      await ctx.responder.post({ text: 'No project selected. Use `use <project>` to pick one.' });
      return;
    }
    // Reflects what will actually run, not just the user's own selection —
    // a project's `agent`/`model` override in projects.json only applies
    // when the user hasn't picked an agent themselves (see Router.ts), so
    // this must resolve it the same way Router does.
    const effectiveAgent = await agentRegistry.getActiveAgentName(
      ctx.identity.id,
      projectRegistry.getAgentOverride(session.project),
    );
    const effectiveModel = projectRegistry.getModelOverride(session.project);
    const lines = [
      `Active project: *${session.project}*`,
      `cwd: \`${session.cwd}\``,
      `Agent: *${effectiveAgent}*${effectiveModel ? ` (model: *${effectiveModel}*)` : ''}`,
    ];
    await ctx.responder.post({ text: lines.join('\n') });
  });

  registry.register(
    'use',
    'switch your active project',
    async (arg, ctx) => {
      const name = arg.trim();
      if (!name) {
        await ctx.responder.post({
          text: 'Usage: `use <project>`. Run `projects` to see available options.',
        });
        return;
      }
      if (!projectRegistry.isValid(name)) {
        const names = projectRegistry.listNames();
        await ctx.responder.post({
          text:
            `Unknown project "${name}".` +
            (names.length
              ? `\nAvailable projects: ${names.join(', ')}`
              : '\nNo projects are configured.'),
        });
        return;
      }
      const cwd = projectRegistry.getPath(name);
      await projectSession.setActiveProject(ctx.identity.id, name, cwd!);
      await ctx.responder.post({ text: `Switched to *${name}* (\`${cwd}\`).` });
    },
    { takesArg: true },
  );

  registry.register('agents', 'list available agents', async (_arg, ctx) => {
    const names = agentRegistry.list().map((agent) => agent.name);
    await ctx.responder.post({
      text: `*Available agents*\n${names.map((n) => `- ${n}`).join('\n')}`,
    });
  });

  registry.register(
    'agent',
    'show or switch which agent handles your prompts',
    async (arg, ctx) => {
      const name = arg.trim();
      if (!name) {
        // Same resolution Router.ts uses when actually enqueueing a prompt —
        // otherwise this can report an agent that isn't the one that runs
        // (see the `current` command for the same fix).
        const session = await projectSession.get(ctx.identity.id);
        const projectAgent = session
          ? projectRegistry.getAgentOverride(session.project)
          : undefined;
        const active = await agentRegistry.getActiveAgentName(ctx.identity.id, projectAgent);
        await ctx.responder.post({
          text: `Active agent: *${active}*. Usage: \`agent <name>\`. Run \`agents\` to see available options.`,
        });
        return;
      }
      if (!agentRegistry.has(name)) {
        await ctx.responder.post({
          text: `Unknown agent "${name}". Run \`agents\` to see available options.`,
        });
        return;
      }
      await agentRegistry.setActiveAgent(ctx.identity.id, name);
      await ctx.responder.post({ text: `Switched to agent *${name}*.` });
    },
    { takesArg: true },
  );

  registry.register('status', 'show your running/queued executions', async (_arg, ctx) => {
    const active = activeExecutions.get(ctx.identity.id);
    const waiting = await queue.listPending((payload) => payload.identityId === ctx.identity.id);

    if (!active && waiting.length === 0) {
      await ctx.responder.post({ text: 'No running or queued executions.' });
      return;
    }
    const lines: string[] = [];
    if (active) lines.push(`Running execution \`${active.jobId}\`.`);
    if (waiting.length > 0) {
      lines.push(
        `${waiting.length} execution(s) queued: ${waiting.map((job) => `\`${job.id}\``).join(', ')}.`,
      );
    }
    lines.push('Use `cancel <id>` to cancel one, or `cancel` with no id to stop/clear everything.');
    await ctx.responder.post({ text: lines.join('\n') });
  });

  registry.register(
    'cancel',
    'stop your running execution and clear your queued ones, or `cancel <id>` to cancel just one (see `status`)',
    async (arg, ctx) => {
      const jobId = arg.trim();

      if (jobId) {
        const active = activeExecutions.get(ctx.identity.id);
        if (active && active.jobId === jobId) {
          active.cancel();
          await ctx.responder.post({ text: `Stopped running execution \`${jobId}\`.` });
          return;
        }

        const waiting = await queue.listPending(
          (payload) => payload.identityId === ctx.identity.id,
        );
        const match = waiting.find((job) => job.id === jobId);
        if (!match) {
          await ctx.responder.post({
            text: `No running or queued execution \`${jobId}\` found for you. Run \`status\` to see your executions.`,
          });
          return;
        }

        await queue.cancel(jobId).catch((error: unknown) => {
          logger.error(`Failed to cancel queued execution ${jobId}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        });
        await ctx.responder.post({ text: `Cancelled queued execution \`${jobId}\`.` });
        return;
      }

      const active = activeExecutions.get(ctx.identity.id);
      if (active) active.cancel();

      const waiting = await queue.listPending((payload) => payload.identityId === ctx.identity.id);
      await Promise.all(
        waiting.map((job) =>
          queue.cancel(job.id).catch((error: unknown) => {
            logger.error(`Failed to cancel queued execution ${job.id}`, {
              error: error instanceof Error ? error.message : String(error),
            });
          }),
        ),
      );

      if (!active && waiting.length === 0) {
        await ctx.responder.post({ text: 'Nothing to cancel.' });
        return;
      }
      const parts: string[] = [];
      if (active) parts.push('Stopped your running execution.');
      if (waiting.length > 0) parts.push(`Cleared ${waiting.length} queued execution(s).`);
      await ctx.responder.post({ text: parts.join(' ') });
    },
    { takesArg: true },
  );

  registry.register(
    'health',
    "check every registered agent's CLI/availability",
    async (_arg, ctx) => {
      const results = await Promise.all(
        agentRegistry.list().map(async (agent) => {
          try {
            const status = await agent.healthCheck();
            return { name: agent.name, ...status };
          } catch (error) {
            return {
              name: agent.name,
              healthy: false,
              message: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );
      const lines = results.map(
        (r) => `${r.healthy ? '✅' : '❌'} ${r.name}${r.message ? ` — ${r.message}` : ''}`,
      );
      await ctx.responder.post({ text: `*Agent health*\n${lines.join('\n')}` });
    },
  );

  registry.register('clear', 'clear your active project selection', async (_arg, ctx) => {
    await projectSession.clear(ctx.identity.id);
    await ctx.responder.post({ text: 'Cleared your active project selection.' });
  });
}
