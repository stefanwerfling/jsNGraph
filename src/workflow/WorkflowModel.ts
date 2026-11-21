import {
    WorkflowCanConnect,
    WorkflowConnection,
    WorkflowDocument,
    WorkflowNodeData,
    WorkflowNodeType,
    WorkflowPortDir,
    WorkflowPortRef,
    WorkflowPortSpec
} from './WorkflowTypes';

/**
 * The workflow document and its rules, without any DOM: node and connection
 * bookkeeping, port lookup through the type registry, and connection
 * validation. The editor widget drives it; tests drive it directly.
 *
 * Data the model does not understand is kept: nodes of unregistered types
 * stay (they just have no ports), and connections to ports that do not exist
 * stay in the document — they are merely not drawn.
 */
export class WorkflowModel {

    private readonly types = new Map<string, WorkflowNodeType>();
    private nodes = new Map<string, WorkflowNodeData>();
    private connections = new Map<string, WorkflowConnection>();
    private idCounter = 0;

    public constructor(
        types: WorkflowNodeType[] = [],
        doc?: WorkflowDocument,
        private canConnectHook?: WorkflowCanConnect
    ) {
        for (const t of types) {
            this.registerType(t);
        }
        if (doc !== undefined) {
            this.load(doc);
        }
    }

    public setCanConnect(hook: WorkflowCanConnect | undefined): void {
        this.canConnectHook = hook;
    }

    // ---- types ---------------------------------------------------------

    public registerType(type: WorkflowNodeType): void {
        this.types.set(type.type, type);
    }

    public getType(type: string): WorkflowNodeType | undefined {
        return this.types.get(type);
    }

    /** Ports of `nodeId` in direction `dir` (empty for unknown nodes/types). */
    public ports(nodeId: string, dir: WorkflowPortDir): WorkflowPortSpec[] {
        const node = this.nodes.get(nodeId);
        const type = node === undefined ? undefined : this.types.get(node.type);

        return (dir === 'in' ? type?.inputs : type?.outputs) ?? [];
    }

    public port(ref: WorkflowPortRef, dir: WorkflowPortDir): WorkflowPortSpec | undefined {
        return this.ports(ref.node, dir).find((p) => p.id === ref.port);
    }

    // ---- document ------------------------------------------------------

    public load(doc: WorkflowDocument): void {
        this.nodes = new Map(doc.nodes.map((n) => [n.id, structuredClone(n)]));
        this.connections = new Map(doc.connections.map((c) => [c.id, structuredClone(c)]));
    }

    /** Deep copy of the current document. */
    public toDocument(): WorkflowDocument {
        return {
            nodes: [...this.nodes.values()].map((n) => structuredClone(n)),
            connections: [...this.connections.values()].map((c) => structuredClone(c))
        };
    }

    public node(id: string): WorkflowNodeData | undefined {
        return this.nodes.get(id);
    }

    public connection(id: string): WorkflowConnection | undefined {
        return this.connections.get(id);
    }

    public allNodes(): WorkflowNodeData[] {
        return [...this.nodes.values()];
    }

    public allConnections(): WorkflowConnection[] {
        return [...this.connections.values()];
    }

    /** Connections touching a node, or one port of it when `port`/`dir` are given. */
    public connectionsOf(nodeId: string, dir?: WorkflowPortDir, port?: string): WorkflowConnection[] {
        return this.allConnections().filter((c) => {
            const atFrom = dir !== 'in' && c.from.node === nodeId && (port === undefined || c.from.port === port);
            const atTo = dir !== 'out' && c.to.node === nodeId && (port === undefined || c.to.port === port);

            return atFrom || atTo;
        });
    }

    /** A fresh id with `prefix` that is not taken by any node or connection. */
    public nextId(prefix: string): string {
        let id: string;

        do {
            this.idCounter++;
            id = prefix + this.idCounter;
        } while (this.nodes.has(id) || this.connections.has(id));

        return id;
    }

    /** Adds a copy of `data` (id generated when empty). Throws on a duplicate id. */
    public addNode(data: Omit<WorkflowNodeData, 'id'> & {id?: string}): WorkflowNodeData {
        const id = data.id !== undefined && data.id.length > 0 ? data.id : this.nextId('n');

        if (this.nodes.has(id)) {
            throw new Error(`Workflow node id '${id}' already exists`);
        }

        const node: WorkflowNodeData = {...structuredClone(data), id: id};
        this.nodes.set(id, node);

        return node;
    }

    /** Patch a node (id and type stay). Returns false for an unknown id. */
    public updateNode(id: string, patch: Partial<Omit<WorkflowNodeData, 'id'>>): boolean {
        const node = this.nodes.get(id);

        if (node === undefined) {
            return false;
        }

        Object.assign(node, structuredClone(patch), {id: id});
        return true;
    }

    public moveNode(id: string, x: number, y: number): void {
        const node = this.nodes.get(id);

        if (node !== undefined) {
            node.x = x;
            node.y = y;
        }
    }

    /** Removes nodes and every connection touching them; returns the removed connection ids. */
    public removeNodes(ids: Iterable<string>): string[] {
        const gone = new Set(ids);
        const removed: string[] = [];

        for (const c of this.allConnections()) {
            if (gone.has(c.from.node) || gone.has(c.to.node)) {
                this.connections.delete(c.id);
                removed.push(c.id);
            }
        }
        for (const id of gone) {
            this.nodes.delete(id);
        }

        return removed;
    }

    /**
     * Why `from` (an output) may not connect to `to` (an input), or null when
     * it may. `ignore` skips one existing connection — the one being rerouted.
     */
    public validate(from: WorkflowPortRef, to: WorkflowPortRef, ignore?: string): string | null {
        const out = this.port(from, 'out');
        const inp = this.port(to, 'in');

        if (out === undefined) {
            return 'unknown output port';
        }
        if (inp === undefined) {
            return 'unknown input port';
        }
        if (from.node === to.node) {
            return 'a node cannot connect to itself';
        }
        if ((out.kind ?? 'main') !== (inp.kind ?? 'main')) {
            return 'port kinds differ';
        }

        const existing = this.allConnections().filter((c) => c.id !== ignore);

        if (existing.some((c) => WorkflowModel.sameRef(c.from, from) && WorkflowModel.sameRef(c.to, to))) {
            return 'already connected';
        }
        if (out.max !== undefined && existing.filter((c) => WorkflowModel.sameRef(c.from, from)).length >= out.max) {
            return 'output port is full';
        }
        if (inp.max !== undefined && existing.filter((c) => WorkflowModel.sameRef(c.to, to)).length >= inp.max) {
            return 'input port is full';
        }

        if (this.canConnectHook !== undefined) {
            const verdict = this.canConnectHook(from, to, this.toDocument());

            if (verdict === false) {
                return 'refused';
            }
            if (typeof verdict === 'string') {
                return verdict;
            }
        }

        return null;
    }

    /** Adds a connection after validation; throws with the reason when invalid. */
    public connect(from: WorkflowPortRef, to: WorkflowPortRef, id?: string): WorkflowConnection {
        const reason = this.validate(from, to);

        if (reason !== null) {
            throw new Error(`Cannot connect ${from.node}.${from.port} → ${to.node}.${to.port}: ${reason}`);
        }

        const connId = id ?? this.nextId('c');

        if (this.connections.has(connId)) {
            throw new Error(`Workflow connection id '${connId}' already exists`);
        }

        const conn: WorkflowConnection = {id: connId, from: {...from}, to: {...to}};
        this.connections.set(connId, conn);

        return conn;
    }

    /** Moves one end of a connection after validation; throws with the reason when invalid. */
    public reconnect(id: string, from: WorkflowPortRef, to: WorkflowPortRef): void {
        const conn = this.connections.get(id);

        if (conn === undefined) {
            throw new Error(`Unknown workflow connection '${id}'`);
        }

        const reason = this.validate(from, to, id);

        if (reason !== null) {
            throw new Error(`Cannot reconnect ${id}: ${reason}`);
        }

        conn.from = {...from};
        conn.to = {...to};
    }

    public disconnect(id: string): boolean {
        return this.connections.delete(id);
    }

    /**
     * First port on `nodeId` that `anchor` could connect to: inputs when the
     * anchor is an output and vice versa. Used for dropping onto a node body.
     */
    public firstCompatiblePort(anchor: WorkflowPortRef, anchorDir: WorkflowPortDir, nodeId: string, ignore?: string): string | null {
        const dir: WorkflowPortDir = anchorDir === 'out' ? 'in' : 'out';

        for (const p of this.ports(nodeId, dir)) {
            const ref = {node: nodeId, port: p.id};
            const ok = anchorDir === 'out' ? this.validate(anchor, ref, ignore) : this.validate(ref, anchor, ignore);

            if (ok === null) {
                return p.id;
            }
        }

        return null;
    }

    public static sameRef(a: WorkflowPortRef, b: WorkflowPortRef): boolean {
        return a.node === b.node && a.port === b.port;
    }

}
