import {
    WorkflowCanConnect,
    WorkflowConnection,
    WorkflowDocument,
    WorkflowNodeData,
    WorkflowNodeType,
    WorkflowNote,
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
    private notes = new Map<string, WorkflowNote>();
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
        this.notes = new Map((doc.notes ?? []).map((n) => [n.id, structuredClone(n)]));
    }

    /** Deep copy of the current document. */
    public toDocument(): WorkflowDocument {
        const doc: WorkflowDocument = {
            nodes: [...this.nodes.values()].map((n) => structuredClone(n)),
            connections: [...this.connections.values()].map((c) => structuredClone(c))
        };

        if (this.notes.size > 0) {
            doc.notes = [...this.notes.values()].map((n) => structuredClone(n));
        }

        return doc;
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
        } while (this.nodes.has(id) || this.connections.has(id) || this.notes.has(id));

        return id;
    }

    /** Adds a copy of `data` (id generated when empty). Throws on a duplicate id. */
    public addNode(data: Omit<WorkflowNodeData, 'id'> & {id?: string}): WorkflowNodeData {
        const id = data.id !== undefined && data.id.length > 0 ? data.id : this.nextId('n');

        if (this.nodes.has(id) || this.notes.has(id)) {
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

    /**
     * Removes nodes and every connection touching them. With `reconnect`,
     * a removed node that sat in a chain is bridged: when it had exactly one
     * incoming connection, its predecessor is wired to each of its successors
     * (where the rules allow). Nodes are removed one by one, so deleting a
     * run of chained nodes bridges across the whole run.
     */
    public removeNodes(ids: Iterable<string>, reconnect = false): {removed: string[]; added: string[]} {
        const removed: string[] = [];
        const added: string[] = [];

        for (const id of new Set(ids)) {
            if (!this.nodes.has(id)) {
                continue;
            }

            const incoming = this.allConnections().filter((c) => c.to.node === id && c.from.node !== id);
            const outgoing = this.allConnections().filter((c) => c.from.node === id && c.to.node !== id);

            for (const c of this.connectionsOf(id)) {
                this.connections.delete(c.id);
                const at = added.indexOf(c.id);

                if (at >= 0) {
                    added.splice(at, 1);    // a bridge made earlier in this call is gone again
                } else {
                    removed.push(c.id);
                }
            }
            this.nodes.delete(id);

            const source = incoming[0];

            if (!reconnect || incoming.length !== 1 || source === undefined) {
                continue;
            }

            for (const out of outgoing) {
                if (this.validate(source.from, out.to) === null) {
                    added.push(this.connect(source.from, out.to).id);
                }
            }
        }

        return {removed, added};
    }

    // ---- notes ---------------------------------------------------------

    public note(id: string): WorkflowNote | undefined {
        return this.notes.get(id);
    }

    public allNotes(): WorkflowNote[] {
        return [...this.notes.values()];
    }

    /** Adds a copy of `data` (id generated when empty, default size 240×160). Throws on a duplicate id. */
    public addNote(data: Partial<WorkflowNote> & {x: number; y: number}): WorkflowNote {
        const id = data.id !== undefined && data.id.length > 0 ? data.id : this.nextId('note');

        if (this.notes.has(id) || this.nodes.has(id)) {
            throw new Error(`Workflow note id '${id}' already exists`);
        }

        const note: WorkflowNote = {w: 240, h: 160, text: '', ...structuredClone(data), id: id};
        this.notes.set(id, note);

        return note;
    }

    public updateNote(id: string, patch: Partial<Omit<WorkflowNote, 'id'>>): boolean {
        const note = this.notes.get(id);

        if (note === undefined) {
            return false;
        }

        Object.assign(note, structuredClone(patch), {id: id});
        return true;
    }

    /** Removes notes; returns the ids that existed. */
    public removeNotes(ids: Iterable<string>): string[] {
        return [...new Set(ids)].filter((id) => this.notes.delete(id));
    }

    /** Toggle or set `disabled` on nodes; returns the ids that changed. */
    public setDisabled(ids: Iterable<string>, disabled: boolean): string[] {
        const changed: string[] = [];

        for (const id of ids) {
            const node = this.nodes.get(id);

            if (node !== undefined && (node.disabled === true) !== disabled) {
                node.disabled = disabled;
                changed.push(id);
            }
        }

        return changed;
    }

    /** Connections whose both ends are among `nodeIds` (e.g. the edges of an executed path). */
    public connectionsWithin(nodeIds: Iterable<string>): WorkflowConnection[] {
        const set = new Set(nodeIds);

        return this.allConnections().filter((c) => set.has(c.from.node) && set.has(c.to.node));
    }

    /** The nodes and notes `ids` and the connections running between those nodes, deep-copied. */
    public fragment(ids: Iterable<string>): WorkflowDocument {
        ids = [...ids];
        const set = new Set([...ids].filter((id) => this.nodes.has(id)));

        const frag: WorkflowDocument = {
            nodes: [...set].map((id) => structuredClone(this.nodes.get(id)!)),
            connections: this.connectionsWithin(set).map((c) => structuredClone(c))
        };
        const notes = [...new Set(ids)].filter((id) => this.notes.has(id)).map((id) => structuredClone(this.notes.get(id)!));

        if (notes.length > 0) {
            frag.notes = notes;
        }

        return frag;
    }

    /**
     * Add a fragment under fresh ids, shifted by (dx, dy). Connections are
     * kept when both ends came along and the rules still allow them.
     */
    public paste(fragment: WorkflowDocument, dx: number, dy: number): {nodes: string[]; connections: string[]; notes: string[]} {
        const idMap = new Map<string, string>();
        const nodes: string[] = [];
        const connections: string[] = [];
        const notes: string[] = [];

        for (const n of fragment.notes ?? []) {
            notes.push(this.addNote({...n, id: this.nextId('note'), x: n.x + dx, y: n.y + dy}).id);
        }

        for (const n of fragment.nodes) {
            const node = this.addNode({...n, id: this.nextId('n'), x: n.x + dx, y: n.y + dy});
            idMap.set(n.id, node.id);
            nodes.push(node.id);
        }

        for (const c of fragment.connections) {
            const from = idMap.get(c.from.node);
            const to = idMap.get(c.to.node);

            if (from === undefined || to === undefined) {
                continue;
            }

            const a = {node: from, port: c.from.port};
            const b = {node: to, port: c.to.port};

            if (this.validate(a, b) === null) {
                const conn = this.connect(a, b);
                if (c.label !== undefined) {
                    this.setConnectionLabel(conn.id, c.label);
                }
                connections.push(conn.id);
            }
        }

        return {nodes, connections, notes};
    }

    /**
     * Whether a node of `type` can sit inside connection `id`: it has an
     * input of the source port's kind and an output of the target port's kind.
     */
    public canInsert(type: string, id: string): boolean {
        const conn = this.connections.get(id);
        const t = this.types.get(type);
        const out = conn === undefined ? undefined : this.port(conn.from, 'out');
        const inp = conn === undefined ? undefined : this.port(conn.to, 'in');

        if (t === undefined || out === undefined || inp === undefined) {
            return false;
        }

        return (t.inputs ?? []).some((p) => (p.kind ?? 'main') === (out.kind ?? 'main'))
            && (t.outputs ?? []).some((p) => (p.kind ?? 'main') === (inp.kind ?? 'main'));
    }

    /**
     * Node types that have at least one port able to meet `anchor` — what a
     * node picker should offer after "+" on a port. Only direction and kind
     * are checked; capacity is the new node's own business.
     */
    public typesFor(anchor: WorkflowPortRef, anchorDir: WorkflowPortDir): WorkflowNodeType[] {
        const own = this.port(anchor, anchorDir);

        if (own === undefined) {
            return [];
        }

        const kind = own.kind ?? 'main';

        return [...this.types.values()].filter((t) => {
            const ports = (anchorDir === 'out' ? t.inputs : t.outputs) ?? [];

            return ports.some((p) => (p.kind ?? 'main') === kind);
        });
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

    /**
     * Set or clear (null / blank) a connection's label; the text is trimmed.
     * False when the connection is unknown or nothing changed.
     */
    public setConnectionLabel(id: string, label: string | null): boolean {
        const conn = this.connections.get(id);
        const text = label?.trim() ?? '';

        if (conn === undefined || (conn.label ?? '') === text) {
            return false;
        }
        if (text === '') {
            delete conn.label;
        } else {
            conn.label = text;
        }

        return true;
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
