import type {
  AgentExecutionResult,
  ExecutionJobPayload,
  Identity,
  InboundMessage,
  ReplyContent,
} from '../types.js';

/**
 * The six lifecycle hooks the spec calls out. Plugins and the built-in audit
 * logger both subscribe through EventPublisher — nothing else in core
 * depends on plugins.
 */
export interface EventMap {
  beforeMessage: { message: InboundMessage };
  afterMessage: { message: InboundMessage; identity: Identity | null };
  beforeExecution: { payload: ExecutionJobPayload; identity: Identity };
  afterExecution: { payload: ExecutionJobPayload; identity: Identity; result: AgentExecutionResult };
  beforeReply: { payload: ExecutionJobPayload; content: ReplyContent };
  afterReply: { payload: ExecutionJobPayload; content: ReplyContent };
}

export type EventName = keyof EventMap;
