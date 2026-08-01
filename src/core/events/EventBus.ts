import type { EventListener, EventPublisher } from '../../interfaces/EventPublisher.js';
import type { EventMap } from './eventTypes.js';
import type { Logger } from '../logger/Logger.js';

export class EventBus implements EventPublisher {
  private readonly listeners = new Map<keyof EventMap, Set<EventListener<unknown>>>();

  constructor(private readonly logger: Logger) {}

  on<K extends keyof EventMap>(event: K, listener: EventListener<EventMap[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set<EventListener<unknown>>();
    set.add(listener as EventListener<unknown>);
    this.listeners.set(event, set);
    return () => set.delete(listener as EventListener<unknown>);
  }

  async emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): Promise<void> {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;

    for (const listener of set) {
      try {
        await listener(payload);
      } catch (error) {
        this.logger.error(`Event listener for "${String(event)}" threw`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
