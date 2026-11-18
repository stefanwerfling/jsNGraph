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

    /** Whether anyone listens for `event` (e.g. to decide on preventDefault). */
    public has<K extends keyof Events>(event: K): boolean {
        return (this.listeners[event]?.size ?? 0) > 0;
    }

    public clear(): void {
        for (const key of Object.keys(this.listeners) as (keyof Events)[]) {
            delete this.listeners[key];
        }
    }

    public emit<K extends keyof Events>(event: K, payload: Events[K]): void {
        this.listeners[event]?.forEach((listener) => listener(payload));
    }

}
