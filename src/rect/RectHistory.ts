/**
 * Snapshot undo/redo for an editable RectBoard (or any document). Call
 * {@link record} with the new state after every committed change (e.g. in
 * the board's `commit` handler); {@link undo} / {@link redo} hand back the
 * state to show without recording it again.
 *
 * Snapshots are deep copies (structuredClone by default): hosts usually
 * mutate their document in place during a drag, so a snapshot must never
 * share references with the live state.
 */
export class RectHistory<T> {

    private undoStack: T[] = [];
    private redoStack: T[] = [];
    /** Copy of the state at the last record: the clean "before" of the next one. */
    private last: T;

    public constructor(
        initial: T,
        private readonly max = 50,
        private readonly clone: (state: T) => T = (s) => structuredClone(s)
    ) {
        this.last = this.clone(initial);
    }

    /** `state` is the new committed state. */
    public record(state: T): void {
        this.undoStack.push(this.last);
        if (this.undoStack.length > this.max) {
            this.undoStack.shift();
        }
        this.redoStack = [];
        this.last = this.clone(state);
    }

    /** Forget the past and start from `state` (e.g. after loading another document). */
    public reset(state: T): void {
        this.undoStack = [];
        this.redoStack = [];
        this.last = this.clone(state);
    }

    public get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    public get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /** The state before the last record, or undefined. */
    public undo(): T | undefined {
        const prev = this.undoStack.pop();
        if (prev === undefined) {
            return undefined;
        }
        this.redoStack.push(this.last);
        this.last = this.clone(prev);
        return prev;
    }

    public redo(): T | undefined {
        const next = this.redoStack.pop();
        if (next === undefined) {
            return undefined;
        }
        this.undoStack.push(this.last);
        this.last = this.clone(next);
        return next;
    }

}
