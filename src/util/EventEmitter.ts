type Listener<T> = (payload: T) => void;

/**
 * Minimal typed pub/sub, keyed by an event-name -> payload map. Kept tiny
 * and in-house rather than pulling a dependency for a handful of events.
 */
export class EventEmitter<Events extends Record<string, unknown>> {

    private readonly listeners: {[K in keyof Events]?: Set<Listener<Events[K]>>} = {};

    public on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
        (this.listeners[event] ??= new Set()).add(listener);
    }

    public off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
        this.listeners[event]?.delete(listener);
    }

    public emit<K extends keyof Events>(event: K, payload: Events[K]): void {
        this.listeners[event]?.forEach((listener) => listener(payload));
    }

}
