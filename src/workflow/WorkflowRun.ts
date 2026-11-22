import { WorkflowConnectionStatus, WorkflowNodeStatus, WorkflowRunEvent } from './WorkflowTypes';

/** The status picture of a run at one moment (see {@link WorkflowRun.stateAt}). */
export interface WorkflowRunState {
    nodes: Map<string, {status: WorkflowNodeStatus; message?: string}>;
    connections: Map<string, WorkflowConnectionStatus>;
    /** null = nothing dimmed. */
    runPath: {nodes: string[]; connections?: string[]} | null;
}

/**
 * Pure helpers over a recorded run (a list of {@link WorkflowRunEvent}s):
 * ordering, duration, the state at a moment, step times, and squeezing long
 * idle gaps. No DOM — `WorkflowReplay` applies the result to an editor.
 */
export class WorkflowRun {

    /** Events by time; events at the same time keep their recorded order. */
    public static sorted(events: readonly WorkflowRunEvent[]): WorkflowRunEvent[] {
        return events
            .map((e, i) => ({e, i}))
            .sort((a, b) => a.e.at - b.e.at || a.i - b.i)
            .map((x) => x.e);
    }

    /** Time of the last event (0 for an empty run). */
    public static duration(events: readonly WorkflowRunEvent[]): number {
        let end = 0;

        for (const e of events) {
            end = Math.max(end, e.at);
        }

        return end;
    }

    /** Distinct event times, ascending — the stops of step forward/back. */
    public static steps(events: readonly WorkflowRunEvent[]): number[] {
        return [...new Set(events.map((e) => e.at))].sort((a, b) => a - b);
    }

    /** The state after every event with `at <= time` (events must be sorted). */
    public static stateAt(sorted: readonly WorkflowRunEvent[], time: number): WorkflowRunState {
        const state: WorkflowRunState = {nodes: new Map(), connections: new Map(), runPath: null};

        for (const e of sorted) {
            if (e.at > time) {
                break;
            }
            WorkflowRun.apply(state, e);
        }

        return state;
    }

    /** Apply one event to a state in place. */
    public static apply(state: WorkflowRunState, e: WorkflowRunEvent): void {
        if ('clear' in e) {
            state.nodes.clear();
            state.connections.clear();
            state.runPath = null;
        } else if ('node' in e) {
            if (e.status === 'idle') {
                state.nodes.delete(e.node);
            } else {
                state.nodes.set(e.node, e.message === undefined ? {status: e.status} : {status: e.status, message: e.message});
            }
        } else if ('connection' in e) {
            if (e.state === null) {
                state.connections.delete(e.connection);
            } else {
                state.connections.set(e.connection, {...e.state});
            }
        } else {
            state.runPath = e.runPath === null ? null : {...e.runPath};
        }
    }

    /**
     * Shorten every pause between two event times to at most `maxGap` ms and
     * start the run at 0 — a run that waited minutes for an API replays in
     * seconds, while the order and the short gaps stay as recorded.
     */
    public static compress(events: readonly WorkflowRunEvent[], maxGap: number): WorkflowRunEvent[] {
        const sorted = WorkflowRun.sorted(events);
        const out: WorkflowRunEvent[] = [];
        let prev: number | null = null;
        let t = 0;

        for (const e of sorted) {
            if (prev !== null) {
                t += Math.min(e.at - prev, maxGap);
            }
            prev = e.at;
            out.push({...e, at: t});
        }

        return out;
    }

    /** Whether anything went wrong in this run: the times of error events. */
    public static errorTimes(events: readonly WorkflowRunEvent[]): number[] {
        return WorkflowRun.steps(events.filter((e) =>
            ('node' in e && e.status === 'error') || ('connection' in e && e.state?.status === 'error')));
    }

}
