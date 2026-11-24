import { EventEmitter } from '../util/EventEmitter';
import { RectArea, RectBoardGeometry, RectPoint } from '../rect/RectBoardGeometry';
import { WorkflowConnections } from './WorkflowConnections';
import type { WorkflowEditor } from './WorkflowEditor';
import { WorkflowGeometry, WorkflowPortPlace } from './WorkflowGeometry';
import { WorkflowModel } from './WorkflowModel';
import { WorkflowRenderer } from './WorkflowRenderer';
import { WorkflowViewport } from './WorkflowViewport';
import { WorkflowChangeKind, WorkflowEditorEvents, WorkflowPortDir, WorkflowPortRef } from './WorkflowTypes';

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

/** What the gestures need from the editor beyond its public API. */
export interface WorkflowGesturesHost {
    readonly model: WorkflowModel;
    readonly root: HTMLDivElement;
    readonly grid: number;
    readonly events: EventEmitter<WorkflowEditorEvents>;
    /** The `editConnectionLabels` option. */
    readonly editConnectionLabels: boolean;
    /** A tidy-up is animating: presses wait. */
    busy(): boolean;
    selection(): ReadonlySet<string>;
    setSelection(items: Set<string>, connection: string | null): void;
    commit(kind: WorkflowChangeKind, nodes: string[], connections: string[], notes?: string[], groups?: string[]): void;
}

/**
 * Pointer input of the workflow editor (internal): press/drag/release
 * gestures (pan, move with grid snap, note resize, connect and reroute
 * drafts, band select), the "+"/tool buttons, hover, wheel zoom,
 * and double-click actions.
 */
export class WorkflowGestures {

    /** Screen px a press may travel before it counts as a drag instead of a click. */
    private static readonly CLICK_SLOP = 3;

    private gesture: Gesture | null = null;
    /** Last pointer position (root-local px) while the pointer is over the editor. */
    private lastPointer: RectPoint | null = null;

    private readonly onDown = (e: PointerEvent): void => this.handleDown(e);
    private readonly onMove = (e: PointerEvent): void => this.handleMove(e);
    private readonly onUp = (e: PointerEvent): void => this.handleUp(e);
    private readonly onWheel = (e: WheelEvent): void => this.handleWheel(e);
    private readonly onDbl = (e: MouseEvent): void => this.handleDblClick(e);
    private readonly onOver = (e: PointerEvent): void => this.handleOver(e);
    private readonly onLeave = (): void => {
        this.lastPointer = null;
        this.connections.hovered = null;
        this.connections.updateTools();
    };

    public constructor(
        private readonly host: WorkflowGesturesHost,
        private readonly editor: WorkflowEditor,
        private readonly scene: WorkflowRenderer,
        private readonly connections: WorkflowConnections,
        private readonly viewport: WorkflowViewport
    ) {
        const root = host.root;

        root.addEventListener('pointerdown', this.onDown);
        root.addEventListener('pointermove', this.onMove);
        root.addEventListener('pointerup', this.onUp);
        root.addEventListener('pointercancel', this.onUp);
        root.addEventListener('wheel', this.onWheel, {passive: false});
        root.addEventListener('dblclick', this.onDbl);
        root.addEventListener('pointerover', this.onOver);
        root.addEventListener('pointerleave', this.onLeave);
    }

    /** A press/drag gesture is running. */
    public get active(): boolean {
        return this.gesture !== null;
    }

    /** Last pointer position (root-local px) while over the editor, or null. */
    public get pointer(): RectPoint | null {
        return this.lastPointer;
    }

    public destroy(): void {
        const root = this.host.root;

        root.removeEventListener('pointerdown', this.onDown);
        root.removeEventListener('pointermove', this.onMove);
        root.removeEventListener('pointerup', this.onUp);
        root.removeEventListener('pointercancel', this.onUp);
        root.removeEventListener('wheel', this.onWheel);
        root.removeEventListener('dblclick', this.onDbl);
        root.removeEventListener('pointerover', this.onOver);
        root.removeEventListener('pointerleave', this.onLeave);
    }

    /** Text inputs and editable content: the editor leaves their keys and clicks alone. */
    public static isField(el: Element | null): boolean {
        return el !== null && el.closest('textarea, input, select, [contenteditable=""], [contenteditable="true"]') !== null;
    }

    /** A button, link, label or `data-wf-interactive` element inside a custom node body. */
    public static isBodyControl(el: Element | null): boolean {
        return el !== null && el.closest('.wf-node-custom') !== null
            && el.closest('button, a[href], label, [data-wf-interactive]') !== null;
    }

    private static refKey(ref: WorkflowPortRef): string {
        return `${ref.node}\u0000${ref.port}`;
    }

    // ---- press ---------------------------------------------------------

    private handleDown(e: PointerEvent): void {
        if (this.gesture !== null || this.host.busy()) {
            return;
        }

        const p = this.viewport.local(e);

        if (e.button === 1) {
            e.preventDefault();
            this.startGesture(e, {kind: 'pan', lastX: p.x, lastY: p.y, startX: p.x, startY: p.y, moved: false});
            return;
        }
        if (e.button !== 0) {
            return;
        }

        const target = e.target as Element;
        const readOnly = this.editor.readOnly;

        // Form fields (a note being edited, inputs in a custom node body) and
        // controls in a custom body (buttons, links, data-wf-interactive) keep their own input.
        if (WorkflowGestures.isField(target) || WorkflowGestures.isBodyControl(target)) {
            return;
        }

        this.host.root.focus({preventScroll: true});

        const addEl = target.closest<HTMLButtonElement>('[data-wf-add]');
        const toolEl = target.closest<HTMLButtonElement>('[data-wf-tool]');

        if (addEl !== null || toolEl !== null) {
            e.stopPropagation();
            if (!readOnly) {
                this.pressButton(e, addEl, toolEl);
            }
            return;
        }

        const bypassEl = target.closest<HTMLButtonElement>('[data-wf-group-bypass]');

        if (bypassEl !== null) {
            e.stopPropagation();
            if (!readOnly) {
                this.editor.setDisabled([bypassEl.dataset.wfGroupBypass!]);
            }
            return;
        }

        const toggleEl = target.closest<HTMLButtonElement>('[data-wf-group-toggle]');

        if (toggleEl !== null) {
            e.stopPropagation();
            this.editor.toggleGroup(toggleEl.dataset.wfGroupToggle!);   // also in the viewer
            return;
        }

        const headEl = target.closest<HTMLDivElement>('[data-wf-group-head]');

        if (headEl !== null) {
            this.startNodePress(e, headEl.dataset.wfGroupHead!, p);
            return;
        }

        const portEl = target.closest<HTMLDivElement>('[data-wf-port]');
        const nodeEl = target.closest<HTMLDivElement>('[data-wf-node]');
        const connEl = target.closest<SVGGElement>('[data-wf-conn]');
        const noteEl = target.closest<HTMLDivElement>('[data-wf-note]');
        const gripEl = target.closest<HTMLDivElement>('[data-wf-resize]');

        if (portEl !== null && nodeEl !== null && !readOnly) {
            this.startDraft(e, nodeEl.dataset.wfNode!, portEl.dataset.wfPort!, portEl.dataset.wfDir as WorkflowPortDir);
        } else if (nodeEl !== null) {
            this.startNodePress(e, nodeEl.dataset.wfNode!, p);
        } else if (gripEl !== null && !readOnly) {
            const note = this.host.model.note(gripEl.dataset.wfResize!)!;
            this.host.setSelection(new Set([note.id]), null);
            this.startGesture(e, {kind: 'resize', id: note.id, startX: p.x, startY: p.y, w0: note.w, h0: note.h, moved: false});
        } else if (noteEl !== null) {
            this.startNodePress(e, noteEl.dataset.wfNote!, p);
        } else if (connEl !== null) {
            const id = connEl.dataset.wfConn!;
            this.host.setSelection(new Set(), id);
            this.startGesture(e, {kind: 'conn', id});
        } else if (e.shiftKey) {
            const band = document.createElement('div');
            band.className = 'wf-band';
            this.host.root.appendChild(band);
            this.startGesture(e, {kind: 'band', start: p, el: band, base: new Set(this.host.selection())});
            this.updateBand(p);
        } else {
            this.startGesture(e, {kind: 'pan', lastX: p.x, lastY: p.y, startX: p.x, startY: p.y, moved: false});
        }
    }

    private startGesture(e: PointerEvent, gesture: Gesture): void {
        this.gesture = gesture;
        this.host.root.setPointerCapture(e.pointerId);
        this.connections.updateTools();
    }

    private pressButton(e: PointerEvent, addEl: HTMLButtonElement | null, toolEl: HTMLButtonElement | null): void {
        if (addEl !== null) {
            const nodeId = addEl.closest<HTMLDivElement>('[data-wf-node]')?.dataset.wfNode;
            const dir = addEl.dataset.wfDir as WorkflowPortDir;
            const port = {node: nodeId ?? '', port: addEl.dataset.wfAdd!};
            const place = this.scene.nodeViews.get(port.node)?.ports.get(`${dir}:${port.port}`)?.place;

            if (place !== undefined) {
                this.host.events.emit('addRequest', {port, dir, at: {x: place.x, y: place.y}, originalEvent: e});
            }
            return;
        }

        const id = this.scene.tools.dataset.wfFor;
        const cv = id === undefined ? undefined : this.connections.views.get(id);

        if (id === undefined || cv === undefined) {
            return;
        }
        if (toolEl!.dataset.wfTool === 'delete') {
            this.connections.hovered = null;
            this.editor.disconnect(id);
        } else {
            this.host.events.emit('insertRequest', {connection: id, at: {...cv.mid}, originalEvent: e});
        }
    }

    private handleOver(e: PointerEvent): void {
        if (this.gesture !== null) {
            return;
        }

        const target = e.target as Element;
        const conn = target.closest<SVGGElement>('[data-wf-conn]');

        if (conn !== null) {
            this.connections.hovered = conn.dataset.wfConn!;
        } else if (target.closest('.wf-conn-tools') === null) {
            this.connections.hovered = null;
        }

        this.connections.updateTools();
    }

    private startNodePress(e: PointerEvent, id: string, p: RectPoint): void {
        const model = this.host.model;
        const toggle = e.shiftKey || e.ctrlKey || e.metaKey;
        let collapseOnClick = false;

        if (toggle) {
            const next = new Set(this.host.selection());

            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            this.host.setSelection(next, null);
        } else if (!this.host.selection().has(id)) {
            this.host.setSelection(new Set([id]), null);
        } else {
            collapseOnClick = true;     // a plain click on a multi-selection keeps only this node
        }

        const origins = new Map<string, RectPoint>();
        const selected = this.host.selection();

        if (selected.has(id)) {
            for (const sid of selected) {
                const n = model.node(sid) ?? model.note(sid) ?? this.groupCorner(sid);
                if (n !== undefined) {
                    origins.set(sid, {x: n.x, y: n.y});
                }
                // A group moves with its members.
                for (const m of model.group(sid) === undefined ? [] : model.members(sid)) {
                    const node = model.node(m)!;
                    origins.set(m, {x: node.x, y: node.y});
                }
            }
        }

        this.startGesture(e, {kind: 'node', id, startX: p.x, startY: p.y, origins, moved: false, collapseOnClick});
    }

    /** A group's handle for dragging: the top-left of its frame or collapsed node. */
    private groupCorner(id: string): RectPoint | undefined {
        const rect = this.scene.groupViews.get(id)?.rect
            ?? (this.host.model.group(id) === undefined ? undefined : this.scene.nodeViews.get(id)?.rect);

        return rect === undefined ? undefined : {x: rect.x, y: rect.y};
    }

    private startDraft(e: PointerEvent, nodeId: string, portId: string, dir: WorkflowPortDir): void {
        const model = this.host.model;
        let anchor: WorkflowPortRef = {node: nodeId, port: portId};
        let anchorDir = dir;
        let rerouting: string | null = null;

        // Grabbing a connected input picks its (last) connection up again.
        if (dir === 'in') {
            const attached = model.connectionsOf(nodeId, 'in', portId);
            const last = attached[attached.length - 1];

            if (last !== undefined && this.connections.views.has(last.id)) {
                rerouting = last.id;
                anchor = {...last.from};
                anchorDir = 'out';
                this.connections.views.get(last.id)!.g.style.display = 'none';
            }
        }

        const valid = new Set<string>();
        const wantDir: WorkflowPortDir = anchorDir === 'out' ? 'in' : 'out';

        for (const [nid, view] of this.scene.nodeViews) {
            for (const pv of view.ports.values()) {
                if (pv.place.dir !== wantDir) {
                    continue;
                }

                const ref = {node: nid, port: pv.place.port.id};
                const reason = anchorDir === 'out'
                    ? model.validate(anchor, ref, rerouting ?? undefined)
                    : model.validate(ref, anchor, rerouting ?? undefined);

                if (reason === null) {
                    valid.add(WorkflowGestures.refKey(ref));
                    pv.el.classList.add('wf-port-valid');
                }
            }
        }

        this.host.root.classList.add('wf-drafting');
        this.scene.draftPath.style.display = '';
        this.startGesture(e, {kind: 'draft', anchor, anchorDir, rerouting, valid, target: null, overNode: null});
        this.updateDraft(e);
    }

    // ---- drag ----------------------------------------------------------

    private handleMove(e: PointerEvent): void {
        const g = this.gesture;
        const p = this.viewport.local(e);

        this.lastPointer = p;

        if (g === null) {
            return;
        }

        switch (g.kind) {
            case 'pan': {
                if (!g.moved && Math.hypot(p.x - g.startX, p.y - g.startY) < WorkflowGestures.CLICK_SLOP) {
                    return;
                }
                g.moved = true;
                this.host.root.classList.add('wf-panning');
                this.viewport.panBy(p.x - g.lastX, p.y - g.lastY);
                g.lastX = p.x;
                g.lastY = p.y;
                break;
            }
            case 'node': {
                if (this.editor.readOnly || g.origins.size === 0) {
                    return;
                }
                if (!g.moved && Math.hypot(p.x - g.startX, p.y - g.startY) < WorkflowGestures.CLICK_SLOP) {
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
                const s = this.viewport.camera.scale;
                const step = e.altKey ? 0 : this.host.grid;
                const w = Math.max(120, RectBoardGeometry.snap(g.w0 + (p.x - g.startX) / s, step));
                const h = Math.max(60, RectBoardGeometry.snap(g.h0 + (p.y - g.startY) / s, step));

                g.moved = true;
                this.host.model.updateNote(g.id, {w, h});
                this.scene.positionNote(g.id);
                break;
            }
            default:
                break;
        }
    }

    /** A move of the given items (nodes and/or notes) to origin + delta. */
    private placeItems(origins: Map<string, RectPoint>, dx: number, dy: number): void {
        const model = this.host.model;

        for (const [id, o] of origins) {
            if (model.node(id) !== undefined) {
                model.moveNode(id, o.x + dx, o.y + dy);
                this.scene.positionNode(id);
            } else if (model.updateNote(id, {x: o.x + dx, y: o.y + dy})) {
                this.scene.positionNote(id);
            }
        }

        this.connections.render();
    }

    private dragNodes(g: Extract<Gesture, {kind: 'node'}>, p: RectPoint, free: boolean): void {
        const lead = g.origins.get(g.id);

        if (lead === undefined) {
            return;
        }

        const s = this.viewport.camera.scale;
        const rawX = lead.x + (p.x - g.startX) / s;
        const rawY = lead.y + (p.y - g.startY) / s;
        const step = free ? 0 : this.host.grid;
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

        const anchorView = this.scene.nodeViews.get(g.anchor.node);
        const anchorPort = anchorView?.ports.get(`${g.anchorDir}:${g.anchor.port}`);

        if (anchorView === undefined || anchorPort === undefined) {
            return;
        }

        const local = this.viewport.local(e);
        const cursor = this.viewport.camera.toWorld(local.x, local.y);
        let otherPlace: WorkflowPortPlace | null = null;
        let otherRect: RectArea | undefined;

        if (target !== null) {
            const tv = this.scene.nodeViews.get(target.ref.node);
            const dir: WorkflowPortDir = g.anchorDir === 'out' ? 'in' : 'out';
            otherPlace = tv?.ports.get(`${dir}:${target.ref.port}`)?.place ?? null;
            otherRect = tv?.rect;
        }

        let d: string;

        if (g.anchorDir === 'out') {
            d = otherPlace === null
                ? WorkflowGeometry.connectionPath(anchorPort.place, cursor).d
                : WorkflowGeometry.connectionPath(anchorPort.place, WorkflowConnections.inset(otherPlace), anchorView.rect, otherRect).d;
        } else {
            d = otherPlace === null
                ? WorkflowGeometry.connectionPath(cursor, WorkflowConnections.inset(anchorPort.place)).d
                : WorkflowGeometry.connectionPath(otherPlace, WorkflowConnections.inset(anchorPort.place), otherRect, anchorView.rect).d;
        }

        this.scene.draftPath.setAttribute('d', d);
        this.scene.draftPath.classList.toggle('wf-ok', target !== null);
    }

    /** The valid port under the cursor, or the first compatible port of the node under it. */
    private findDraftTarget(e: PointerEvent, g: Extract<Gesture, {kind: 'draft'}>): DraftTarget | null {
        g.overNode = null;

        const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(e.clientX, e.clientY) : null;

        if (hit === null || !this.host.root.contains(hit)) {
            return null;
        }

        const nodeEl = hit.closest<HTMLDivElement>('[data-wf-node]');

        if (nodeEl === null) {
            return null;
        }

        const nodeId = nodeEl.dataset.wfNode!;
        const view = this.scene.nodeViews.get(nodeId)!;
        const wantDir: WorkflowPortDir = g.anchorDir === 'out' ? 'in' : 'out';
        const portEl = hit.closest<HTMLDivElement>('[data-wf-port]');

        g.overNode = nodeId;

        if (portEl !== null && portEl.dataset.wfDir === wantDir) {
            const ref = {node: nodeId, port: portEl.dataset.wfPort!};

            return g.valid.has(WorkflowGestures.refKey(ref)) ? {ref, el: portEl} : null;
        }

        for (const pv of view.ports.values()) {
            const ref = {node: nodeId, port: pv.place.port.id};

            if (pv.place.dir === wantDir && g.valid.has(WorkflowGestures.refKey(ref))) {
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

        const camera = this.viewport.camera;
        const screen = RectBoardGeometry.fromCorners(g.start, p);
        g.el.style.left = `${screen.x}px`;
        g.el.style.top = `${screen.y}px`;
        g.el.style.width = `${screen.w}px`;
        g.el.style.height = `${screen.h}px`;

        const a = camera.toWorld(screen.x, screen.y);
        const b = camera.toWorld(screen.x + screen.w, screen.y + screen.h);
        const world = RectBoardGeometry.fromCorners(a, b);
        const next = new Set(g.base);

        for (const [id, view] of this.scene.nodeViews) {
            if (RectBoardGeometry.overlaps(world, view.rect)) {
                next.add(id);
            }
        }
        // Notes are big backdrops: only a band around the whole note picks it.
        for (const [id, view] of this.scene.noteViews) {
            if (RectBoardGeometry.contains(world, view.rect)) {
                next.add(id);
            }
        }

        this.host.setSelection(next, null);
    }

    // ---- release -------------------------------------------------------

    private handleUp(e: PointerEvent): void {
        const g = this.gesture;
        const model = this.host.model;

        if (g === null) {
            return;
        }

        this.gesture = null;
        if (this.host.root.hasPointerCapture(e.pointerId)) {
            this.host.root.releasePointerCapture(e.pointerId);
        }
        this.host.root.classList.remove('wf-panning');
        this.connections.updateTools();

        switch (g.kind) {
            case 'pan':
                if (!g.moved && e.type === 'pointerup' && e.button === 0) {
                    this.host.setSelection(new Set(), null);
                    const w = this.viewport.camera.toWorld(g.startX, g.startY);
                    this.host.events.emit('backgroundClick', {x: w.x, y: w.y, originalEvent: e});
                }
                break;
            case 'node':
                if (g.moved) {
                    const ids = [...g.origins.keys()];
                    this.host.commit('move', ids.filter((id) => model.node(id) !== undefined), [],
                        ids.filter((id) => model.note(id) !== undefined), ids.filter((id) => model.group(id) !== undefined));
                } else if (e.type === 'pointerup') {
                    if (g.collapseOnClick) {
                        this.host.setSelection(new Set([g.id]), null);
                    }
                    if (model.node(g.id) !== undefined) {
                        this.host.events.emit('nodeClick', {id: g.id, originalEvent: e});
                    }
                }
                break;
            case 'resize':
                if (g.moved) {
                    this.host.commit('updateNote', [], [], [g.id]);
                }
                break;
            case 'conn':
                if (e.type === 'pointerup') {
                    this.host.events.emit('connectionClick', {id: g.id, originalEvent: e});
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
        const model = this.host.model;

        this.clearDraftUi(g);

        const target = drop ? g.target : null;

        if (target === null) {
            if (drop && g.overNode !== null && g.overNode !== g.anchor.node) {
                const wantDir: WorkflowPortDir = g.anchorDir === 'out' ? 'in' : 'out';
                const first = model.ports(g.overNode, wantDir)[0];
                const ref = {node: g.overNode, port: first?.id ?? ''};
                const from = g.anchorDir === 'out' ? g.anchor : ref;
                const to = g.anchorDir === 'out' ? ref : g.anchor;
                const reason = first === undefined
                    ? 'no compatible port'
                    : (model.validate(from, to, g.rerouting ?? undefined) ?? 'no compatible port');

                this.host.events.emit('connectRefused', {from, to, reason});
            }

            if (g.rerouting !== null && drop) {
                const conn = model.connection(g.rerouting)!;
                model.disconnect(g.rerouting);
                this.connections.render();
                this.host.commit('disconnect', [conn.from.node, conn.to.node], [g.rerouting]);
            } else {
                this.connections.render();
            }
            return;
        }

        const from = g.anchorDir === 'out' ? g.anchor : target.ref;
        const to = g.anchorDir === 'out' ? target.ref : g.anchor;

        if (g.rerouting !== null) {
            const before = model.connection(g.rerouting)!;
            const touched = [before.from.node, before.to.node, from.node, to.node];
            const unchanged = WorkflowModel.sameRef(before.from, from) && WorkflowModel.sameRef(before.to, to);

            if (!unchanged) {
                model.reconnect(g.rerouting, from, to);
            }
            this.connections.render();
            if (!unchanged) {
                this.host.commit('reconnect', touched, [g.rerouting]);
            }
            return;
        }

        const conn = model.connect(from, to);
        this.connections.render();
        this.host.commit('connect', [from.node, to.node], [conn.id]);
    }

    private clearDraftUi(g: Extract<Gesture, {kind: 'draft'}>): void {
        this.host.root.classList.remove('wf-drafting');
        this.scene.draftPath.style.display = 'none';
        this.scene.draftPath.classList.remove('wf-ok');
        g.target?.el.classList.remove('wf-port-target');

        for (const view of this.scene.nodeViews.values()) {
            for (const pv of view.ports.values()) {
                pv.el.classList.remove('wf-port-valid');
            }
        }
        if (g.rerouting !== null) {
            const cv = this.connections.views.get(g.rerouting);
            if (cv !== undefined) {
                cv.g.style.display = '';
            }
        }
    }

    /** Abort a running gesture without committing (programmatic changes, Escape). */
    public cancel(): void {
        const g = this.gesture;

        if (g === null) {
            return;
        }

        this.gesture = null;
        this.host.root.classList.remove('wf-panning');

        if (g.kind === 'draft') {
            this.clearDraftUi(g);
            this.connections.render();
        } else if (g.kind === 'band') {
            g.el.remove();
        } else if (g.kind === 'node' && g.moved) {
            this.placeItems(g.origins, 0, 0);
        } else if (g.kind === 'resize' && g.moved) {
            this.host.model.updateNote(g.id, {w: g.w0, h: g.h0});
            this.scene.positionNote(g.id);
        }
    }

    // ---- wheel, double-click -------------------------------------------

    private handleWheel(e: WheelEvent): void {
        e.preventDefault();

        const p = this.viewport.local(e);
        // Pinch gestures arrive as ctrl+wheel with small deltas.
        const k = e.ctrlKey ? 0.01 : 0.0015;
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;

        this.viewport.zoomAt(p.x, p.y, Math.exp(-delta * k));
    }

    private handleDblClick(e: MouseEvent): void {
        // The press captured the pointer on the root, so the event's target is
        // the root: look up what is really under the cursor.
        const under = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(e.clientX, e.clientY) : null;
        const target = (under !== null && this.host.root.contains(under) ? under : e.target) as Element;
        const noteEl = target.closest<HTMLDivElement>('[data-wf-note]');

        if (WorkflowGestures.isField(target) || WorkflowGestures.isBodyControl(target)) {
            return;
        }
        if (target.closest('[data-wf-group-bypass]') !== null) {
            return;
        }
        if (noteEl !== null) {
            this.editor.editNote(noteEl.dataset.wfNote!);
            return;
        }
        if (target.closest('[data-wf-group-toggle]') !== null) {
            return;     // two quick clicks on the button already toggled twice
        }

        const headId = target.closest<HTMLDivElement>('[data-wf-group-head]')?.dataset.wfGroupHead;

        if (headId !== undefined) {
            this.editor.editGroupLabel(headId);
            return;
        }

        const boxId = target.closest<HTMLDivElement>('[data-wf-group]')?.dataset.wfGroup;

        if (boxId !== undefined) {
            this.editor.setGroupCollapsed(boxId, false);
            return;
        }

        const nodeEl = target.closest<HTMLDivElement>('[data-wf-node]');

        if (nodeEl !== null && target.closest('[data-wf-port]') === null) {
            this.host.events.emit('nodeDblClick', {id: nodeEl.dataset.wfNode!, originalEvent: e});
            return;
        }

        const connId = target.closest('.wf-conn-tools') === null
            ? target.closest<HTMLElement | SVGElement>('[data-wf-conn]')?.dataset.wfConn
            : undefined;

        if (connId !== undefined) {
            this.host.events.emit('connectionDblClick', {id: connId, originalEvent: e});
            if (this.host.editConnectionLabels) {
                this.editor.editConnectionLabel(connId);
            }
        }
    }

}
