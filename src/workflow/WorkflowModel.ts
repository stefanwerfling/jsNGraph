import {
    WorkflowCanConnect,
    WorkflowConnection,
    WorkflowDocument,
    WorkflowGroup,
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
    private groups = new Map<string, WorkflowGroup>();
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

    public allTypes(): WorkflowNodeType[] {
        return [...this.types.values()];
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
        this.groups = new Map((doc.groups ?? []).map((g) => [g.id, structuredClone(g)]));
        this.repairParents();
    }

    /** A parent that is missing, or that would make a cycle, is dropped (the group moves to the top). */
    private repairParents(): void {
        for (const g of this.groups.values()) {
            if (g.parent !== undefined && !this.groups.has(g.parent)) {
                delete g.parent;
            }
        }
        for (const g of this.groups.values()) {
            const seen = new Set([g.id]);

            for (let p = g.parent; p !== undefined; p = this.groups.get(p)?.parent) {
                if (seen.has(p)) {
                    delete g.parent;
                    break;
                }
                seen.add(p);
            }
        }
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
        if (this.groups.size > 0) {
            doc.groups = [...this.groups.values()].map((g) => structuredClone(g));
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

    /** A fresh id with `prefix` that is not taken by any node, connection, note or group. */
    public nextId(prefix: string): string {
        let id: string;

        do {
            this.idCounter++;
            id = prefix + this.idCounter;
        } while (this.nodes.has(id) || this.connections.has(id) || this.notes.has(id) || this.groups.has(id));

        return id;
    }

    /** Adds a copy of `data` (id generated when empty). Throws on a duplicate id. */
    public addNode(data: Omit<WorkflowNodeData, 'id'> & {id?: string}): WorkflowNodeData {
        const id = data.id !== undefined && data.id.length > 0 ? data.id : this.nextId('n');

        if (this.nodes.has(id) || this.notes.has(id) || this.groups.has(id)) {
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
            this.dropFromGroups(id);

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

        if (this.notes.has(id) || this.nodes.has(id) || this.groups.has(id)) {
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

    // ---- groups --------------------------------------------------------

    public group(id: string): WorkflowGroup | undefined {
        return this.groups.get(id);
    }

    public allGroups(): WorkflowGroup[] {
        return [...this.groups.values()];
    }

    /** The group a node directly belongs to, if any (the innermost one). */
    public groupOf(nodeId: string): WorkflowGroup | undefined {
        return this.allGroups().find((g) => g.nodes.includes(nodeId));
    }

    /** The groups directly inside a group. */
    public children(groupId: string): WorkflowGroup[] {
        return this.allGroups().filter((g) => g.parent === groupId);
    }

    /** The groups around a node or group, innermost first (a group does not count itself). */
    public ancestors(id: string): string[] {
        const out: string[] = [];
        let next = this.groups.has(id) ? this.groups.get(id)!.parent : this.groupOf(id)?.id;

        while (next !== undefined && !out.includes(next)) {
            out.push(next);
            next = this.groups.get(next)?.parent;
        }

        return out;
    }

    /** Nesting depth of a group: 0 at the top level. */
    public depth(groupId: string): number {
        return this.ancestors(groupId).length;
    }

    /**
     * Existing member nodes of a group, child groups' nodes included (a loaded
     * document may name missing ones).
     */
    public members(groupId: string): string[] {
        const out: string[] = [];
        const visit = (id: string, seen: Set<string>): void => {
            if (seen.has(id)) {
                return;
            }
            seen.add(id);
            out.push(...(this.groups.get(id)?.nodes ?? []).filter((n) => this.nodes.has(n)));
            this.children(id).forEach((c) => visit(c.id, seen));
        };

        visit(groupId, new Set());
        return out;
    }

    /** A group and every group nested in it, outermost first. */
    public descendantGroups(groupId: string): string[] {
        const out: string[] = [];
        const queue = [groupId];

        while (queue.length > 0) {
            const id = queue.shift()!;

            if (this.groups.has(id) && !out.includes(id)) {
                out.push(id);
                queue.push(...this.children(id).map((c) => c.id));
            }
        }

        return out;
    }

    /**
     * The innermost group that contains all of `ids` (nodes and groups) without
     * being one of them — where a new group around them belongs. Undefined at
     * the top level.
     */
    public commonParent(ids: Iterable<string>): string | undefined {
        let common: string[] | null = null;

        for (const id of ids) {
            const chain = this.ancestors(id);
            common = common === null ? chain : common.filter((g) => chain.includes(g));
        }

        return common?.[0];
    }

    /**
     * Group existing nodes and groups (id generated when empty). Nodes leave
     * the group they were in, listed `groups` move into the new one (a group
     * left without content is removed), and the new group sits in `parent`.
     * Throws on a duplicate id, when there is nothing to group, or when
     * `parent` would make a cycle.
     */
    public addGroup(data: Partial<Omit<WorkflowGroup, 'nodes'>> & {nodes: string[]; groups?: string[]}): WorkflowGroup {
        const id = data.id !== undefined && data.id.length > 0 ? data.id : this.nextId('g');
        const nodes = [...new Set(data.nodes)].filter((n) => this.nodes.has(n));
        const children = [...new Set(data.groups ?? [])].filter((g) => this.groups.has(g));
        const parent = data.parent !== undefined && this.groups.has(data.parent) ? data.parent : undefined;

        if (this.groups.has(id) || this.nodes.has(id) || this.notes.has(id)) {
            throw new Error(`Workflow group id '${id}' already exists`);
        }
        if (nodes.length === 0 && !children.some((c) => this.members(c).length > 0)) {
            throw new Error('A workflow group needs at least one node');
        }
        if (parent !== undefined && children.some((c) => c === parent || this.ancestors(parent).includes(c))) {
            throw new Error('A workflow group cannot sit inside a group it contains');
        }

        const group: WorkflowGroup = {...structuredClone(data), id, nodes};
        delete (group as {groups?: string[]}).groups;
        if (parent === undefined) {
            delete group.parent;
        } else {
            group.parent = parent;
        }

        this.groups.set(id, group);   // first, so the old groups pruned below cannot take the parent with them
        for (const n of nodes) {
            this.dropFromGroups(n, id);
        }
        for (const c of children) {
            const old = this.groups.get(c)!.parent;
            this.groups.get(c)!.parent = id;
            this.prune(old);
        }

        return group;
    }

    /** Patch label, colour or collapsed state; a blank label goes back to the default. */
    public updateGroup(id: string, patch: Partial<Omit<WorkflowGroup, 'id' | 'nodes' | 'parent'>>): boolean {
        const group = this.groups.get(id);

        if (group === undefined) {
            return false;
        }

        const parent = group.parent;
        Object.assign(group, structuredClone(patch), {id, nodes: group.nodes});
        if (parent === undefined) {
            delete group.parent;
        } else {
            group.parent = parent;
        }
        if (group.label !== undefined && group.label.trim() === '') {
            delete group.label;
        } else if (group.label !== undefined) {
            group.label = group.label.trim();
        }
        if (group.collapsed === false) {
            delete group.collapsed;
        }

        return true;
    }

    /**
     * Dissolve groups: their nodes and child groups move up into the parent
     * (or to the top level). Returns the ids that existed.
     */
    public removeGroups(ids: Iterable<string>): string[] {
        const removed: string[] = [];

        for (const id of new Set(ids)) {
            const g = this.groups.get(id);

            if (g === undefined) {
                continue;
            }

            const parent = g.parent === undefined ? undefined : this.groups.get(g.parent);

            parent?.nodes.push(...g.nodes.filter((n) => !parent.nodes.includes(n)));
            for (const c of this.children(id)) {
                if (parent === undefined) {
                    delete c.parent;
                } else {
                    c.parent = parent.id;
                }
            }
            this.groups.delete(id);
            removed.push(id);
        }

        return removed;
    }

    /** `ids` with every group id replaced by its member nodes. */
    public expandGroups(ids: Iterable<string>): string[] {
        const out = new Set<string>();

        for (const id of ids) {
            if (this.groups.has(id)) {
                this.members(id).forEach((m) => out.add(m));
            } else {
                out.add(id);
            }
        }

        return [...out];
    }

    /** Take a node out of its group(s) (except `keep`); groups left without content go. */
    private dropFromGroups(nodeId: string, keep?: string): void {
        for (const g of this.allGroups()) {
            if (g.id !== keep && g.nodes.includes(nodeId)) {
                g.nodes = g.nodes.filter((n) => n !== nodeId);
                this.prune(g.id);
            }
        }
    }

    /** Remove a group that has no member nodes left, then check its parent the same way. */
    private prune(groupId: string | undefined): void {
        while (groupId !== undefined) {
            const g = this.groups.get(groupId);

            if (g === undefined || this.members(groupId).length > 0) {
                return;
            }
            for (const c of this.children(groupId)) {   // empty children go along
                this.groups.delete(c.id);
            }
            this.groups.delete(groupId);
            groupId = g.parent;
        }
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

    /**
     * The nodes, notes and groups `ids` (a group brings its members) and the
     * connections running between those nodes, deep-copied.
     */
    public fragment(ids: Iterable<string>): WorkflowDocument {
        ids = [...ids];
        const groupIds = [...new Set([...new Set(ids)].filter((id) => this.groups.has(id)).flatMap((id) => this.descendantGroups(id)))];
        const set = new Set(this.expandGroups(ids).filter((id) => this.nodes.has(id)));

        const frag: WorkflowDocument = {
            nodes: [...set].map((id) => structuredClone(this.nodes.get(id)!)),
            connections: this.connectionsWithin(set).map((c) => structuredClone(c))
        };
        const notes = [...new Set(ids)].filter((id) => this.notes.has(id)).map((id) => structuredClone(this.notes.get(id)!));

        if (notes.length > 0) {
            frag.notes = notes;
        }
        if (groupIds.length > 0) {
            frag.groups = groupIds.map((id) => {
                const g = structuredClone(this.groups.get(id)!);
                g.nodes = g.nodes.filter((n) => set.has(n));
                if (g.parent !== undefined && !groupIds.includes(g.parent)) {
                    delete g.parent;   // copied without its parent: it lands at the top level
                }
                return g;
            });
        }

        return frag;
    }

    /**
     * Add a fragment under fresh ids, shifted by (dx, dy). Connections are
     * kept when both ends came along and the rules still allow them.
     */
    public paste(
        fragment: WorkflowDocument, dx: number, dy: number
    ): {nodes: string[]; connections: string[]; notes: string[]; groups: string[]} {
        const idMap = new Map<string, string>();
        const nodes: string[] = [];
        const connections: string[] = [];
        const notes: string[] = [];
        const groups: string[] = [];

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

        // Innermost groups first, so a parent can take its pasted children along.
        const frag = fragment.groups ?? [];
        const fragIds = new Set(frag.map((g) => g.id));
        const depth = (g: WorkflowGroup): number => {
            let d = 0;
            for (let p = g.parent; p !== undefined && fragIds.has(p) && d < frag.length; p = frag.find((x) => x.id === p)?.parent) {
                d++;
            }
            return d;
        };

        for (const g of [...frag].sort((a, b) => depth(b) - depth(a))) {
            const members = g.nodes.map((n) => idMap.get(n)).filter((n): n is string => n !== undefined);
            const kids = frag.filter((c) => c.parent === g.id).map((c) => idMap.get(c.id)).filter((c): c is string => c !== undefined);
            const {parent: _parent, ...rest} = g;

            if (members.length > 0 || kids.some((k) => this.members(k).length > 0)) {
                const added = this.addGroup({...rest, id: this.nextId('g'), nodes: members, groups: kids});
                idMap.set(g.id, added.id);
                groups.push(added.id);
            }
        }

        return {nodes, connections, notes, groups};
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
