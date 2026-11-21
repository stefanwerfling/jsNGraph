import { Camera, CameraState } from '../view/Camera';
import { EventEmitter } from '../util/EventEmitter';
import { RectArea, RectBoardGeometry, RectPoint } from '../rect/RectBoardGeometry';
import { RectHistory } from '../rect/RectHistory';
import { WorkflowGeometry, WorkflowPortPlace } from './WorkflowGeometry';
import { WorkflowModel } from './WorkflowModel';
import { WorkflowStyles } from './WorkflowStyles';
import {
    WorkflowChangeKind,
    WorkflowConnection,
    WorkflowConnectionStatus,
    WorkflowDocument,
    WorkflowEditorEvents,
    WorkflowEditorOptions,
    WorkflowFragment,
    WorkflowNodeData,
    WorkflowNodeStatus,
    WorkflowNodeStatusInfo,
    WorkflowNodeType,
    WorkflowNote,
    WorkflowPortDir,
    WorkflowPortRef
} from './WorkflowTypes';

/** Node data as a palette or picker hands it in: everything but id/position is optional. */
export type WorkflowNodeInput = Omit<WorkflowNodeData, 'id' | 'x' | 'y'> & {id?: string; x?: number; y?: number};

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Screen px a press may travel before it counts as a drag instead of a click. */
const CLICK_SLOP = 3;
/** Pull the arrow tip back from the port centre so it ends at the port's edge. */
const ARROW_INSET = 8;

interface PortView {
    place: WorkflowPortPlace;
    el: HTMLDivElement;
}

interface NodeView {
    el: HTMLDivElement;
    rect: RectArea;
    type: WorkflowNodeType | undefined;
    ports: Map<string, PortView>;
}

interface NoteView {
    el: HTMLDivElement;
    rect: RectArea;
}

interface NoteEdit {
    id: string;
    area: HTMLTextAreaElement;
    before: string;
}

interface ConnView {
    g: SVGGElement;
    hit: SVGPathElement;
    path: SVGPathElement;
    mid: RectPoint;
    /** Item-count pill, while the connection has one. */
    label: HTMLDivElement | null;
    /** Travelling dots, while the connection is active. */
    dots: SVGGElement | null;
}

interface DraftTarget {
    ref: WorkflowPortRef;
    el: HTMLDivElement;
}

type Gesture =
    | {kind: 'pan'; lastX: number; lastY: number; startX: number; startY: number; moved: boolean}
    | {kind: 'node'; id: string; startX: number; startY: number; origins: Map<string, RectPoint>;
        moved: boolean; collapseOnClick: boolean}
    | {kind: 'conn'; id: string}
    | {kind: 'resize'; id: string; startX: number; startY: number; w0: number; h0: number; moved: boolean}
    | {kind: 'draft'; anchor: WorkflowPortRef; anchorDir: WorkflowPortDir; rerouting: string | null;
        valid: Set<string>; target: DraftTarget | null; overNode: string | null}
    | {kind: 'band'; start: RectPoint; el: HTMLDivElement; base: Set<string>};

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
 * stage element transformed by the shared {@link Camera}.
 */
export class WorkflowEditor {

    private static instances = 0;

    private readonly root: HTMLDivElement;
    private readonly stage: HTMLDivElement;
    private readonly svg: SVGSVGElement;
    private readonly connLayer: SVGGElement;
    private readonly draftPath: SVGPathElement;
    private readonly nodeLayer: HTMLDivElement;
    private readonly noteLayer: HTMLDivElement;
    private readonly arrowId: string;

    private readonly model: WorkflowModel;
    private readonly camera: Camera;
    private readonly events = new EventEmitter<WorkflowEditorEvents>();
    private readonly history: RectHistory<WorkflowDocument>;
    private readonly grid: number;
    private readonly fitOnLoad: boolean;
    private readonly reconnectOnDelete: boolean;
    private readonly tools: HTMLDivElement;
    private readonly labelLayer: HTMLDivElement;
    private readonly nodeStatus = new Map<string, {status: WorkflowNodeStatus; message?: string}>();
    private readonly connStatus = new Map<string, WorkflowConnectionStatus>();
    private runPath: Set<string> | null = null;
    private hoveredConn: string | null = null;
    /** Last pointer position (root-local px) while the pointer is over the editor. */
    private lastPointer: RectPoint | null = null;

    private readonly nodeViews = new Map<string, NodeView>();
    private readonly connViews = new Map<string, ConnView>();
    private readonly noteViews = new Map<string, NoteView>();
    private noteEdit: NoteEdit | null = null;
    /** Cleanup of a running palette drag. */
    private paletteDrag: (() => void) | null = null;
    private selected = new Set<string>();
    private selectedConn: string | null = null;
    private gesture: Gesture | null = null;
    private readOnlyFlag: boolean;
    /** Until the user pans/zooms, the view re-fits on resize. */
    private userMoved = false;
    private pendingFit = false;
    private flightFrame: number | null = null;
    private readonly resizeObserver: ResizeObserver | null = null;

    private readonly onDown = (e: PointerEvent): void => this.handleDown(e);
    private readonly onMove = (e: PointerEvent): void => this.handleMove(e);
    private readonly onUp = (e: PointerEvent): void => this.handleUp(e);
    private readonly onWheel = (e: WheelEvent): void => this.handleWheel(e);
    private readonly onDbl = (e: MouseEvent): void => this.handleDblClick(e);
    private readonly onKey = (e: KeyboardEvent): void => this.handleKey(e);
    private readonly onOver = (e: PointerEvent): void => this.handleOver(e);
    private readonly onLeave = (): void => {
        this.lastPointer = null;
        this.hoveredConn = null;
        this.updateTools();
    };
    private readonly onCopy = (e: ClipboardEvent): void => this.handleClipboard(e, 'copy');
    private readonly onCut = (e: ClipboardEvent): void => this.handleClipboard(e, 'cut');
    private readonly onPaste = (e: ClipboardEvent): void => this.handleClipboard(e, 'paste');

    public constructor(container: HTMLElement, options: WorkflowEditorOptions = {}) {
        WorkflowStyles.ensure();

        this.grid = options.grid ?? 20;
        this.fitOnLoad = options.fitOnLoad ?? true;
        this.reconnectOnDelete = options.reconnectOnDelete ?? true;
        this.readOnlyFlag = options.readOnly ?? false;
        this.camera = new Camera(options.minScale ?? 0.2, options.maxScale ?? 2.5);
        this.model = new WorkflowModel(options.types ?? [], undefined, options.canConnect);
        this.arrowId = `wf-arrow-${++WorkflowEditor.instances}`;

        this.root = document.createElement('div');
        this.root.className = 'wf-root';
        this.root.tabIndex = 0;
        this.root.dataset.wfTheme = options.theme ?? 'dark';
        this.root.classList.toggle('wf-editable', !this.readOnlyFlag);

        this.stage = document.createElement('div');
        this.stage.className = 'wf-stage';

        this.svg = document.createElementNS(SVG_NS, 'svg');
        this.svg.classList.add('wf-edges');
        this.svg.innerHTML =
            `<defs><marker id="${this.arrowId}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" ` +
            'markerWidth="10" markerHeight="10" orient="auto"><path class="wf-arrow" d="M0 1 L10 5 L0 9 z"/></marker></defs>';
        this.connLayer = document.createElementNS(SVG_NS, 'g');
        this.draftPath = document.createElementNS(SVG_NS, 'path');
        this.draftPath.classList.add('wf-conn-draft');
        this.draftPath.style.display = 'none';
        this.svg.append(this.connLayer, this.draftPath);

        this.nodeLayer = document.createElement('div');
        this.noteLayer = document.createElement('div');
        this.labelLayer = document.createElement('div');

        this.tools = document.createElement('div');
        this.tools.className = 'wf-conn-tools';
        this.tools.style.display = 'none';
        this.tools.innerHTML =
            '<button type="button" data-wf-tool="insert" title="Insert node">+</button>' +
            '<button type="button" data-wf-tool="delete" title="Delete connection">×</button>';

        this.stage.append(this.noteLayer, this.svg, this.labelLayer, this.nodeLayer, this.tools);
        this.root.appendChild(this.stage);
        container.appendChild(this.root);

        this.root.addEventListener('pointerdown', this.onDown);
        this.root.addEventListener('pointermove', this.onMove);
        this.root.addEventListener('pointerup', this.onUp);
        this.root.addEventListener('pointercancel', this.onUp);
        this.root.addEventListener('wheel', this.onWheel, {passive: false});
        this.root.addEventListener('dblclick', this.onDbl);
        this.root.addEventListener('keydown', this.onKey);
        this.root.addEventListener('pointerover', this.onOver);
        this.root.addEventListener('pointerleave', this.onLeave);
        document.addEventListener('copy', this.onCopy);
        document.addEventListener('cut', this.onCut);
        document.addEventListener('paste', this.onPaste);

        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                if (this.pendingFit || (!this.userMoved && this.fitOnLoad)) {
                    this.fit(false);
                }
            });
            this.resizeObserver.observe(this.root);
        }

        const doc = options.document ?? {nodes: [], connections: []};
        this.model.load(doc);
        this.history = new RectHistory<WorkflowDocument>(this.model.toDocument(), options.historySize ?? 100);
        this.renderAll();
        this.applyCamera();
        if (this.fitOnLoad) {
            this.fit(false);
        }
    }

    // ---- document ------------------------------------------------------

    /** Replace the whole document; clears undo history and selection. */
    public setDocument(doc: WorkflowDocument, fit = this.fitOnLoad): void {
        this.cancelGesture();
        this.finishNoteEdit(false);
        this.model.load(doc);
        this.history.reset(this.model.toDocument());
        this.selected.clear();
        this.selectedConn = null;
        this.renderAll();
        if (fit) {
            this.userMoved = false;
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

    public getType(type: string): WorkflowNodeType | undefined {
        return this.model.getType(type);
    }

    public getNode(id: string): WorkflowNodeData | undefined {
        const node = this.model.node(id);

        return node === undefined ? undefined : structuredClone(node);
    }

    /** Add a node (id generated when omitted). Undoable; emits `change`. */
    public addNode(data: Omit<WorkflowNodeData, 'id'> & {id?: string}): WorkflowNodeData {
        const node = this.model.addNode(data);
        this.renderNode(node);
        this.commit('addNode', [node.id], []);

        return structuredClone(node);
    }

    /** Patch label/position/disabled/meta …; the node re-renders. */
    public updateNode(id: string, patch: Partial<Omit<WorkflowNodeData, 'id'>>): boolean {
        if (!this.model.updateNode(id, patch)) {
            return false;
        }

        const node = this.model.node(id)!;
        this.renderNode(node);
        this.renderConnections();
        this.commit('updateNode', [id], []);

        return true;
    }

    /**
     * Remove nodes and their connections. With `reconnect` (default: the
     * `reconnectOnDelete` option) a node in a chain is bridged — its
     * predecessor gets wired to its successors.
     */
    public removeNodes(ids: Iterable<string>, reconnect = this.reconnectOnDelete): void {
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
        const list = [...ids].filter((id) => this.model.node(id) !== undefined);
        const value = disabled ?? !list.every((id) => this.model.node(id)!.disabled === true);
        const changed = this.model.setDisabled(list, value);

        if (changed.length === 0) {
            return;
        }

        for (const id of changed) {
            this.renderNode(this.model.node(id)!);
        }
        this.renderConnections();
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
        const place = this.nodeViews.get(port.node)?.ports.get(`${dir}:${port.port}`)?.place;

        if (place === undefined) {
            return null;
        }

        const size = WorkflowGeometry.nodeSize(this.model.getType(data.type));
        const obstacles = [...this.nodeViews.values()].map((v) => v.rect);
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

        this.renderNode(node);
        this.renderConnections();
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
        const source = conn === undefined ? undefined : this.nodeViews.get(conn.from.node);
        const port = source?.ports.get(`out:${conn!.from.port}`)?.place;

        if (conn === undefined || source === undefined || port === undefined || !this.model.canInsert(data.type, connectionId)) {
            return null;
        }

        const size = WorkflowGeometry.nodeSize(this.model.getType(data.type));
        const sourceRight = source.rect.x + source.rect.w;
        const x = data.x ?? RectBoardGeometry.snap(sourceRight + 80, this.grid);
        const y = data.y ?? RectBoardGeometry.snap(port.y - size.h / 2, this.grid);
        const rect = {x: x - 20, y: y - 20, w: size.w + 40, h: size.h + 40};
        const moved: string[] = [];

        if ([...this.nodeViews.values()].some((v) => RectBoardGeometry.overlaps(rect, v.rect))) {
            const shift = RectBoardGeometry.snap(size.w + 80, this.grid);

            for (const [id, v] of this.nodeViews) {
                if (id !== conn.from.node && v.rect.x >= sourceRight) {
                    this.model.moveNode(id, v.rect.x + shift, v.rect.y);
                    this.positionNode(id);
                    moved.push(id);
                }
            }
        }

        this.model.disconnect(connectionId);

        const node = this.model.addNode({...data, x, y});
        const conns = [connectionId];
        const inPort = this.model.firstCompatiblePort(conn.from, 'out', node.id);
        const outPort = this.model.firstCompatiblePort(conn.to, 'in', node.id);

        if (inPort !== null) {
            conns.push(this.model.connect(conn.from, {node: node.id, port: inPort}).id);
        }
        if (outPort !== null) {
            conns.push(this.model.connect({node: node.id, port: outPort}, conn.to).id);
        }

        if (this.selectedConn === connectionId) {
            this.selectedConn = null;
        }
        this.renderNode(node);
        this.renderConnections();
        this.setSelection(new Set([node.id]), null);
        this.commit('insertNode', [node.id, conn.from.node, conn.to.node, ...moved], conns);

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
        const items: RectPoint[] = [...fragment.nodes, ...(fragment.notes ?? [])];

        if (this.readOnlyFlag || items.length === 0) {
            return [];
        }

        const minX = Math.min(...items.map((n) => n.x));
        const minY = Math.min(...items.map((n) => n.y));
        let dx: number;
        let dy: number;

        if (at !== undefined) {
            dx = RectBoardGeometry.snap(at.x - minX, this.grid);
            dy = RectBoardGeometry.snap(at.y - minY, this.grid);
        } else {
            const taken = new Set([...this.model.allNodes(), ...this.model.allNotes()].map((n) => `${n.x},${n.y}`));
            const first = items[0]!;
            let k = 1;

            while (k < 50 && taken.has(`${first.x + 40 * k},${first.y + 40 * k}`)) {
                k++;
            }
            dx = 40 * k;
            dy = 40 * k;
        }

        const added = this.model.paste(fragment, dx, dy);

        for (const id of added.nodes) {
            this.renderNode(this.model.node(id)!);
        }
        for (const id of added.notes) {
            this.renderNote(this.model.note(id)!);
        }
        this.renderConnections();
        this.setSelection(new Set([...added.nodes, ...added.notes]), null);
        this.commit('paste', added.nodes, added.connections, added.notes);

        return [...added.nodes, ...added.notes];
    }

    /** Copy the selection and paste it right next to itself. */
    public duplicateSelection(): string[] {
        const fragment = this.copySelection();

        return fragment === null ? [] : this.paste(fragment);
    }

    /** Remove nodes and notes in one undo step (nodes re-link chains like `removeNodes`). */
    public remove(ids: Iterable<string>, reconnect = this.reconnectOnDelete): void {
        const list = [...ids];
        const nodes = list.filter((id) => this.model.node(id) !== undefined);
        const notes = list.filter((id) => this.model.note(id) !== undefined);

        if (nodes.length === 0 && notes.length === 0) {
            return;
        }

        const {removed, added} = this.model.removeNodes(nodes, reconnect);
        this.model.removeNotes(notes);
        this.afterRemove(nodes, notes);
        this.commit(notes.length > 0 ? 'remove' : 'removeNodes', nodes, [...removed, ...added], notes);
    }

    // ---- notes ---------------------------------------------------------

    public getNote(id: string): WorkflowNote | undefined {
        const note = this.model.note(id);

        return note === undefined ? undefined : structuredClone(note);
    }

    /** Add a sticky note (default 240×160, empty). */
    public addNote(data: Partial<WorkflowNote> & {x: number; y: number}): WorkflowNote {
        const note = this.model.addNote(data);
        this.renderNote(note);
        this.commit('addNote', [], [], [note.id]);

        return structuredClone(note);
    }

    /** Patch text, colour, position or size of a note. */
    public updateNote(id: string, patch: Partial<Omit<WorkflowNote, 'id'>>): boolean {
        if (!this.model.updateNote(id, patch)) {
            return false;
        }

        this.renderNote(this.model.note(id)!);
        this.commit('updateNote', [], [], [id]);

        return true;
    }

    /** Open a note's text for editing (what a double-click does). */
    public editNote(id: string): void {
        const view = this.noteViews.get(id);
        const note = this.model.note(id);

        if (this.readOnlyFlag || view === undefined || note === undefined) {
            return;
        }

        this.finishNoteEdit(true);

        const area = document.createElement('textarea');
        area.className = 'wf-note-edit';
        area.value = note.text;
        area.addEventListener('blur', () => this.finishNoteEdit(true));
        area.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
                this.finishNoteEdit(false);
                this.root.focus({preventScroll: true});
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.finishNoteEdit(true);
                this.root.focus({preventScroll: true});
            }
        });

        view.el.querySelector<HTMLElement>('.wf-note-text')!.style.visibility = 'hidden';
        view.el.appendChild(area);
        this.noteEdit = {id, area, before: note.text};
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
    }

    // ---- adding from outside --------------------------------------------

    /**
     * Add a node where a palette item was dropped (client coordinates): the
     * node is centred on the point and snapped. Dropped onto a connection it
     * can sit in, it is inserted into that connection. Null when the point is
     * not over the editor or the editor is read-only.
     */
    public dropAt(data: string | WorkflowNodeInput, clientX: number, clientY: number): WorkflowNodeData | null {
        const input: WorkflowNodeInput = typeof data === 'string' ? {type: data} : data;

        if (this.readOnlyFlag || !this.isOver(clientX, clientY)) {
            return null;
        }

        const size = WorkflowGeometry.nodeSize(this.model.getType(input.type));
        const w = this.screenToWorld(clientX, clientY);
        const x = RectBoardGeometry.snap(w.x - size.w / 2, this.grid);
        const y = RectBoardGeometry.snap(w.y - size.h / 2, this.grid);
        const conn = this.connectionAt(clientX, clientY, input.type);

        if (conn !== null) {
            return this.insertNode(conn, {...input, x, y});
        }

        const node = this.addNode({...input, x, y});
        this.select([node.id]);

        return node;
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

        e.preventDefault();
        this.paletteDrag?.();

        const type = this.model.getType(input.type);
        const size = WorkflowGeometry.nodeSize(type);
        const preview = this.buildNode({...input, id: '', x: 0, y: 0}, type, {x: 0, y: 0, ...size});
        const ghost = document.createElement('div');
        let target: string | null = null;

        ghost.className = 'wf-ghost';
        ghost.dataset.wfTheme = this.root.dataset.wfTheme;
        ghost.appendChild(preview.el);
        document.body.appendChild(ghost);

        const mark = (id: string | null): void => {
            if (target !== null) {
                this.connViews.get(target)?.g.classList.remove('wf-drop');
            }
            target = id;
            if (id !== null) {
                this.connViews.get(id)?.g.classList.add('wf-drop');
            }
        };
        const move = (ev: PointerEvent): void => {
            const s = this.camera.scale;
            const over = this.isOver(ev.clientX, ev.clientY);

            ghost.style.transform = `translate(${ev.clientX - size.w * s / 2}px, ${ev.clientY - size.h * s / 2}px) scale(${s})`;
            ghost.classList.toggle('wf-ghost-out', !over);
            mark(over ? this.connectionAt(ev.clientX, ev.clientY, input.type) : null);
        };
        const cleanup = (): void => {
            mark(null);
            ghost.remove();
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            window.removeEventListener('keydown', key, true);
            this.paletteDrag = null;
        };
        const up = (ev: PointerEvent): void => {
            cleanup();
            if (ev.type === 'pointerup') {
                const node = this.dropAt(input, ev.clientX, ev.clientY);
                if (node !== null) {
                    this.root.focus({preventScroll: true});
                }
            }
        };
        const key = (ev: KeyboardEvent): void => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                cleanup();
            }
        };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        window.addEventListener('keydown', key, true);
        this.paletteDrag = cleanup;
        move(e);
    }

    /** The client point lies on the editor and nothing of the host covers it there. */
    private isOver(clientX: number, clientY: number): boolean {
        const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(clientX, clientY) : null;

        return hit !== null && this.root.contains(hit);
    }

    /**
     * The connection under (or within a few px of) a client point that a node
     * of `type` could be inserted into — a thin line is hard to hit exactly.
     */
    private connectionAt(clientX: number, clientY: number, type: string): string | null {
        const r = 10;

        for (const [dx, dy] of [[0, 0], [0, -r], [0, r], [-r, 0], [r, 0]] as const) {
            const hit = document.elementFromPoint(clientX + dx, clientY + dy);
            const id = hit?.closest<SVGGElement>('[data-wf-conn]')?.dataset.wfConn;

            if (id !== undefined && this.root.contains(hit) && this.model.canInsert(type, id)) {
                return id;
            }
        }

        return null;
    }

    /** Connect an output to an input; null (and `connectRefused`) when invalid. */
    public connect(from: WorkflowPortRef, to: WorkflowPortRef): WorkflowConnection | null {
        const reason = this.model.validate(from, to);

        if (reason !== null) {
            this.events.emit('connectRefused', {from, to, reason});
            return null;
        }

        const conn = this.model.connect(from, to);
        this.renderConnections();
        this.commit('connect', [from.node, to.node], [conn.id]);

        return structuredClone(conn);
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
        this.renderConnections();
        this.commit('disconnect', [conn.from.node, conn.to.node], [id]);

        return true;
    }

    // ---- run status ----------------------------------------------------

    /**
     * Show a node's run state: a badge (spinner, ✓, !, …) and a tinted
     * border; `message` becomes the badge tooltip. Run state is display only —
     * not part of the document, not undoable — and survives re-renders.
     */
    public setNodeStatus(id: string, status: WorkflowNodeStatus, info: WorkflowNodeStatusInfo = {}): void {
        if (status === 'idle') {
            this.nodeStatus.delete(id);
        } else {
            this.nodeStatus.set(id, {status, ...info});
        }
        this.applyNodeStatus(id);
    }

    public getNodeStatus(id: string): WorkflowNodeStatus {
        return this.nodeStatus.get(id)?.status ?? 'idle';
    }

    /** Show a connection's run state (item count, travelling dots, tint); null clears it. */
    public setConnectionStatus(id: string, status: WorkflowConnectionStatus | null): void {
        if (status === null) {
            this.connStatus.delete(id);
        } else {
            this.connStatus.set(id, {...status});
        }

        const cv = this.connViews.get(id);

        if (cv !== undefined) {
            this.applyConnStatus(id, cv, cv.path.getAttribute('d') ?? '');
        }
    }

    /**
     * Dim everything outside an executed path: nodes not in `nodeIds` and
     * connections not running between two of them. null shows all again.
     */
    public setRunPath(nodeIds: Iterable<string> | null): void {
        this.runPath = nodeIds === null ? null : new Set(nodeIds);

        for (const id of this.nodeViews.keys()) {
            this.applyNodeStatus(id);
        }
        this.renderConnections();
    }

    /** Clear every node and connection status and the run path. */
    public clearStatus(): void {
        this.nodeStatus.clear();
        this.connStatus.clear();
        this.setRunPath(null);
    }

    // ---- undo ----------------------------------------------------------

    public get canUndo(): boolean {
        return this.history.canUndo;
    }

    public get canRedo(): boolean {
        return this.history.canRedo;
    }

    public undo(): boolean {
        return this.restore(this.history.undo(), 'undo');
    }

    public redo(): boolean {
        return this.restore(this.history.redo(), 'redo');
    }

    // ---- selection -----------------------------------------------------

    public getSelection(): {nodes: string[]; notes: string[]; connection: string | null} {
        return {
            nodes: [...this.selected].filter((id) => this.nodeViews.has(id)),
            notes: [...this.selected].filter((id) => this.noteViews.has(id)),
            connection: this.selectedConn
        };
    }

    /** Select nodes and/or notes by id. */
    public select(ids: Iterable<string>): void {
        this.setSelection(new Set([...ids].filter((id) => this.hasItem(id))), null);
    }

    public selectConnection(id: string | null): void {
        this.setSelection(new Set(), id !== null && this.connViews.has(id) ? id : null);
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
        this.cancelGesture();
        this.paletteDrag?.();
        this.finishNoteEdit(true);
        this.readOnlyFlag = readOnly;
        this.root.classList.toggle('wf-editable', !readOnly);
        this.updateTools();
    }

    public setTheme(theme: 'dark' | 'light'): void {
        this.root.dataset.wfTheme = theme;
    }

    /** The widget's root element (`.wf-root`) — e.g. to set `--wf-*` variables. */
    public get element(): HTMLElement {
        return this.root;
    }

    /** Frame all nodes. */
    public fit(animate = true): void {
        const w = this.root.clientWidth;
        const h = this.root.clientHeight;

        if (w === 0 || h === 0) {
            this.pendingFit = true;
            return;
        }

        this.pendingFit = false;
        const box = RectBoardGeometry.bounds([...this.nodeViews.values(), ...this.noteViews.values()].map((v) => v.rect));

        if (box === null) {
            this.camera.setState({scale: 1, offsetX: 0, offsetY: 0});
            this.applyCamera();
            return;
        }

        const target = this.camera.fitState(
            {minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h}, w, h, 48
        );
        // Never blow a small workflow up past 1:1.
        const capped = target.scale > 1 ? this.camera.centerState(box.x + box.w / 2, box.y + box.h / 2, w, h, 1) : target;

        this.flyTo(capped, animate);
    }

    /** Centre a node, optionally at a zoom. */
    public focusNode(id: string, scale?: number, animate = true): void {
        const view = this.nodeViews.get(id);

        if (view === undefined) {
            return;
        }

        const c = RectBoardGeometry.center(view.rect);
        this.flyTo(this.camera.centerState(c.x, c.y, this.root.clientWidth, this.root.clientHeight, scale), animate);
    }

    /** Zoom around the viewport centre. */
    public zoomBy(factor: number): void {
        this.userMoved = true;
        this.camera.zoomAt(this.root.clientWidth / 2, this.root.clientHeight / 2, factor);
        this.applyCamera();
    }

    public getViewport(): CameraState {
        return this.camera.getState();
    }

    public setViewport(state: CameraState): void {
        this.userMoved = true;
        this.camera.setState(state);
        this.applyCamera();
    }

    /** World coordinates (node x/y space) of a client point — e.g. where to drop a new node. */
    public screenToWorld(clientX: number, clientY: number): RectPoint {
        const r = this.root.getBoundingClientRect();

        return this.camera.toWorld(clientX - r.left, clientY - r.top);
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
        this.cancelGesture();
        this.paletteDrag?.();
        this.finishNoteEdit(false);
        if (this.flightFrame !== null) {
            cancelAnimationFrame(this.flightFrame);
        }
        this.resizeObserver?.disconnect();
        this.root.removeEventListener('pointerdown', this.onDown);
        this.root.removeEventListener('pointermove', this.onMove);
        this.root.removeEventListener('pointerup', this.onUp);
        this.root.removeEventListener('pointercancel', this.onUp);
        this.root.removeEventListener('wheel', this.onWheel);
        this.root.removeEventListener('dblclick', this.onDbl);
        this.root.removeEventListener('keydown', this.onKey);
        this.root.removeEventListener('pointerover', this.onOver);
        this.root.removeEventListener('pointerleave', this.onLeave);
        document.removeEventListener('copy', this.onCopy);
        document.removeEventListener('cut', this.onCut);
        document.removeEventListener('paste', this.onPaste);
        this.events.clear();
        this.root.remove();
    }

    // ---- rendering -----------------------------------------------------

    private renderAll(): void {
        this.nodeLayer.replaceChildren();
        this.nodeViews.clear();
        this.noteLayer.replaceChildren();
        this.noteViews.clear();
        this.connLayer.replaceChildren();
        this.labelLayer.replaceChildren();
        this.connViews.clear();

        for (const note of this.model.allNotes()) {
            this.renderNote(note);
        }
        for (const node of this.model.allNodes()) {
            this.renderNode(node);
        }

        this.renderConnections();
    }

    /** (Re)build one node's element. */
    private renderNode(node: WorkflowNodeData): void {
        const type = this.model.getType(node.type);
        const size = WorkflowGeometry.nodeSize(type);
        const view = this.buildNode(node, type, {x: node.x, y: node.y, w: size.w, h: size.h});
        const old = this.nodeViews.get(node.id);

        if (old === undefined) {
            this.nodeLayer.appendChild(view.el);
        } else {
            old.el.replaceWith(view.el);
        }

        this.nodeViews.set(node.id, view);
        this.positionNode(node.id);
        this.applyNodeStatus(node.id);
    }

    /** Status classes, badge and run-path dimming of one node. */
    private applyNodeStatus(id: string): void {
        const el = this.nodeViews.get(id)?.el;

        if (el === undefined) {
            return;
        }

        const st = this.nodeStatus.get(id);
        const status = st?.status ?? 'idle';

        for (const s of ['waiting', 'running', 'success', 'error'] as const) {
            el.classList.toggle(`wf-st-${s}`, status === s);
        }
        el.classList.toggle('wf-dim', this.runPath !== null && !this.runPath.has(id));

        let badge = el.querySelector<HTMLDivElement>(':scope > .wf-badge');

        if (status === 'idle') {
            badge?.remove();
            return;
        }
        if (badge === null) {
            badge = document.createElement('div');
            badge.className = 'wf-badge';
            el.appendChild(badge);
        }

        badge.dataset.wfStatus = status;
        badge.textContent = status === 'success' ? '✓' : status === 'error' ? '!' : status === 'waiting' ? '…' : '';
        badge.title = st?.message ?? status;
    }

    /** A node's element with body, ports, "+" buttons and port labels (not yet placed). */
    private buildNode(node: WorkflowNodeData, type: WorkflowNodeType | undefined, rect: RectArea): NodeView {
        const size = {w: rect.w, h: rect.h};
        const el = document.createElement('div');

        el.className = 'wf-node';
        el.dataset.wfNode = node.id;
        el.style.width = `${size.w}px`;
        el.style.height = `${size.h}px`;
        el.classList.toggle('wf-disabled', node.disabled === true);
        el.classList.toggle('wf-unknown', type === undefined);
        el.classList.toggle('wf-selected', this.selected.has(node.id));
        if (type?.color !== undefined) {
            el.style.setProperty('--wf-node-color', type.color);
        }

        const body = document.createElement('div');
        body.className = 'wf-node-body';

        if (type?.render !== undefined) {
            type.render(structuredClone(node), body);
        } else {
            WorkflowEditor.defaultBody(node, type, body);
        }
        el.appendChild(body);

        const view: NodeView = {el, rect, type, ports: new Map()};

        for (const [key, place] of WorkflowGeometry.placePorts(type, rect)) {
            const portEl = document.createElement('div');
            portEl.className = 'wf-port';
            portEl.dataset.wfPort = place.port.id;
            portEl.dataset.wfDir = place.dir;
            portEl.style.left = `${place.x - rect.x}px`;
            portEl.style.top = `${place.y - rect.y}px`;
            portEl.title = place.port.label ?? place.port.id;
            el.appendChild(portEl);

            // "+" for a free output, and for a free input that is not the main
            // left-hand one (sockets like a model/tool input at the bottom).
            if (place.dir === 'out' || place.side !== 'left') {
                const n = RectBoardGeometry.normal(place.side);
                const add = document.createElement('button');
                add.type = 'button';
                add.className = 'wf-add';
                add.textContent = '+';
                add.title = 'Add node';
                add.dataset.wfAdd = place.port.id;
                add.dataset.wfDir = place.dir;
                add.style.left = `${place.x - rect.x + n.x * 36}px`;
                add.style.top = `${place.y - rect.y + n.y * 36}px`;
                el.appendChild(add);     // right after its port: CSS hides it once the port is connected
            }

            if (place.port.label !== undefined) {
                el.appendChild(WorkflowEditor.portLabel(place, rect));
            }

            view.ports.set(key, {place, el: portEl});
        }

        return view;
    }

    /** (Re)build one sticky note's element. */
    private renderNote(note: WorkflowNote): void {
        const el = document.createElement('div');
        const text = document.createElement('div');
        const grip = document.createElement('div');

        el.className = 'wf-note';
        el.dataset.wfNote = note.id;
        el.classList.toggle('wf-selected', this.selected.has(note.id));
        if (note.color !== undefined) {
            el.style.setProperty('--wf-note-color', note.color);
        }
        text.className = 'wf-note-text';
        text.textContent = note.text;
        grip.className = 'wf-note-resize';
        grip.dataset.wfResize = note.id;
        el.append(text, grip);

        const old = this.noteViews.get(note.id);

        if (old === undefined) {
            this.noteLayer.appendChild(el);
        } else {
            old.el.replaceWith(el);
        }

        this.noteViews.set(note.id, {el, rect: {x: note.x, y: note.y, w: note.w, h: note.h}});
        this.positionNote(note.id);
    }

    private positionNote(id: string): void {
        const view = this.noteViews.get(id);
        const note = this.model.note(id);

        if (view === undefined || note === undefined) {
            return;
        }

        view.rect = {x: note.x, y: note.y, w: note.w, h: note.h};
        view.el.style.left = `${note.x}px`;
        view.el.style.top = `${note.y}px`;
        view.el.style.width = `${note.w}px`;
        view.el.style.height = `${note.h}px`;
    }

    /** Close the note editor; `keep` stores the text (one undo step) when it changed. */
    private finishNoteEdit(keep: boolean): void {
        const edit = this.noteEdit;

        if (edit === null) {
            return;
        }

        this.noteEdit = null;     // first: removing the textarea fires blur → re-entry
        const text = edit.area.value;
        edit.area.remove();

        if (keep && text !== edit.before && this.model.updateNote(edit.id, {text})) {
            this.renderNote(this.model.note(edit.id)!);
            this.commit('updateNote', [], [], [edit.id]);
        } else if (this.model.note(edit.id) !== undefined) {
            this.renderNote(this.model.note(edit.id)!);
        }
    }

    private hasItem(id: string): boolean {
        return this.nodeViews.has(id) || this.noteViews.has(id);
    }

    private itemEl(id: string): HTMLElement | undefined {
        return this.nodeViews.get(id)?.el ?? this.noteViews.get(id)?.el;
    }

    private static defaultBody(node: WorkflowNodeData, type: WorkflowNodeType | undefined, body: HTMLElement): void {
        const icon = document.createElement('div');
        icon.className = 'wf-node-icon';

        if (typeof type?.icon === 'function') {
            icon.appendChild(type.icon(structuredClone(node)));
        } else {
            icon.textContent = type?.icon ?? (type?.label ?? node.type).slice(0, 1).toUpperCase();
        }

        const text = document.createElement('div');
        text.className = 'wf-node-text';

        const label = document.createElement('div');
        label.className = 'wf-node-label';
        label.textContent = node.label ?? type?.label ?? node.type;
        text.appendChild(label);

        const subText = node.sublabel ?? (node.label !== undefined && type !== undefined ? type.label : undefined);

        if (subText !== undefined) {
            const sub = document.createElement('div');
            sub.className = 'wf-node-sub';
            sub.textContent = subText;
            text.appendChild(sub);
        }

        body.append(icon, text);
    }

    /** A port's label, placed outside the node next to its port. */
    private static portLabel(place: WorkflowPortPlace, rect: RectArea): HTMLSpanElement {
        const span = document.createElement('span');
        const px = place.x - rect.x;
        const py = place.y - rect.y;

        span.className = 'wf-port-label';
        span.textContent = place.port.label ?? '';

        switch (place.side) {
            case 'right':
                span.style.left = `${px + 10}px`;
                span.style.top = `${py - 16}px`;
                break;
            case 'left':
                span.style.right = `${rect.w - px + 10}px`;
                span.style.top = `${py - 16}px`;
                break;
            case 'top':
                span.style.left = `${px + 9}px`;
                span.style.top = `${py - 18}px`;
                break;
            default:
                span.style.left = `${px + 9}px`;
                span.style.top = `${py + 8}px`;
        }

        return span;
    }

    /** Move a node's element to the model position and refresh its port places. */
    private positionNode(id: string): void {
        const view = this.nodeViews.get(id);
        const node = this.model.node(id);

        if (view === undefined || node === undefined) {
            return;
        }

        view.rect.x = node.x;
        view.rect.y = node.y;
        view.el.style.left = `${node.x}px`;
        view.el.style.top = `${node.y}px`;

        const places = WorkflowGeometry.placePorts(view.type, view.rect);

        for (const [key, pv] of view.ports) {
            const place = places.get(key);

            if (place !== undefined) {
                pv.place = place;
            }
        }
    }

    /** Sync the SVG connections with the model (create, update, drop). */
    private renderConnections(): void {
        const seen = new Set<string>();

        for (const view of this.nodeViews.values()) {
            for (const pv of view.ports.values()) {
                pv.el.classList.remove('wf-connected');
            }
        }

        for (const conn of this.model.allConnections()) {
            const a = this.nodeViews.get(conn.from.node);
            const b = this.nodeViews.get(conn.to.node);
            const pa = a?.ports.get(`out:${conn.from.port}`);
            const pb = b?.ports.get(`in:${conn.to.port}`);

            if (a === undefined || b === undefined || pa === undefined || pb === undefined) {
                continue;   // kept in the document, just not drawable
            }

            seen.add(conn.id);
            pa.el.classList.add('wf-connected');
            pb.el.classList.add('wf-connected');

            let cv = this.connViews.get(conn.id);

            if (cv === undefined) {
                cv = this.createConnView(conn.id);
            }

            const {d, mid} = WorkflowGeometry.connectionPath(pa.place, WorkflowEditor.inset(pb.place), a.rect, b.rect);
            cv.hit.setAttribute('d', d);
            cv.path.setAttribute('d', d);
            cv.mid = mid;
            cv.g.classList.toggle('wf-off',
                this.model.node(conn.from.node)?.disabled === true || this.model.node(conn.to.node)?.disabled === true);
            cv.g.classList.toggle('wf-selected', this.selectedConn === conn.id);
            this.applyConnStatus(conn.id, cv, d);
        }

        for (const [id, cv] of this.connViews) {
            if (!seen.has(id)) {
                cv.g.remove();
                cv.label?.remove();
                this.connViews.delete(id);
            }
        }

        this.updateTools();
    }

    /** Tint, item label, travelling dots and run-path dimming of one connection. */
    private applyConnStatus(id: string, cv: ConnView, d: string): void {
        const st = this.connStatus.get(id);
        const conn = this.model.connection(id);
        const text = st?.label ?? (st?.items === undefined ? undefined : WorkflowGeometry.itemsLabel(st.items));

        cv.g.classList.toggle('wf-st-success', st?.status === 'success');
        cv.g.classList.toggle('wf-st-error', st?.status === 'error');
        cv.g.classList.toggle('wf-dim', this.runPath !== null && conn !== undefined
            && !(this.runPath.has(conn.from.node) && this.runPath.has(conn.to.node)));

        if (text === undefined) {
            cv.label?.remove();
            cv.label = null;
        } else {
            if (cv.label === null) {
                cv.label = document.createElement('div');
                cv.label.className = 'wf-conn-label';
                this.labelLayer.appendChild(cv.label);
            }
            cv.label.textContent = text;
            cv.label.dataset.wfStatus = st?.status ?? '';
            cv.label.style.left = `${cv.mid.x}px`;
            cv.label.style.top = `${cv.mid.y}px`;
        }

        if (st?.active !== true) {
            cv.dots?.remove();
            cv.dots = null;
            return;
        }

        if (cv.dots === null) {
            // Three dots a third of a lap apart, each moving along the path (SMIL, no rAF needed).
            cv.dots = document.createElementNS(SVG_NS, 'g');
            cv.dots.classList.add('wf-dots');
            for (let i = 0; i < 3; i++) {
                const dot = document.createElementNS(SVG_NS, 'circle');
                const motion = document.createElementNS(SVG_NS, 'animateMotion');
                dot.setAttribute('r', '3.5');
                motion.setAttribute('dur', '1.2s');
                motion.setAttribute('repeatCount', 'indefinite');
                motion.setAttribute('begin', `${-i * 0.4}s`);
                dot.appendChild(motion);
                cv.dots.appendChild(dot);
            }
            cv.g.appendChild(cv.dots);
        }

        for (const motion of cv.dots.querySelectorAll('animateMotion')) {
            if (motion.getAttribute('path') !== d) {
                motion.setAttribute('path', d);
            }
        }
    }

    /** Show the insert/delete buttons on the hovered (else the selected) connection. */
    private updateTools(): void {
        const id = this.hoveredConn ?? this.selectedConn;
        const cv = id === null ? undefined : this.connViews.get(id);

        if (this.readOnlyFlag || this.gesture !== null || cv === undefined) {
            this.tools.style.display = 'none';
            return;
        }

        this.tools.dataset.wfFor = id!;
        this.tools.style.display = '';
        this.tools.style.left = `${cv.mid.x}px`;
        this.tools.style.top = `${cv.mid.y}px`;
    }

    private createConnView(id: string): ConnView {
        const g = document.createElementNS(SVG_NS, 'g');
        const hit = document.createElementNS(SVG_NS, 'path');
        const path = document.createElementNS(SVG_NS, 'path');

        g.classList.add('wf-conn-g');
        g.dataset.wfConn = id;
        hit.classList.add('wf-conn-hit');
        path.classList.add('wf-conn');
        path.setAttribute('marker-end', `url(#${this.arrowId})`);
        g.append(hit, path);
        this.connLayer.appendChild(g);

        const cv: ConnView = {g, hit, path, mid: {x: 0, y: 0}, label: null, dots: null};
        this.connViews.set(id, cv);

        return cv;
    }

    /** An input end moved out along its side normal, so the arrow tip meets the port edge. */
    private static inset(place: WorkflowPortPlace): WorkflowPortPlace {
        const n = RectBoardGeometry.normal(place.side);

        return {...place, x: place.x + n.x * ARROW_INSET, y: place.y + n.y * ARROW_INSET};
    }

    private applyCamera(): void {
        const {scale, offsetX, offsetY} = this.camera;
        const step = (this.grid > 0 ? this.grid : 20) * scale;

        this.stage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        this.root.style.backgroundSize = `${step}px ${step}px`;
        this.root.style.backgroundPosition = `${offsetX}px ${offsetY}px`;
    }

    private flyTo(state: CameraState, animate: boolean): void {
        if (this.flightFrame !== null) {
            cancelAnimationFrame(this.flightFrame);
            this.flightFrame = null;
        }

        if (!animate || typeof requestAnimationFrame === 'undefined') {
            this.camera.setState(state);
            this.applyCamera();
            return;
        }

        this.camera.flyTo(state, 350);

        const frame = (now: number): void => {
            const more = this.camera.step(now);
            this.applyCamera();
            this.flightFrame = more ? requestAnimationFrame(frame) : null;
        };

        this.flightFrame = requestAnimationFrame(frame);
    }

    // ---- state helpers -------------------------------------------------

    private commit(kind: WorkflowChangeKind, nodes: string[], connections: string[], notes: string[] = []): void {
        this.history.record(this.model.toDocument());
        this.events.emit('change', notes.length > 0
            ? {kind, nodes: [...new Set(nodes)], connections, notes}
            : {kind, nodes: [...new Set(nodes)], connections});
    }

    private restore(doc: WorkflowDocument | undefined, kind: 'undo' | 'redo'): boolean {
        if (doc === undefined) {
            return false;
        }

        this.cancelGesture();
        this.finishNoteEdit(false);
        this.model.load(doc);
        this.renderAll();

        const nodes = new Set([...this.selected].filter((id) => this.hasItem(id)));
        const conn = this.selectedConn !== null && this.connViews.has(this.selectedConn) ? this.selectedConn : null;
        this.setSelection(nodes, conn);
        this.events.emit('change', {kind, nodes: [], connections: []});

        return true;
    }

    /** Drop the elements of removed nodes/notes and fix up the selection. */
    private afterRemove(nodeIds: string[], noteIds: string[] = []): void {
        for (const id of nodeIds) {
            this.nodeViews.get(id)?.el.remove();
            this.nodeViews.delete(id);
        }
        for (const id of noteIds) {
            if (this.noteEdit?.id === id) {
                this.finishNoteEdit(false);
            }
            this.noteViews.get(id)?.el.remove();
            this.noteViews.delete(id);
        }

        this.renderConnections();

        const nodes = new Set([...this.selected].filter((id) => this.hasItem(id)));
        const conn = this.selectedConn !== null && this.connViews.has(this.selectedConn) ? this.selectedConn : null;
        this.setSelection(nodes, conn);
    }

    private setSelection(nodes: Set<string>, conn: string | null): void {
        const same = conn === this.selectedConn && nodes.size === this.selected.size
            && [...nodes].every((id) => this.selected.has(id));

        if (same) {
            return;
        }

        for (const id of this.selected) {
            this.itemEl(id)?.classList.remove('wf-selected');
        }
        for (const id of nodes) {
            this.itemEl(id)?.classList.add('wf-selected');
        }
        if (this.selectedConn !== null) {
            this.connViews.get(this.selectedConn)?.g.classList.remove('wf-selected');
        }
        if (conn !== null) {
            this.connViews.get(conn)?.g.classList.add('wf-selected');
        }

        this.selected = nodes;
        this.selectedConn = conn;
        this.updateTools();
        this.emitSelection();
    }

    private emitSelection(): void {
        this.events.emit('selectionChange', this.getSelection());
    }

    private deleteSelection(): void {
        if (this.selectedConn !== null) {
            this.disconnect(this.selectedConn);
        } else if (this.selected.size > 0) {
            this.remove([...this.selected]);
        }
    }

    // ---- input ---------------------------------------------------------

    private local(e: MouseEvent): RectPoint {
        const r = this.root.getBoundingClientRect();

        return {x: e.clientX - r.left, y: e.clientY - r.top};
    }

    private handleDown(e: PointerEvent): void {
        if (this.gesture !== null) {
            return;
        }

        const p = this.local(e);

        if (e.button === 1) {
            e.preventDefault();
            this.startGesture(e, {kind: 'pan', lastX: p.x, lastY: p.y, startX: p.x, startY: p.y, moved: false});
            return;
        }
        if (e.button !== 0) {
            return;
        }

        const target = e.target as Element;

        // Form fields (a note being edited, inputs in a custom node body) keep their own input.
        if (WorkflowEditor.isField(target)) {
            return;
        }

        this.root.focus({preventScroll: true});

        const addEl = target.closest<HTMLButtonElement>('[data-wf-add]');
        const toolEl = target.closest<HTMLButtonElement>('[data-wf-tool]');

        if (addEl !== null || toolEl !== null) {
            e.stopPropagation();
            if (!this.readOnlyFlag) {
                this.pressButton(e, addEl, toolEl);
            }
            return;
        }

        const portEl = target.closest<HTMLDivElement>('[data-wf-port]');
        const nodeEl = target.closest<HTMLDivElement>('[data-wf-node]');
        const connEl = target.closest<SVGGElement>('[data-wf-conn]');
        const noteEl = target.closest<HTMLDivElement>('[data-wf-note]');
        const gripEl = target.closest<HTMLDivElement>('[data-wf-resize]');

        if (portEl !== null && nodeEl !== null && !this.readOnlyFlag) {
            this.startDraft(e, nodeEl.dataset.wfNode!, portEl.dataset.wfPort!, portEl.dataset.wfDir as WorkflowPortDir);
        } else if (nodeEl !== null) {
            this.startNodePress(e, nodeEl.dataset.wfNode!, p);
        } else if (gripEl !== null && !this.readOnlyFlag) {
            const note = this.model.note(gripEl.dataset.wfResize!)!;
            this.setSelection(new Set([note.id]), null);
            this.startGesture(e, {kind: 'resize', id: note.id, startX: p.x, startY: p.y, w0: note.w, h0: note.h, moved: false});
        } else if (noteEl !== null) {
            this.startNodePress(e, noteEl.dataset.wfNote!, p);
        } else if (connEl !== null) {
            const id = connEl.dataset.wfConn!;
            this.setSelection(new Set(), id);
            this.startGesture(e, {kind: 'conn', id});
        } else if (e.shiftKey) {
            const band = document.createElement('div');
            band.className = 'wf-band';
            this.root.appendChild(band);
            this.startGesture(e, {kind: 'band', start: p, el: band, base: new Set(this.selected)});
            this.updateBand(p);
        } else {
            this.startGesture(e, {kind: 'pan', lastX: p.x, lastY: p.y, startX: p.x, startY: p.y, moved: false});
        }
    }

    private startGesture(e: PointerEvent, gesture: Gesture): void {
        this.gesture = gesture;
        this.root.setPointerCapture(e.pointerId);
        this.updateTools();
    }

    private pressButton(e: PointerEvent, addEl: HTMLButtonElement | null, toolEl: HTMLButtonElement | null): void {
        if (addEl !== null) {
            const nodeId = addEl.closest<HTMLDivElement>('[data-wf-node]')?.dataset.wfNode;
            const dir = addEl.dataset.wfDir as WorkflowPortDir;
            const port = {node: nodeId ?? '', port: addEl.dataset.wfAdd!};
            const place = this.nodeViews.get(port.node)?.ports.get(`${dir}:${port.port}`)?.place;

            if (place !== undefined) {
                this.events.emit('addRequest', {port, dir, at: {x: place.x, y: place.y}, originalEvent: e});
            }
            return;
        }

        const id = this.tools.dataset.wfFor;
        const cv = id === undefined ? undefined : this.connViews.get(id);

        if (id === undefined || cv === undefined) {
            return;
        }
        if (toolEl!.dataset.wfTool === 'delete') {
            this.hoveredConn = null;
            this.disconnect(id);
        } else {
            this.events.emit('insertRequest', {connection: id, at: {...cv.mid}, originalEvent: e});
        }
    }

    private handleOver(e: PointerEvent): void {
        if (this.gesture !== null) {
            return;
        }

        const target = e.target as Element;
        const conn = target.closest<SVGGElement>('[data-wf-conn]');

        if (conn !== null) {
            this.hoveredConn = conn.dataset.wfConn!;
        } else if (target.closest('.wf-conn-tools') === null) {
            this.hoveredConn = null;
        }

        this.updateTools();
    }

    /** Copy/cut/paste while the editor has focus; the clipboard carries a JSON fragment. */
    private handleClipboard(e: ClipboardEvent, kind: 'copy' | 'cut' | 'paste'): void {
        const active = document.activeElement;

        if (active === null || !this.root.contains(active) || this.gesture !== null || WorkflowEditor.isField(active)) {
            return;
        }

        if (kind === 'paste') {
            if (this.readOnlyFlag) {
                return;
            }

            const fragment = WorkflowEditor.parseFragment(e.clipboardData?.getData('text/plain') ?? '');

            if (fragment !== null) {
                e.preventDefault();
                const at = this.lastPointer === null ? undefined : this.camera.toWorld(this.lastPointer.x, this.lastPointer.y);
                this.paste(fragment, at);
            }
            return;
        }

        const fragment = this.copySelection();

        if (fragment === null || e.clipboardData === null) {
            return;
        }

        e.preventDefault();
        e.clipboardData.setData('text/plain', JSON.stringify(fragment));

        if (kind === 'cut' && !this.readOnlyFlag) {
            this.remove([...this.selected], false);
        }
    }

    /** A clipboard text as a fragment, or null when it is not one of ours. */
    public static parseFragment(text: string): WorkflowFragment | null {
        try {
            const data = JSON.parse(text) as Partial<WorkflowFragment>;

            if (data.format === 'jsngraph-workflow' && Array.isArray(data.nodes) && Array.isArray(data.connections)) {
                return data as WorkflowFragment;
            }
        } catch {
            // not JSON — someone else's clipboard
        }

        return null;
    }

    private startNodePress(e: PointerEvent, id: string, p: RectPoint): void {
        const toggle = e.shiftKey || e.ctrlKey || e.metaKey;
        let collapseOnClick = false;

        if (toggle) {
            const next = new Set(this.selected);

            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            this.setSelection(next, null);
        } else if (!this.selected.has(id)) {
            this.setSelection(new Set([id]), null);
        } else {
            collapseOnClick = true;     // a plain click on a multi-selection keeps only this node
        }

        const origins = new Map<string, RectPoint>();

        if (this.selected.has(id)) {
            for (const sid of this.selected) {
                const n = this.model.node(sid) ?? this.model.note(sid);
                if (n !== undefined) {
                    origins.set(sid, {x: n.x, y: n.y});
                }
            }
        }

        this.startGesture(e, {kind: 'node', id, startX: p.x, startY: p.y, origins, moved: false, collapseOnClick});
    }

    private startDraft(e: PointerEvent, nodeId: string, portId: string, dir: WorkflowPortDir): void {
        let anchor: WorkflowPortRef = {node: nodeId, port: portId};
        let anchorDir = dir;
        let rerouting: string | null = null;

        // Grabbing a connected input picks its (last) connection up again.
        if (dir === 'in') {
            const attached = this.model.connectionsOf(nodeId, 'in', portId);
            const last = attached[attached.length - 1];

            if (last !== undefined && this.connViews.has(last.id)) {
                rerouting = last.id;
                anchor = {...last.from};
                anchorDir = 'out';
                this.connViews.get(last.id)!.g.style.display = 'none';
            }
        }

        const valid = new Set<string>();
        const wantDir: WorkflowPortDir = anchorDir === 'out' ? 'in' : 'out';

        for (const [nid, view] of this.nodeViews) {
            for (const pv of view.ports.values()) {
                if (pv.place.dir !== wantDir) {
                    continue;
                }

                const ref = {node: nid, port: pv.place.port.id};
                const reason = anchorDir === 'out'
                    ? this.model.validate(anchor, ref, rerouting ?? undefined)
                    : this.model.validate(ref, anchor, rerouting ?? undefined);

                if (reason === null) {
                    valid.add(WorkflowEditor.refKey(ref));
                    pv.el.classList.add('wf-port-valid');
                }
            }
        }

        this.root.classList.add('wf-drafting');
        this.draftPath.style.display = '';
        this.startGesture(e, {kind: 'draft', anchor, anchorDir, rerouting, valid, target: null, overNode: null});
        this.updateDraft(e);
    }

    private handleMove(e: PointerEvent): void {
        const g = this.gesture;
        const p = this.local(e);

        this.lastPointer = p;

        if (g === null) {
            return;
        }

        switch (g.kind) {
            case 'pan': {
                if (!g.moved && Math.hypot(p.x - g.startX, p.y - g.startY) < CLICK_SLOP) {
                    return;
                }
                g.moved = true;
                this.userMoved = true;
                this.root.classList.add('wf-panning');
                this.camera.panBy(p.x - g.lastX, p.y - g.lastY);
                g.lastX = p.x;
                g.lastY = p.y;
                this.applyCamera();
                break;
            }
            case 'node': {
                if (this.readOnlyFlag || g.origins.size === 0) {
                    return;
                }
                if (!g.moved && Math.hypot(p.x - g.startX, p.y - g.startY) < CLICK_SLOP) {
                    return;
                }
                g.moved = true;
                this.dragNodes(g, p, e.altKey);
                break;
            }
            case 'draft':
                this.updateDraft(e);
                break;
            case 'band':
                this.updateBand(p);
                break;
            case 'resize': {
                const s = this.camera.scale;
                const step = e.altKey ? 0 : this.grid;
                const w = Math.max(120, RectBoardGeometry.snap(g.w0 + (p.x - g.startX) / s, step));
                const h = Math.max(60, RectBoardGeometry.snap(g.h0 + (p.y - g.startY) / s, step));

                g.moved = true;
                this.model.updateNote(g.id, {w, h});
                this.positionNote(g.id);
                break;
            }
            default:
                break;
        }
    }

    /** A move of the given items (nodes and/or notes) to origin + delta. */
    private placeItems(origins: Map<string, RectPoint>, dx: number, dy: number): void {
        for (const [id, o] of origins) {
            if (this.model.node(id) !== undefined) {
                this.model.moveNode(id, o.x + dx, o.y + dy);
                this.positionNode(id);
            } else if (this.model.updateNote(id, {x: o.x + dx, y: o.y + dy})) {
                this.positionNote(id);
            }
        }

        this.renderConnections();
    }

    private dragNodes(g: Extract<Gesture, {kind: 'node'}>, p: RectPoint, free: boolean): void {
        const lead = g.origins.get(g.id);

        if (lead === undefined) {
            return;
        }

        const s = this.camera.scale;
        const rawX = lead.x + (p.x - g.startX) / s;
        const rawY = lead.y + (p.y - g.startY) / s;
        const step = free ? 0 : this.grid;
        // Snap the grabbed node; the rest of the selection keeps its offsets.
        const dx = RectBoardGeometry.snap(rawX, step) - lead.x;
        const dy = RectBoardGeometry.snap(rawY, step) - lead.y;

        this.placeItems(g.origins, dx, dy);
    }

    private updateDraft(e: PointerEvent): void {
        const g = this.gesture;

        if (g === null || g.kind !== 'draft') {
            return;
        }

        const target = this.findDraftTarget(e, g);

        if (g.target?.el !== target?.el) {
            g.target?.el.classList.remove('wf-port-target');
            target?.el.classList.add('wf-port-target');
        }
        g.target = target;

        const anchorView = this.nodeViews.get(g.anchor.node);
        const anchorPort = anchorView?.ports.get(`${g.anchorDir}:${g.anchor.port}`);

        if (anchorView === undefined || anchorPort === undefined) {
            return;
        }

        const cursor = this.camera.toWorld(this.local(e).x, this.local(e).y);
        let otherPlace: WorkflowPortPlace | null = null;
        let otherRect: RectArea | undefined;

        if (target !== null) {
            const tv = this.nodeViews.get(target.ref.node);
            const dir: WorkflowPortDir = g.anchorDir === 'out' ? 'in' : 'out';
            otherPlace = tv?.ports.get(`${dir}:${target.ref.port}`)?.place ?? null;
            otherRect = tv?.rect;
        }

        let d: string;

        if (g.anchorDir === 'out') {
            d = otherPlace === null
                ? WorkflowGeometry.connectionPath(anchorPort.place, cursor).d
                : WorkflowGeometry.connectionPath(anchorPort.place, WorkflowEditor.inset(otherPlace), anchorView.rect, otherRect).d;
        } else {
            d = otherPlace === null
                ? WorkflowGeometry.connectionPath(cursor, WorkflowEditor.inset(anchorPort.place)).d
                : WorkflowGeometry.connectionPath(otherPlace, WorkflowEditor.inset(anchorPort.place), otherRect, anchorView.rect).d;
        }

        this.draftPath.setAttribute('d', d);
        this.draftPath.classList.toggle('wf-ok', target !== null);
    }

    /** The valid port under the cursor, or the first compatible port of the node under it. */
    private findDraftTarget(e: PointerEvent, g: Extract<Gesture, {kind: 'draft'}>): DraftTarget | null {
        g.overNode = null;

        const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(e.clientX, e.clientY) : null;

        if (hit === null || !this.root.contains(hit)) {
            return null;
        }

        const nodeEl = hit.closest<HTMLDivElement>('[data-wf-node]');

        if (nodeEl === null) {
            return null;
        }

        const nodeId = nodeEl.dataset.wfNode!;
        const view = this.nodeViews.get(nodeId)!;
        const wantDir: WorkflowPortDir = g.anchorDir === 'out' ? 'in' : 'out';
        const portEl = hit.closest<HTMLDivElement>('[data-wf-port]');

        g.overNode = nodeId;

        if (portEl !== null && portEl.dataset.wfDir === wantDir) {
            const ref = {node: nodeId, port: portEl.dataset.wfPort!};

            return g.valid.has(WorkflowEditor.refKey(ref)) ? {ref, el: portEl} : null;
        }

        for (const pv of view.ports.values()) {
            const ref = {node: nodeId, port: pv.place.port.id};

            if (pv.place.dir === wantDir && g.valid.has(WorkflowEditor.refKey(ref))) {
                return {ref, el: pv.el};
            }
        }

        return null;
    }

    private updateBand(p: RectPoint): void {
        const g = this.gesture;

        if (g === null || g.kind !== 'band') {
            return;
        }

        const screen = RectBoardGeometry.fromCorners(g.start, p);
        g.el.style.left = `${screen.x}px`;
        g.el.style.top = `${screen.y}px`;
        g.el.style.width = `${screen.w}px`;
        g.el.style.height = `${screen.h}px`;

        const a = this.camera.toWorld(screen.x, screen.y);
        const b = this.camera.toWorld(screen.x + screen.w, screen.y + screen.h);
        const world = RectBoardGeometry.fromCorners(a, b);
        const next = new Set(g.base);

        for (const [id, view] of this.nodeViews) {
            if (RectBoardGeometry.overlaps(world, view.rect)) {
                next.add(id);
            }
        }
        // Notes are big backdrops: only a band around the whole note picks it.
        for (const [id, view] of this.noteViews) {
            if (RectBoardGeometry.contains(world, view.rect)) {
                next.add(id);
            }
        }

        this.setSelection(next, null);
    }

    private handleUp(e: PointerEvent): void {
        const g = this.gesture;

        if (g === null) {
            return;
        }

        this.gesture = null;
        if (this.root.hasPointerCapture(e.pointerId)) {
            this.root.releasePointerCapture(e.pointerId);
        }
        this.root.classList.remove('wf-panning');
        this.updateTools();

        switch (g.kind) {
            case 'pan':
                if (!g.moved && e.type === 'pointerup' && e.button === 0) {
                    this.setSelection(new Set(), null);
                    const w = this.camera.toWorld(g.startX, g.startY);
                    this.events.emit('backgroundClick', {x: w.x, y: w.y, originalEvent: e});
                }
                break;
            case 'node':
                if (g.moved) {
                    const ids = [...g.origins.keys()];
                    this.commit('move', ids.filter((id) => this.nodeViews.has(id)), [], ids.filter((id) => this.noteViews.has(id)));
                } else if (e.type === 'pointerup') {
                    if (g.collapseOnClick) {
                        this.setSelection(new Set([g.id]), null);
                    }
                    if (this.nodeViews.has(g.id)) {
                        this.events.emit('nodeClick', {id: g.id, originalEvent: e});
                    }
                }
                break;
            case 'resize':
                if (g.moved) {
                    this.commit('updateNote', [], [], [g.id]);
                }
                break;
            case 'conn':
                if (e.type === 'pointerup') {
                    this.events.emit('connectionClick', {id: g.id, originalEvent: e});
                }
                break;
            case 'draft':
                this.finishDraft(g, e.type === 'pointerup');
                break;
            case 'band':
                g.el.remove();
                break;
        }
    }

    private finishDraft(g: Extract<Gesture, {kind: 'draft'}>, drop: boolean): void {
        this.clearDraftUi(g);

        const target = drop ? g.target : null;

        if (target === null) {
            if (drop && g.overNode !== null && g.overNode !== g.anchor.node) {
                const wantDir: WorkflowPortDir = g.anchorDir === 'out' ? 'in' : 'out';
                const first = this.model.ports(g.overNode, wantDir)[0];
                const ref = {node: g.overNode, port: first?.id ?? ''};
                const from = g.anchorDir === 'out' ? g.anchor : ref;
                const to = g.anchorDir === 'out' ? ref : g.anchor;
                const reason = first === undefined
                    ? 'no compatible port'
                    : (this.model.validate(from, to, g.rerouting ?? undefined) ?? 'no compatible port');

                this.events.emit('connectRefused', {from, to, reason});
            }

            if (g.rerouting !== null && drop) {
                const conn = this.model.connection(g.rerouting)!;
                this.model.disconnect(g.rerouting);
                this.renderConnections();
                this.commit('disconnect', [conn.from.node, conn.to.node], [g.rerouting]);
            } else {
                this.renderConnections();
            }
            return;
        }

        const from = g.anchorDir === 'out' ? g.anchor : target.ref;
        const to = g.anchorDir === 'out' ? target.ref : g.anchor;

        if (g.rerouting !== null) {
            const before = this.model.connection(g.rerouting)!;
            const touched = [before.from.node, before.to.node, from.node, to.node];
            const unchanged = WorkflowModel.sameRef(before.from, from) && WorkflowModel.sameRef(before.to, to);

            if (!unchanged) {
                this.model.reconnect(g.rerouting, from, to);
            }
            this.renderConnections();
            if (!unchanged) {
                this.commit('reconnect', touched, [g.rerouting]);
            }
            return;
        }

        const conn = this.model.connect(from, to);
        this.renderConnections();
        this.commit('connect', [from.node, to.node], [conn.id]);
    }

    private clearDraftUi(g: Extract<Gesture, {kind: 'draft'}>): void {
        this.root.classList.remove('wf-drafting');
        this.draftPath.style.display = 'none';
        this.draftPath.classList.remove('wf-ok');
        g.target?.el.classList.remove('wf-port-target');

        for (const view of this.nodeViews.values()) {
            for (const pv of view.ports.values()) {
                pv.el.classList.remove('wf-port-valid');
            }
        }
        if (g.rerouting !== null) {
            const cv = this.connViews.get(g.rerouting);
            if (cv !== undefined) {
                cv.g.style.display = '';
            }
        }
    }

    /** Abort a running gesture without committing (programmatic changes, Escape). */
    private cancelGesture(): void {
        const g = this.gesture;

        if (g === null) {
            return;
        }

        this.gesture = null;
        this.root.classList.remove('wf-panning');

        if (g.kind === 'draft') {
            this.clearDraftUi(g);
            this.renderConnections();
        } else if (g.kind === 'band') {
            g.el.remove();
        } else if (g.kind === 'node' && g.moved) {
            this.placeItems(g.origins, 0, 0);
        } else if (g.kind === 'resize' && g.moved) {
            this.model.updateNote(g.id, {w: g.w0, h: g.h0});
            this.positionNote(g.id);
        }
    }

    private handleWheel(e: WheelEvent): void {
        e.preventDefault();

        const p = this.local(e);
        // Pinch gestures arrive as ctrl+wheel with small deltas.
        const k = e.ctrlKey ? 0.01 : 0.0015;
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;

        this.userMoved = true;
        this.camera.zoomAt(p.x, p.y, Math.exp(-delta * k));
        this.applyCamera();
    }

    private handleDblClick(e: MouseEvent): void {
        // The press captured the pointer on the root, so the event's target is
        // the root: look up what is really under the cursor.
        const under = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(e.clientX, e.clientY) : null;
        const target = (under !== null && this.root.contains(under) ? under : e.target) as Element;
        const noteEl = target.closest<HTMLDivElement>('[data-wf-note]');

        if (WorkflowEditor.isField(target)) {
            return;
        }
        if (noteEl !== null) {
            this.editNote(noteEl.dataset.wfNote!);
            return;
        }

        const nodeEl = target.closest<HTMLDivElement>('[data-wf-node]');

        if (nodeEl !== null && target.closest('[data-wf-port]') === null) {
            this.events.emit('nodeDblClick', {id: nodeEl.dataset.wfNode!, originalEvent: e});
        }
    }

    private handleKey(e: KeyboardEvent): void {
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();

        if (WorkflowEditor.isField(e.target as Element)) {
            return;
        }

        if (key === 'escape') {
            if (this.gesture !== null) {
                this.cancelGesture();
            } else {
                this.clearSelection();
            }
            return;
        }
        if (mod && key === 'a') {
            e.preventDefault();
            this.select([...this.nodeViews.keys(), ...this.noteViews.keys()]);
            return;
        }
        if (this.readOnlyFlag || this.gesture !== null) {
            return;
        }
        if (key === 'delete' || key === 'backspace') {
            e.preventDefault();
            this.deleteSelection();
        } else if (mod && key === 'z' && !e.shiftKey) {
            e.preventDefault();
            this.undo();
        } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
            e.preventDefault();
            this.redo();
        } else if (mod && key === 'd') {
            e.preventDefault();
            this.duplicateSelection();
        } else if (!mod && !e.altKey && key === 'd' && this.selected.size > 0) {
            e.preventDefault();
            this.setDisabled(this.selected);
        }
    }

    /** Text inputs and editable content: the editor leaves their keys and clicks alone. */
    private static isField(el: Element | null): boolean {
        return el !== null && el.closest('textarea, input, select, [contenteditable=""], [contenteditable="true"]') !== null;
    }

    private static refKey(ref: WorkflowPortRef): string {
        return `${ref.node}\u0000${ref.port}`;
    }

}
