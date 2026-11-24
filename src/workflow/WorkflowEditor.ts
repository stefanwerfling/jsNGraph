import { CameraState } from '../view/Camera';
import { EventEmitter } from '../util/EventEmitter';
import { RectBoardGeometry, RectPoint } from '../rect/RectBoardGeometry';
import { RectHistory } from '../rect/RectHistory';
import { WorkflowArrange } from './WorkflowArrange';
import { WorkflowConnections } from './WorkflowConnections';
import { WorkflowGeometry } from './WorkflowGeometry';
import { WorkflowGestures } from './WorkflowGestures';
import { WorkflowGroups } from './WorkflowGroups';
import { WorkflowInlineEdit } from './WorkflowInlineEdit';
import { WorkflowKeyboard } from './WorkflowKeyboard';
import { WorkflowLayoutOptions } from './WorkflowLayout';
import { WorkflowMinimap } from './WorkflowMinimap';
import { WorkflowModel } from './WorkflowModel';
import { WorkflowPalette } from './WorkflowPalette';
import { WorkflowRenderer } from './WorkflowRenderer';
import { WorkflowRunState } from './WorkflowRunState';
import { WorkflowStyles, WorkflowStyleVar } from './WorkflowStyles';
import { WorkflowViewport } from './WorkflowViewport';
import {
    WorkflowChange,
    WorkflowChangeKind,
    WorkflowConnection,
    WorkflowConnectionStatus,
    WorkflowDocument,
    WorkflowEditorEvents,
    WorkflowEditorOptions,
    WorkflowFragment,
    WorkflowGroup,
    WorkflowNodeContext,
    WorkflowNodeData,
    WorkflowNodeStatus,
    WorkflowNodeStatusInfo,
    WorkflowNodeType,
    WorkflowNote,
    WorkflowPortDir,
    WorkflowPortRef,
    WorkflowRunEvent,
    WorkflowSelection
} from './WorkflowTypes';

/** Node data as a palette or picker hands it in: everything but id/position is optional. */
export type WorkflowNodeInput = Omit<WorkflowNodeData, 'id' | 'x' | 'y'> & {id?: string; x?: number; y?: number};

/**
 * A node-based workflow editor: nodes with typed input/output ports,
 * connections between ports, pan/zoom, drag with grid snap, selection,
 * connect/reroute/delete and undo — or, with `readOnly`, a viewer of the
 * same picture (pan, zoom, select and click events only).
 *
 * The widget owns the document. The host describes node *types* (label,
 * icon, colour, ports), reads the document with {@link getDocument} and
 * hears about every finished change through the `change` event. What a node
 * does is entirely the host's business.
 *
 * Rendering is DOM (one element per node, so text is crisp and a type may
 * render its own body) plus one SVG layer for the connections, all inside a
 * stage element transformed by the shared `Camera`.
 *
 * This class is the façade: it owns the model, undo history, selection and
 * events; drawing, input, inline editing, layout animation and the camera
 * are internal collaborators (`WorkflowRenderer`, `WorkflowConnections`,
 * `WorkflowGestures`, `WorkflowKeyboard`, `WorkflowInlineEdit`,
 * `WorkflowPalette`, `WorkflowArrange`, `WorkflowViewport`, `WorkflowRunState`).
 */
export class WorkflowEditor {

    private static instances = 0;

    private readonly root: HTMLDivElement;
    private readonly model: WorkflowModel;
    private readonly events = new EventEmitter<WorkflowEditorEvents>();
    private readonly history: RectHistory<WorkflowDocument>;
    private readonly grid: number;
    private readonly fitOnLoad: boolean;
    private readonly reconnectOnDelete: boolean;
    private readonly run = new WorkflowRunState();
    private readonly styleVars = new Map<string, string>();
    private readonly scene: WorkflowRenderer;
    private readonly connections: WorkflowConnections;
    private readonly inline: WorkflowInlineEdit;
    private readonly viewport: WorkflowViewport;
    private readonly arrange: WorkflowArrange;
    private readonly gestures: WorkflowGestures;
    private readonly keyboard: WorkflowKeyboard;
    private readonly palette: WorkflowPalette;
    private minimap: WorkflowMinimap | null = null;
    private selected = new Set<string>();
    private selectedConn: string | null = null;
    private readOnlyFlag: boolean;

    public constructor(container: HTMLElement, options: WorkflowEditorOptions = {}) {
        WorkflowStyles.ensure();

        this.grid = options.grid ?? 20;
        this.fitOnLoad = options.fitOnLoad ?? true;
        this.reconnectOnDelete = options.reconnectOnDelete ?? true;
        this.readOnlyFlag = options.readOnly ?? false;
        this.model = new WorkflowModel(options.types ?? [], undefined, options.canConnect);

        const arrowId = `wf-arrow-${++WorkflowEditor.instances}`;
        const model = this.model;
        const run = this.run;
        const changed = (): void => this.minimap?.schedule();
        const commit = this.commit.bind(this);

        this.root = document.createElement('div');
        this.root.className = 'wf-root';
        this.root.tabIndex = 0;
        this.root.dataset.wfTheme = options.theme ?? 'dark';
        this.root.classList.toggle('wf-editable', !this.readOnlyFlag);
        this.root.classList.toggle('wf-color-ports', options.colorPorts === true);

        this.scene = new WorkflowRenderer(this.root, {
            model,
            run,
            groupBypass: options.groupBypass ?? false,
            isSelected: (id) => this.selected.has(id),
            editingGroup: () => this.inline.editingGroup,
            nodeContext: (id) => this.nodeContext(id),
            changed
        }, arrowId);
        container.appendChild(this.root);

        this.connections = new WorkflowConnections({
            model,
            run,
            selectedConnection: () => this.selectedConn,
            editingConnection: () => this.inline.editingConnection,
            dropConnectionEdit: () => this.inline.dropConnection(),
            toolsHidden: () => this.readOnlyFlag || this.gestures.active,
            changed
        }, this.scene, arrowId);

        this.inline = new WorkflowInlineEdit({
            model,
            root: this.root,
            readOnly: () => this.readOnlyFlag,
            setConnectionLabel: (id, label) => this.setConnectionLabel(id, label),
            updateGroup: (id, patch) => this.updateGroup(id, patch),
            commitNote: (id) => this.commit('updateNote', [], [], [id])
        }, this.scene, this.connections);

        this.viewport = new WorkflowViewport({
            root: this.root,
            stage: this.scene.stage,
            grid: this.grid,
            fitOnLoad: this.fitOnLoad,
            bounds: () => RectBoardGeometry.bounds(
                [...this.scene.nodeViews.values(), ...this.scene.noteViews.values(), ...this.scene.groupViews.values()].map((v) => v.rect)
            ),
            changed
        }, options.minScale ?? 0.2, options.maxScale ?? 2.5);

        this.arrange = new WorkflowArrange({
            model,
            grid: this.grid,
            renderConnections: () => this.connections.render(),
            commit,
            tidied: (animate) => {
                this.viewport.resetMoved();
                this.fit(animate);
            }
        }, this.scene);

        this.gestures = new WorkflowGestures({
            model,
            root: this.root,
            grid: this.grid,
            events: this.events,
            editConnectionLabels: options.editConnectionLabels ?? true,
            busy: () => this.arrange.running,
            selection: () => this.selected,
            setSelection: (items, conn) => this.setSelection(items, conn),
            commit
        }, this, this.scene, this.connections, this.viewport);

        this.keyboard = new WorkflowKeyboard({
            root: this.root,
            selection: () => this.selected,
            selectedConnection: () => this.selectedConn
        }, this, this.scene, this.gestures, this.viewport);

        this.palette = new WorkflowPalette({
            model,
            root: this.root,
            grid: this.grid,
            styleVars: this.styleVars
        }, this, this.scene, this.connections, this.arrange, this.viewport);

        if (options.minimap === true) {
            this.setMinimap(true);
        }

        const doc = options.document ?? {nodes: [], connections: []};
        this.model.load(doc);
        this.history = new RectHistory<WorkflowDocument>(this.model.toDocument(), options.historySize ?? 100);
        this.renderAll();
        this.viewport.apply();
        if (this.fitOnLoad) {
            this.fit(false);
        }
    }

    // ---- document ------------------------------------------------------

    /** Replace the whole document; clears undo history and selection. */
    public setDocument(doc: WorkflowDocument, fit = this.fitOnLoad): void {
        this.arrange.drop();
        this.gestures.cancel();
        this.inline.finishConnection(false);
        this.inline.finishNote(false);
        this.inline.finishGroup(false);
        this.model.load(doc);
        this.history.reset(this.model.toDocument());
        this.selected.clear();
        this.selectedConn = null;
        this.renderAll();
        if (fit) {
            this.viewport.resetMoved();
            this.fit(false);
        }
        this.emitSelection();
        this.events.emit('change', {kind: 'load', nodes: [], connections: []});
    }

    /** Deep copy of the current document. */
    public getDocument(): WorkflowDocument {
        return this.model.toDocument();
    }

    public registerType(type: WorkflowNodeType): void {
        this.model.registerType(type);
        this.renderAll();
    }

    /** A copy of a registered node type. */
    public getType(type: string): WorkflowNodeType | undefined {
        const t = this.model.getType(type);

        return t === undefined ? undefined : WorkflowModel.copyType(t);
    }

    public getNode(id: string): WorkflowNodeData | undefined {
        const node = this.model.node(id);

        return node === undefined ? undefined : structuredClone(node);
    }

    /** Add a node (id generated when omitted). Undoable; emits `change`. */
    public addNode(data: Omit<WorkflowNodeData, 'id'> & {id?: string}): WorkflowNodeData {
        const node = this.model.addNode(data);
        this.scene.renderNode(node);
        this.commit('addNode', [node.id], []);

        return structuredClone(node);
    }

    /**
     * Patch label/position/disabled/meta …; the node re-renders. With
     * `render: false` the element stays as it is (a control inside the body
     * already shows the new value); with `commit: false` there is no undo
     * step or `change` event yet — for live slider moves, followed by one
     * committing call when the gesture ends.
     */
    public updateNode(id: string, patch: Partial<Omit<WorkflowNodeData, 'id'>>,
        options: {render?: boolean; commit?: boolean} = {}): boolean {
        if (!this.model.updateNode(id, patch)) {
            return false;
        }

        if (options.render !== false) {
            this.scene.renderNode(this.model.node(id)!);
            this.connections.render();
        }
        if (patch.disabled !== undefined) {
            this.scene.refreshGroupBypass();
        }
        if (options.commit !== false) {
            this.commit('updateNode', [id], []);
        }

        return true;
    }

    /**
     * Collapse nodes to their header (`type.collapsedHeight`) or expand them;
     * without `collapsed`, toggle as a group. One undo step.
     */
    public setCollapsed(ids: Iterable<string>, collapsed?: boolean): void {
        const list = [...ids].filter((id) => this.model.node(id) !== undefined);
        const value = collapsed ?? !list.every((id) => this.model.node(id)!.collapsed === true);
        const changed = this.model.setCollapsed(list, value);

        if (changed.length === 0) {
            return;
        }

        this.renderNodes(changed);
        this.commit('collapse', changed, []);
    }

    /**
     * Remove nodes and their connections. With `reconnect` (default: the
     * `reconnectOnDelete` option) a node in a chain is bridged — its
     * predecessor gets wired to its successors.
     */
    public removeNodes(ids: Iterable<string>, reconnect = this.reconnectOnDelete): void {
        this.arrange.settle();
        const list = [...ids].filter((id) => this.model.node(id) !== undefined);

        if (list.length === 0) {
            return;
        }

        const {removed, added} = this.model.removeNodes(list, reconnect);
        this.afterRemove(list);
        this.commit('removeNodes', list, [...removed, ...added]);
    }

    /** Set (or with `undefined`, toggle as a group) the disabled flag of nodes. */
    public setDisabled(ids: Iterable<string>, disabled?: boolean): void {
        const list = this.model.expandGroups(ids).filter((id) => this.model.node(id) !== undefined);
        const value = disabled ?? !list.every((id) => this.model.node(id)!.disabled === true);
        const changed = this.model.setDisabled(list, value);

        if (changed.length === 0) {
            return;
        }

        this.renderNodes(changed);
        this.scene.refreshGroupBypass();
        this.commit('disable', changed, []);
    }

    /**
     * Add a node attached to a port — the answer to an `addRequest`. Unless
     * `data` has x/y, the node is placed beside the port, clear of other
     * nodes; it is wired through its first compatible port.
     */
    public addNodeFrom(
        port: WorkflowPortRef,
        dir: WorkflowPortDir,
        data: WorkflowNodeInput
    ): WorkflowNodeData | null {
        const place = this.scene.nodeViews.get(port.node)?.ports.get(`${dir}:${port.port}`)?.place;

        if (place === undefined) {
            return null;
        }

        const size = WorkflowGeometry.nodeSize(this.model.getType(data.type));
        const obstacles = [...this.scene.nodeViews.values()].map((v) => v.rect);
        const pos = data.x !== undefined && data.y !== undefined
            ? {x: data.x, y: data.y}
            : WorkflowGeometry.placeNear(place, size, obstacles, this.grid);
        const node = this.model.addNode({...data, x: pos.x, y: pos.y});
        const conns: string[] = [];
        const other = this.model.firstCompatiblePort(port, dir, node.id);

        if (other !== null) {
            const ref = {node: node.id, port: other};
            conns.push((dir === 'out' ? this.model.connect(port, ref) : this.model.connect(ref, port)).id);
        }

        this.scene.renderNode(node);
        this.connections.render();
        this.commit('addNode', [node.id, port.node], conns);

        return structuredClone(node);
    }

    /**
     * Put a node into a connection — the answer to an `insertRequest`. Unless
     * `data` has x/y, the node goes right of the source, level with the
     * source port; when it would overlap something, every node right of the
     * source moves over by the new node's width to make room.
     */
    public insertNode(
        connectionId: string,
        data: WorkflowNodeInput
    ): WorkflowNodeData | null {
        const conn = this.model.connection(connectionId);
        const source = conn === undefined ? undefined : this.scene.nodeViews.get(conn.from.node);
        const port = source?.ports.get(`out:${conn!.from.port}`)?.place;

        if (conn === undefined || source === undefined || port === undefined || !this.model.canInsert(data.type, connectionId)) {
            return null;
        }

        const size = WorkflowGeometry.nodeSize(this.model.getType(data.type));
        const sourceRight = source.rect.x + source.rect.w;
        const x = data.x ?? RectBoardGeometry.snap(sourceRight + 80, this.grid);
        const y = data.y ?? RectBoardGeometry.snap(port.y - size.h / 2, this.grid);
        const moved = this.arrange.makeRoomRight({x: x - 20, y: y - 20, w: size.w + 40, h: size.h + 40},
            conn.from.node, sourceRight, size.w);

        this.model.disconnect(connectionId);

        const node = this.model.addNode({...data, x, y});
        const conns = [connectionId];
        const inPort = this.model.firstCompatiblePort(conn.from, 'out', node.id);
        const outPort = this.model.firstCompatiblePort(conn.to, 'in', node.id);

        if (inPort !== null) {
            const upstream = this.model.connect(conn.from, {node: node.id, port: inPort});
            if (conn.label !== undefined) {
                this.model.setConnectionLabel(upstream.id, conn.label);   // the label stays with the branch it named
            }
            conns.push(upstream.id);
        }
        if (outPort !== null) {
            conns.push(this.model.connect({node: node.id, port: outPort}, conn.to).id);
        }

        // A wire inside a group: the new node joins that group.
        const group = this.model.groupOf(conn.from.node);
        const joins = group !== undefined && group === this.model.groupOf(conn.to.node) && this.model.addToGroup(group.id, node.id);

        if (this.selectedConn === connectionId) {
            this.selectedConn = null;
        }
        if (joins) {
            this.scene.renderGroups();     // the frame's member count changes
        } else {
            this.scene.renderNode(node);
        }
        this.connections.render();
        this.setSelection(new Set([node.id]), null);
        this.commit('insertNode', [node.id, conn.from.node, conn.to.node, ...moved], conns, [], joins ? [group!.id] : []);

        return structuredClone(node);
    }

    /** Node types a picker should offer for "+" on this port (direction and kind match). */
    public typesFor(port: WorkflowPortRef, dir: WorkflowPortDir): WorkflowNodeType[] {
        return this.model.typesFor(port, dir);
    }

    /** The selected nodes and notes and the connections between those nodes; null when nothing is selected. */
    public copySelection(): WorkflowFragment | null {
        if (this.selected.size === 0) {
            return null;
        }

        return {format: 'jsngraph-workflow', version: 1, ...this.model.fragment(this.selected)};
    }

    /**
     * Add a copied fragment under fresh ids and select it. `at` puts the
     * fragment's top-left there (world coordinates); without it the copy is
     * offset from the original until it no longer sits on top of it.
     */
    public paste(fragment: WorkflowDocument, at?: RectPoint): string[] {
        const offset = this.readOnlyFlag ? null : this.arrange.pasteOffset(fragment, at);

        if (offset === null) {
            return [];
        }

        const added = this.model.paste(fragment, offset.x, offset.y);

        for (const id of added.notes) {
            this.scene.renderNote(this.model.note(id)!);
        }
        this.scene.renderGroups();
        this.connections.render();
        this.select([...added.nodes, ...added.notes, ...added.groups]);
        this.commit('paste', added.nodes, added.connections, added.notes, added.groups);

        return [...added.nodes, ...added.notes, ...added.groups];
    }

    /** Copy the selection and paste it right next to itself. */
    public duplicateSelection(): string[] {
        const fragment = this.copySelection();

        return fragment === null ? [] : this.paste(fragment);
    }

    /**
     * Remove nodes, notes and groups (a group goes with its nodes) in one undo
     * step; nodes re-link chains like `removeNodes`.
     */
    public remove(ids: Iterable<string>, reconnect = this.reconnectOnDelete): void {
        this.arrange.settle();
        const list = this.model.expandGroups(ids);
        const nodes = list.filter((id) => this.model.node(id) !== undefined);
        const notes = list.filter((id) => this.model.note(id) !== undefined);

        if (nodes.length === 0 && notes.length === 0) {
            return;
        }

        const groupsBefore = this.model.allGroups().map((g) => g.id);
        const {removed, added} = this.model.removeNodes(nodes, reconnect);
        this.model.removeNotes(notes);
        const groups = groupsBefore.filter((id) => this.model.group(id) === undefined);
        this.afterRemove(nodes, notes);
        this.commit(notes.length > 0 || groups.length > 0 ? 'remove' : 'removeNodes', nodes, [...removed, ...added], notes, groups);
    }

    // ---- notes ---------------------------------------------------------

    public getNote(id: string): WorkflowNote | undefined {
        const note = this.model.note(id);

        return note === undefined ? undefined : structuredClone(note);
    }

    /** Add a sticky note (default 240×160, empty). */
    public addNote(data: Partial<WorkflowNote> & {x: number; y: number}): WorkflowNote {
        const note = this.model.addNote(data);
        this.scene.renderNote(note);
        this.commit('addNote', [], [], [note.id]);

        return structuredClone(note);
    }

    /** Patch text, colour, position or size of a note. */
    public updateNote(id: string, patch: Partial<Omit<WorkflowNote, 'id'>>): boolean {
        if (!this.model.updateNote(id, patch)) {
            return false;
        }

        this.scene.renderNote(this.model.note(id)!);
        this.commit('updateNote', [], [], [id]);

        return true;
    }

    /** Open a note's text for editing (what a double-click does). */
    public editNote(id: string): void {
        this.inline.editNote(id);
    }

    // ---- groups (sub-workflows) ----------------------------------------

    public getGroup(id: string): WorkflowGroup | undefined {
        const group = this.model.group(id);

        return group === undefined ? undefined : structuredClone(group);
    }

    /** Id of the group a node belongs to, or null. */
    public groupOf(nodeId: string): string | null {
        return this.model.groupOf(nodeId)?.id ?? null;
    }

    /**
     * Frame nodes and groups as a sub-workflow (default: the selection). A
     * selected group goes in whole and becomes a child — groups nest. The new
     * group sits in the innermost group around all of them (or `data.parent`).
     * One undo step; the new group is selected.
     */
    public group(
        ids: Iterable<string> = this.selected, data: Partial<Omit<WorkflowGroup, 'id' | 'nodes'>> = {}
    ): WorkflowGroup | null {
        const wanted = [...new Set(ids)].filter((id) => this.model.node(id) !== undefined || this.model.group(id) !== undefined);
        // An item inside another selected group goes along with that group.
        const list = wanted.filter((id) => !this.model.ancestors(id).some((a) => wanted.includes(a)));
        const nodes = list.filter((id) => this.model.node(id) !== undefined);
        const groups = list.filter((id) => this.model.group(id) !== undefined);

        if (this.readOnlyFlag || this.model.expandGroups(list).filter((id) => this.model.node(id) !== undefined).length === 0) {
            return null;
        }

        const before = new Set(this.model.allGroups().map((g) => g.id));
        const parent = data.parent ?? this.model.commonParent(list);
        const group = this.model.addGroup({...data, parent, nodes, groups});
        const gone = [...before].filter((id) => this.model.group(id) === undefined);

        this.renderGroupsAndConnections();
        this.setSelection(new Set([group.id]), null);
        this.commit('group', this.model.members(group.id), [], [], [group.id, ...groups, ...gone]);

        return structuredClone(group);
    }

    /**
     * Dissolve a group; its nodes and child groups move up one level (into
     * its parent, or to the top) and get selected.
     */
    public ungroup(id: string): boolean {
        const group = this.model.group(id);
        const items = group === undefined ? [] : [...this.model.members(id).filter((m) => group.nodes.includes(m)),
            ...this.model.children(id).map((c) => c.id)];

        if (this.readOnlyFlag || this.model.removeGroups([id]).length === 0) {
            return false;
        }

        this.renderGroupsAndConnections();
        this.setSelection(new Set(items.filter((i) => this.scene.hasItem(i))), null);
        this.commit('ungroup', items.filter((i) => this.model.node(i) !== undefined), [], [],
            [id, ...items.filter((i) => this.model.group(i) !== undefined)]);

        return true;
    }

    /** Patch a group's label or colour. */
    public updateGroup(id: string, patch: Partial<Pick<WorkflowGroup, 'label' | 'color'>>): boolean {
        if (this.readOnlyFlag || !this.model.updateGroup(id, patch)) {
            return false;
        }

        this.renderGroupsAndConnections();
        this.commit('updateGroup', [], [], [], [id]);

        return true;
    }

    /**
     * Collapse a group into one node, or expand it again. Also works in the
     * viewer — it changes what is shown, so it is part of the document (one
     * `updateGroup` change, undoable). The selection follows: a selected
     * member selects the collapsed group.
     */
    public setGroupCollapsed(id: string, collapsed: boolean): boolean {
        const group = this.model.group(id);

        if (group === undefined || (group.collapsed === true) === collapsed) {
            return false;
        }

        this.gestures.cancel();
        this.inline.finishGroup(true);

        const inside = new Set([...this.model.members(id), ...this.model.descendantGroups(id).filter((g) => g !== id)]);
        const hadMember = [...this.selected].some((s) => inside.has(s));
        const box = collapsed ? null : WorkflowGroups.collapsedRect(this.model, group);
        const moved = box === null ? [] : this.arrange.makeRoom(group, box);

        this.model.updateGroup(id, {collapsed});
        this.renderGroupsAndConnections();

        const next = new Set([...this.selected].filter((s) => this.scene.hasItem(s)));
        if (collapsed && hadMember) {
            next.add(id);
        }
        this.setSelection(next, this.liveSelectedConnection());
        this.commit('updateGroup', moved, [], [], [id]);

        return true;
    }

    public toggleGroup(id: string): boolean {
        const group = this.model.group(id);

        return group !== undefined && this.setGroupCollapsed(id, group.collapsed !== true);
    }

    /** Open a group's label for editing (what a double-click on the frame header does). */
    public editGroupLabel(id: string): void {
        this.inline.editGroupLabel(id);
    }

    // ---- adding from outside --------------------------------------------

    /**
     * Add a node where a palette item was dropped (client coordinates): the
     * node is centred on the point and snapped. Dropped onto a connection it
     * can sit in, it is inserted into that connection. Null when the point is
     * not over the editor or the editor is read-only.
     */
    public dropAt(data: string | WorkflowNodeInput, clientX: number, clientY: number): WorkflowNodeData | null {
        return this.readOnlyFlag ? null : this.palette.drop(typeof data === 'string' ? {type: data} : data, clientX, clientY);
    }

    /**
     * Start dragging a new node from a host palette — call it from the
     * palette item's `pointerdown`. A preview of the node follows the
     * pointer (mouse, pen or touch; give the palette `touch-action: none`),
     * a connection it would drop into lights up, and releasing over the
     * editor calls {@link dropAt}. Escape cancels.
     */
    public beginDrag(data: string | WorkflowNodeInput, e: PointerEvent): void {
        const input: WorkflowNodeInput = typeof data === 'string' ? {type: data} : data;

        if (this.readOnlyFlag) {
            return;
        }

        this.palette.begin(input, e);
    }

    /** Connect an output to an input; null (and `connectRefused`) when invalid. */
    public connect(from: WorkflowPortRef, to: WorkflowPortRef): WorkflowConnection | null {
        const reason = this.model.validate(from, to);

        if (reason !== null) {
            this.events.emit('connectRefused', {from, to, reason});
            return null;
        }

        const conn = this.model.connect(from, to);
        this.connections.render();
        this.commit('connect', [from.node, to.node], [conn.id]);

        return structuredClone(conn);
    }

    /** Set or clear (null / blank) a connection's label as one undoable change. */
    public setConnectionLabel(id: string, label: string | null): boolean {
        if (!this.model.setConnectionLabel(id, label)) {
            return false;
        }

        this.connections.render();
        this.commit('updateConnection', [], [id]);

        return true;
    }

    /** Open a connection's label for editing (what a double-click does). */
    public editConnectionLabel(id: string): void {
        this.inline.editConnectionLabel(id);
    }

    public disconnect(id: string): boolean {
        const conn = this.model.connection(id);

        if (conn === undefined) {
            return false;
        }

        this.model.disconnect(id);
        if (this.selectedConn === id) {
            this.selectedConn = null;
            this.emitSelection();
        }
        this.connections.render();
        this.commit('disconnect', [conn.from.node, conn.to.node], [id]);

        return true;
    }

    // ---- layout, minimap, look -----------------------------------------

    /**
     * Rearrange the nodes left to right (see {@link WorkflowLayout}) as one
     * undoable move, animated by default, then frame the result. A note that
     * fully enclosed nodes is fitted around those nodes again afterwards
     * (keeping room for its text on top); other notes stay where they are.
     */
    public tidyUp(options: WorkflowLayoutOptions & {animate?: boolean} = {}): void {
        if (this.readOnlyFlag || this.arrange.running) {
            return;
        }

        this.gestures.cancel();
        this.arrange.tidy(options);
    }

    /** Show or hide the overview map in the bottom-right corner. */
    public setMinimap(on: boolean): void {
        if (on && this.minimap === null) {
            this.minimap = new WorkflowMinimap(this.root, {
                items: () => [
                    ...[...this.scene.noteViews].map(([id, v]) => ({
                        rect: v.rect, kind: 'note' as const, color: this.model.note(id)?.color
                    })),
                    ...[...this.scene.nodeViews].map(([id, v]) => ({
                        rect: v.rect,
                        kind: 'node' as const,
                        color: v.type?.color,
                        selected: this.selected.has(id),
                        error: this.run.node(id)?.status === 'error'
                    }))
                ],
                viewport: () => this.viewport.viewRect(),
                centerOn: (p) => this.viewport.centerOn(p)
            });
        } else if (!on && this.minimap !== null) {
            this.minimap.destroy();
            this.minimap = null;
        }
    }

    public get hasMinimap(): boolean {
        return this.minimap !== null;
    }

    /**
     * Override colours through the `--wf-*` custom properties (names without
     * the prefix; null removes an override). `WorkflowStyles.varsFromTheme`
     * turns an NGraph theme into such a map.
     */
    public setStyleVars(vars: Partial<Record<WorkflowStyleVar, string | null>>): void {
        for (const [name, value] of Object.entries(vars)) {
            if (value === null || value === undefined) {
                this.root.style.removeProperty(`--wf-${name}`);
                this.styleVars.delete(name);
            } else {
                this.root.style.setProperty(`--wf-${name}`, value);
                this.styleVars.set(name, value);
            }
        }
        this.minimap?.schedule();
    }

    // ---- run status ----------------------------------------------------

    /**
     * Show a node's run state: a badge (spinner, ✓, !, …) and a tinted
     * border; `message` becomes the badge tooltip. Run state is display only —
     * not part of the document, not undoable — and survives re-renders.
     */
    public setNodeStatus(id: string, status: WorkflowNodeStatus, info: WorkflowNodeStatusInfo = {}): void {
        this.run.setNode(id, status, info);
        this.scene.applyNodeStatus(id);

        const group = this.scene.hiddenBy.get(id);
        if (group !== undefined) {
            this.scene.applyNodeStatus(group);
        }
    }

    public getNodeStatus(id: string): WorkflowNodeStatus {
        return this.run.node(id)?.status ?? 'idle';
    }

    /** Show a connection's run state (item count, travelling dots, tint); null clears it. */
    public setConnectionStatus(id: string, status: WorkflowConnectionStatus | null): void {
        this.run.setConnection(id, status);
        this.connections.refreshStatus(id);
    }

    /**
     * Dim everything outside an executed path: nodes not in `nodeIds`, and
     * connections not in `connectionIds`. Without `connectionIds`, a
     * connection counts as run when both its ends are in `nodeIds` — which
     * also keeps an untaken loop-back between two run nodes lit, so a host
     * that knows the travelled connections should pass them. null shows all again.
     */
    public setRunPath(nodeIds: Iterable<string> | null, connectionIds?: Iterable<string>): void {
        this.run.setRunPath(nodeIds, connectionIds);
        this.applyRunState();
    }

    /** Whether a connection is outside the run path (see {@link setRunPath}). */
    public static dimConnection(
        conn: WorkflowConnection | undefined, nodes: ReadonlySet<string> | null, connections: ReadonlySet<string> | null
    ): boolean {
        return WorkflowRunState.dimConnection(conn, nodes, connections);
    }

    /** Clear every node and connection status and the run path. */
    public clearStatus(): void {
        this.run.clear();
        this.applyRunState();
    }

    /**
     * Record every following status call (`setNodeStatus`,
     * `setConnectionStatus`, `setRunPath`, `clearStatus`) with its time, for
     * a later `WorkflowReplay`. The host's run code stays as it is. Starting
     * again discards what was recorded so far.
     */
    public startRecording(): void {
        this.run.startRecording();
    }

    /** Stop recording and return the events (empty when not recording). */
    public stopRecording(): WorkflowRunEvent[] {
        return this.run.stopRecording();
    }

    public get isRecording(): boolean {
        return this.run.recordingActive;
    }

    // ---- undo ----------------------------------------------------------

    public get canUndo(): boolean {
        return this.history.canUndo;
    }

    public get canRedo(): boolean {
        return this.history.canRedo;
    }

    public undo(): boolean {
        this.arrange.settle();
        return this.restore(this.history.undo(), 'undo');
    }

    public redo(): boolean {
        this.arrange.settle();
        return this.restore(this.history.redo(), 'redo');
    }

    // ---- selection -----------------------------------------------------

    public getSelection(): WorkflowSelection {
        return {
            nodes: [...this.selected].filter((id) => this.model.node(id) !== undefined),
            notes: [...this.selected].filter((id) => this.model.note(id) !== undefined),
            groups: [...this.selected].filter((id) => this.model.group(id) !== undefined),
            connection: this.selectedConn
        };
    }

    /** Select nodes, notes and/or groups by id (nodes hidden in a collapsed group are skipped). */
    public select(ids: Iterable<string>): void {
        this.setSelection(new Set([...ids].filter((id) => this.scene.hasItem(id))), null);
    }

    public selectConnection(id: string | null): void {
        this.setSelection(new Set(), id !== null && this.connections.views.has(id) ? id : null);
    }

    public clearSelection(): void {
        this.setSelection(new Set(), null);
    }

    // ---- view ----------------------------------------------------------

    public get readOnly(): boolean {
        return this.readOnlyFlag;
    }

    /** Switch between editor and viewer at runtime. */
    public setReadOnly(readOnly: boolean): void {
        this.arrange.settle();
        this.gestures.cancel();
        this.palette.cancel();
        this.inline.finishNote(true);
        this.inline.finishConnection(true);
        this.inline.finishGroup(true);
        this.readOnlyFlag = readOnly;
        this.root.classList.toggle('wf-editable', !readOnly);
        this.connections.updateTools();
    }

    public setTheme(theme: 'dark' | 'light'): void {
        this.root.dataset.wfTheme = theme;
        this.minimap?.schedule();
    }

    /** The widget's root element (`.wf-root`) — e.g. to set `--wf-*` variables. */
    public get element(): HTMLElement {
        return this.root;
    }

    /** Frame all nodes. */
    public fit(animate = true): void {
        this.viewport.fit(animate);
    }

    /** Centre a node, optionally at a zoom. */
    public focusNode(id: string, scale?: number, animate = true): void {
        const view = this.scene.nodeViews.get(id);

        if (view !== undefined) {
            this.viewport.focus(view.rect, scale, animate);
        }
    }

    /** Zoom around the viewport centre. */
    public zoomBy(factor: number): void {
        this.viewport.zoomAt(this.root.clientWidth / 2, this.root.clientHeight / 2, factor);
    }

    public getViewport(): CameraState {
        return this.viewport.camera.getState();
    }

    public setViewport(state: CameraState): void {
        this.viewport.setState(state);
    }

    /** World coordinates (node x/y space) of a client point — e.g. where to drop a new node. */
    public screenToWorld(clientX: number, clientY: number): RectPoint {
        return this.viewport.toWorld(clientX, clientY);
    }

    // ---- events --------------------------------------------------------

    public on<K extends keyof WorkflowEditorEvents>(event: K, handler: (payload: WorkflowEditorEvents[K]) => void): this {
        this.events.on(event, handler);
        return this;
    }

    public off<K extends keyof WorkflowEditorEvents>(event: K, handler: (payload: WorkflowEditorEvents[K]) => void): this {
        this.events.off(event, handler);
        return this;
    }

    public destroy(): void {
        this.gestures.cancel();
        this.palette.cancel();
        this.inline.finishNote(false);
        this.inline.finishConnection(false);
        this.inline.finishGroup(false);
        this.setMinimap(false);
        this.arrange.drop();
        this.viewport.destroy();
        this.gestures.destroy();
        this.keyboard.destroy();
        this.events.clear();
        this.root.remove();
    }

    /** A clipboard text as a fragment, or null when it is not one of ours. */
    public static parseFragment(text: string): WorkflowFragment | null {
        return WorkflowKeyboard.parseFragment(text);
    }

    // ---- internals -----------------------------------------------------

    private renderAll(): void {
        this.scene.reset();
        this.connections.reset();

        for (const note of this.model.allNotes()) {
            this.scene.renderNote(note);
        }

        this.renderGroupsAndConnections();
    }

    private renderGroupsAndConnections(): void {
        this.scene.renderGroups();
        this.connections.render();
    }

    /** Re-render changed nodes, then the connections. */
    private renderNodes(ids: string[]): void {
        for (const id of ids) {
            this.scene.renderNode(this.model.node(id)!);
        }
        this.connections.render();
    }

    /** Re-apply node and connection run state after the path changed or was cleared. */
    private applyRunState(): void {
        for (const id of this.scene.nodeViews.keys()) {
            this.scene.applyNodeStatus(id);
        }
        this.connections.render();
    }

    /** The write-back handle a custom node body gets. */
    private nodeContext(id: string): WorkflowNodeContext {
        const readOnly = (): boolean => this.readOnlyFlag;

        return {
            get readOnly(): boolean {
                return readOnly();
            },
            update: (patch, options = {}) => {
                if (!this.readOnlyFlag) {
                    this.updateNode(id, patch, {render: false, commit: options.live !== true});
                }
            },
            toggleCollapsed: () => {
                if (!this.readOnlyFlag) {
                    this.setCollapsed([id]);
                }
            },
            toggleDisabled: () => {
                if (!this.readOnlyFlag) {
                    this.setDisabled([id]);
                }
            }
        };
    }

    private commit(kind: WorkflowChangeKind, nodes: string[], connections: string[], notes: string[] = [], groups: string[] = []): void {
        const change: WorkflowChange = {kind, nodes: [...new Set(nodes)], connections};

        if (notes.length > 0) {
            change.notes = notes;
        }
        if (groups.length > 0) {
            change.groups = [...new Set(groups)];
        }
        this.history.record(this.model.toDocument());
        this.events.emit('change', change);
    }

    private restore(doc: WorkflowDocument | undefined, kind: 'undo' | 'redo'): boolean {
        if (doc === undefined) {
            return false;
        }

        this.gestures.cancel();
        this.inline.finishNote(false);
        this.inline.finishConnection(false);
        this.inline.finishGroup(false);
        this.model.load(doc);
        this.renderAll();
        this.keepLiveSelection();
        this.events.emit('change', {kind, nodes: [], connections: []});

        return true;
    }

    /** Drop the elements of removed nodes/notes and fix up the selection. */
    private afterRemove(nodeIds: string[], noteIds: string[] = []): void {
        for (const id of nodeIds) {
            this.scene.removeNode(id);
        }
        for (const id of noteIds) {
            if (this.inline.editingNote === id) {
                this.inline.finishNote(false);
            }
            this.scene.removeNote(id);
        }

        this.renderGroupsAndConnections();
        this.keepLiveSelection();
    }

    /** The selected connection while it is still drawn, else null. */
    private liveSelectedConnection(): string | null {
        return this.selectedConn !== null && this.connections.views.has(this.selectedConn) ? this.selectedConn : null;
    }

    /** Narrow the selection to what is still drawn. */
    private keepLiveSelection(): void {
        this.setSelection(new Set([...this.selected].filter((id) => this.scene.hasItem(id))), this.liveSelectedConnection());
    }

    private setSelection(nodes: Set<string>, conn: string | null): void {
        const same = conn === this.selectedConn && nodes.size === this.selected.size
            && [...nodes].every((id) => this.selected.has(id));

        if (same) {
            return;
        }

        for (const id of this.selected) {
            this.scene.itemEl(id)?.classList.remove('wf-selected');
        }
        for (const id of nodes) {
            this.scene.itemEl(id)?.classList.add('wf-selected');
        }
        if (this.selectedConn !== null) {
            this.connections.views.get(this.selectedConn)?.g.classList.remove('wf-selected');
        }
        if (conn !== null) {
            this.connections.views.get(conn)?.g.classList.add('wf-selected');
        }

        this.selected = nodes;
        this.selectedConn = conn;
        this.connections.updateTools();
        this.minimap?.schedule();
        this.emitSelection();
    }

    private emitSelection(): void {
        this.events.emit('selectionChange', this.getSelection());
    }

}
