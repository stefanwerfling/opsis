import type { DomainEvent } from '../domain/events.js';
import type { EventListener, EventPublisher } from './ports.js';

/**
 * In-process event bus (architecture 01 §5). Listener errors are isolated so that a
 * failing subscriber (e.g. a disconnected SSE client) cannot break a use case.
 */
export class EventBus implements EventPublisher {
  readonly #listeners = new Set<EventListener>();
  readonly #onListenerError: (error: unknown, event: DomainEvent) => void;

  constructor(onListenerError: (error: unknown, event: DomainEvent) => void = () => undefined) {
    this.#onListenerError = onListenerError;
  }

  publish(event: DomainEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        this.#onListenerError(error, event);
      }
    }
  }

  /** Returns an unsubscribe function. */
  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }
}
