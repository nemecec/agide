/** An event is a plain, serializable object discriminated by `type`. */
export interface BaseEvent {
  readonly type: string;
}

export type Unsubscribe = () => void;

/**
 * Synchronous typed event bus. Handlers run in subscription order during `emit`.
 * A handler that throws does not stop the other handlers; the error goes to `onError`.
 */
export class EventBus<E extends BaseEvent> {
  private readonly byType = new Map<string, Set<(event: E) => void>>();
  private readonly any = new Set<(event: E) => void>();

  constructor(private readonly onError: (error: unknown, event: E) => void = (error) => console.error(error)) {}

  on<T extends E['type']>(type: T, handler: (event: Extract<E, { type: T }>) => void): Unsubscribe {
    let set = this.byType.get(type);
    if (!set) {
      set = new Set();
      this.byType.set(type, set);
    }
    const wrapped = handler as (event: E) => void;
    set.add(wrapped);
    return () => set.delete(wrapped);
  }

  onAny(handler: (event: E) => void): Unsubscribe {
    this.any.add(handler);
    return () => this.any.delete(handler);
  }

  emit(event: E): void {
    const handlers = [...(this.byType.get(event.type) ?? []), ...this.any];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        this.onError(error, event);
      }
    }
  }
}
