import { WorkflowModel } from './WorkflowModel';
import {
    WorkflowConnection,
    WorkflowConnectionStatus,
    WorkflowNodeStatus,
    WorkflowNodeStatusInfo,
    WorkflowRunEvent
} from './WorkflowTypes';

/** `Omit` over each member of a union (plain `Omit` would merge the members). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A node's shown run state. */
export interface WorkflowNodeStatusEntry {
    status: WorkflowNodeStatus;
    message?: string;
}

/**
 * The editor's display-only run state (internal): node and connection
 * status, the executed path and an optional recording of every status call
 * for a later replay. Plain data — the editor applies it to the DOM.
 */
export class WorkflowRunState {

    private readonly nodes = new Map<string, WorkflowNodeStatusEntry>();
    private readonly conns = new Map<string, WorkflowConnectionStatus>();
    private path: Set<string> | null = null;
    /** Connections the run actually travelled; null = derive from the path's nodes. */
    private pathConns: Set<string> | null = null;
    /** Status calls since `startRecording`, with the recording's start time. */
    private recording: {start: number; events: WorkflowRunEvent[]} | null = null;

    public setNode(id: string, status: WorkflowNodeStatus, info: WorkflowNodeStatusInfo): void {
        this.record(info.message === undefined ? {node: id, status} : {node: id, status, message: info.message});
        if (status === 'idle') {
            this.nodes.delete(id);
        } else {
            this.nodes.set(id, {status, ...info});
        }
    }

    public node(id: string): WorkflowNodeStatusEntry | undefined {
        return this.nodes.get(id);
    }

    public setConnection(id: string, status: WorkflowConnectionStatus | null): void {
        this.record({connection: id, state: status === null ? null : {...status}});
        if (status === null) {
            this.conns.delete(id);
        } else {
            this.conns.set(id, {...status});
        }
    }

    public connection(id: string): WorkflowConnectionStatus | undefined {
        return this.conns.get(id);
    }

    public setRunPath(nodeIds: Iterable<string> | null, connectionIds?: Iterable<string>): void {
        this.path = nodeIds === null ? null : new Set(nodeIds);
        this.pathConns = nodeIds === null || connectionIds === undefined ? null : new Set(connectionIds);
        this.record({runPath: this.path === null ? null : this.pathConns === null
            ? {nodes: [...this.path]} : {nodes: [...this.path], connections: [...this.pathConns]}});
    }

    public get runPath(): ReadonlySet<string> | null {
        return this.path;
    }

    /** Forget every status and the run path; recorded as one `clear` event. */
    public clear(): void {
        this.record({clear: true});
        this.nodes.clear();
        this.conns.clear();
        this.path = null;      // part of the clear: not recorded on its own
        this.pathConns = null;
    }

    /** Whether a connection is outside the current run path. */
    public dims(conn: WorkflowConnection | undefined): boolean {
        return WorkflowRunState.dimConnection(conn, this.path, this.pathConns);
    }

    /** Whether a connection is outside a run path (see `WorkflowEditor.setRunPath`). */
    public static dimConnection(
        conn: WorkflowConnection | undefined, nodes: ReadonlySet<string> | null, connections: ReadonlySet<string> | null
    ): boolean {
        if (nodes === null || conn === undefined) {
            return false;
        }
        if (connections !== null) {
            return !connections.has(conn.id);
        }

        return !(nodes.has(conn.from.node) && nodes.has(conn.to.node));
    }

    /** Whether a drawn item (a node, or a collapsed group via its members) is on the run path. */
    public ran(model: WorkflowModel, id: string): boolean {
        const runPath = this.path;

        return runPath === null || runPath.has(id) || model.members(id).some((m) => runPath.has(m));
    }

    /** Run status of a node — of a collapsed group, the most telling one among its members. */
    public statusOf(model: WorkflowModel, id: string): WorkflowNodeStatusEntry | undefined {
        if (model.group(id) === undefined) {
            return this.nodes.get(id);
        }

        const all = model.members(id).map((m) => this.nodes.get(m)).filter((s) => s !== undefined);

        for (const status of ['error', 'running', 'waiting', 'success'] as const) {
            const hit = all.find((s) => s.status === status);
            if (hit !== undefined) {
                return status === 'error' ? hit : {status};
            }
        }

        return undefined;
    }

    // ---- recording -----------------------------------------------------

    public startRecording(): void {
        this.recording = {start: WorkflowRunState.now(), events: []};
    }

    public stopRecording(): WorkflowRunEvent[] {
        const events = this.recording?.events ?? [];

        this.recording = null;
        return events;
    }

    public get recordingActive(): boolean {
        return this.recording !== null;
    }

    private record(e: DistributiveOmit<WorkflowRunEvent, 'at'>): void {
        if (this.recording !== null) {
            this.recording.events.push({...e, at: Math.round(WorkflowRunState.now() - this.recording.start)} as WorkflowRunEvent);
        }
    }

    private static now(): number {
        return typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

}
