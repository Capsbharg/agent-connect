import type { EventMap } from '../core/events/eventTypes.js';

export type EventListener<T> = (payload: T) => void | Promise<void>;

/**
 * Typed pub/sub for the lifecycle hooks (beforeMessage/afterMessage/
 * beforeExecution/afterExecution/beforeReply/afterReply). emit() awaits every
 * listener sequentially so a plugin can rely on ordering/backpressure; a
 * throwing listener is logged and does not stop the others from running.
 */
export interface EventPublisher {
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): Promise<void>;
  on<K extends keyof EventMap>(event: K, listener: EventListener<EventMap[K]>): () => void;
}
