import { RectAnim } from './RectAnim';
import { RectColor } from './RectColor';
import { DEFAULT_CURVE, RECT_SIDES, RectAnchorPoint, RectBoardGeometry as G, RectArea, RectCurveShape, RectPoint } from './RectBoardGeometry';
import {
    RectBoardEvents,
    RectBoardOptions,
    RectEdgeSpec,
    RectItemOptions,
    RectRouteOptions,
    RectSide,
    RectStoryHandlers
} from './RectKitTypes';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Elements inside an item that keep their own pointer handling. */
const INTERACTIVE = 'input, textarea, select, button, a, [contenteditable="true"], [data-rb-ignore]';

interface Item {
    id: string | null;
    el: HTMLElement;
    x: number;
    y: number;
    /** Board-controlled size; undefined → the element's own size. */
    w?: number;
    h?: number;
    movable: boolean;
    resizable: boolean;
    connectable: boolean;
}

interface Edge extends RectRouteOptions {
    id: string;
    from: string;
    to: string;
    fromArrow?: boolean;
    className?: string;
}

type Gesture =
    | {kind: 'pan'; lastX: number; lastY: number}
    | {kind: 'move'; id: string; startX: number; startY: number; origin: Map<string, RectPoint>; moved: boolean}
    | {kind: 'resize'; id: string; startX: number; startY: number; w0: number; h0: number; moved: boolean}
    | {kind: 'draft'; from: string; side: RectSide; point: RectPoint}
    | {kind: 'reroute'; edgeId: string; endpoint: 'from' | 'to'; point: RectPoint}
    | {kind: 'band'; start: RectPoint; point: RectPoint; shift: boolean; ctrl: boolean; el: HTMLElement};

type Handlers = {[K in keyof RectBoardEvents]: Array<RectBoardEvents[K]>};

/**
 * A pan/zoom composition board with an optional scroll-driven story, and
 * an editing mode.
 *
 * You build a picture by *adding objects*: `board.add(el, x, y)` places any
 * rendered element (a rect-kit element, a jsNGraph host div, anything) at a
 * world coordinate and the board assembles them under one CSS-transform
 * camera. `story([...ids])` then turns the mouse wheel / arrow keys into
 * smooth camera fly-throughs between the named items — the scrollytelling
 * "auto camera" of an explainer. Drag pans; ctrl/⌘-wheel and `zoomBy` zoom.
 *
 * With `editable: true` the board is an editor surface: items drag (with
 * grid snapping) and resize, side anchors draw connectors, connector ends
 * reroute, clicks and rubber bands select. The host keeps its own
 * document: listen to `commit` (one event per finished gesture, with the
 * before/after values — the undo hook) and re-sync with `update`,
 * `setEdges` or `clear` + `add` after an undo. Pure DOM, zero deps.
 */
export class RectBoard {

    private readonly viewport: HTMLElement;
    private readonly board: HTMLDivElement;
    private readonly backLayer: HTMLDivElement;
    private readonly frontLayer: HTMLDivElement;
    private readonly items = new Map<string, Item>();
    private readonly anon: Item[] = [];
    private edges: Edge[] = [];
    private overlay: SVGSVGElement | null = null;
    private readonly minScale: number;
    private readonly maxScale: number;
    private readonly padding: number;
    private readonly editable: boolean;
    private readonly grid: number;
    private readonly minSize: {w: number; h: number};
    private readonly zoomStep: number;
    private readonly curve: RectCurveShape;
    private readonly selectedClass: string;
    private readonly bandEnabled: boolean;
    private readonly pillLabels: boolean;
    private readonly refitOnResize: boolean;
    private readonly partnersOf: ((id: string) => string[]) | undefined;

    private scale = 1;
    private tx = 0;
    private ty = 0;

    private storyIds: string[] = [];
    private storyHandlers: RectStoryHandlers = {};
    private step = -1;
    private cooling = false;

    private gesture: Gesture | null = null;
    private selected = new Set<string>();
    private selectedEdgeId: string | null = null;
    private edgeSeq = 0;
    private readonly handlers: Handlers = {
        commit: [], select: [], edgeSelect: [], band: [], itemDblClick: [], edgeDblClick: [], backgroundDblClick: []
    };

    private readonly onWheel: (e: WheelEvent) => void;
    private readonly onDown: (e: PointerEvent) => void;
    private readonly onMove: (e: PointerEvent) => void;
    private readonly onUp: (e: PointerEvent) => void;
    private readonly onDbl: (e: MouseEvent) => void;
    private readonly onKey: (e: KeyboardEvent) => void;
    private readonly onResize: () => void;

    public constructor(container: HTMLElement, options: RectBoardOptions = {}) {
        this.minScale = options.minScale ?? 0.1;
        this.maxScale = options.maxScale ?? 2.6;
        this.padding = options.padding ?? 60;
        this.editable = options.editable ?? false;
        this.grid = options.grid ?? 0;
        this.minSize = options.minItemSize ?? {w: 40, h: 30};
        this.zoomStep = options.zoomStep ?? 1.12;
        this.curve = {...DEFAULT_CURVE, ...options.curve};
        this.selectedClass = options.selectedClass ?? 'rb-selected';
        this.bandEnabled = options.band ?? this.editable;
        this.pillLabels = options.edgeLabels === 'pill';
        this.refitOnResize = options.refitOnResize ?? !this.editable;
        this.partnersOf = options.dragPartners;

        this.viewport = container;
        this.viewport.style.overflow = 'hidden';
        if (getComputedStyle(this.viewport).position === 'static') {
            this.viewport.style.position = 'relative';
        }
        this.viewport.style.touchAction = 'none';
        this.viewport.classList.add('rb-viewport');
        if (this.editable) {
            RectAnim.ensureEditStyles();
        }
        if (!this.editable) {
            this.viewport.style.cursor = 'grab';
        }

        this.board = document.createElement('div');
        this.board.className = 'rb-stage';
        this.board.style.cssText = 'position:absolute; top:0; left:0; transform-origin:0 0; will-change:transform;';
        this.backLayer = RectBoard.layer('rb-layer-back');
        this.frontLayer = RectBoard.layer('rb-layer-front');
        this.board.appendChild(this.backLayer);
        this.board.appendChild(this.frontLayer);
        this.viewport.appendChild(this.board);

        this.onWheel = (e) => this.handleWheel(e);
        this.onDown = (e) => this.handleDown(e);
        this.onMove = (e) => this.handleMove(e);
        this.onUp = (e) => this.handleUp(e);
        this.onDbl = (e) => this.handleDblClick(e);
        this.onKey = (e) => this.handleKey(e);
        this.onResize = () => {
            if (this.refitOnResize) {
                this.refit(false);
            }
        };

        this.viewport.addEventListener('wheel', this.onWheel, {passive: false});
        this.viewport.addEventListener('pointerdown', this.onDown);
        this.viewport.addEventListener('pointermove', this.onMove);
        this.viewport.addEventListener('pointerup', this.onUp);
        this.viewport.addEventListener('pointercancel', this.onUp);
        this.viewport.addEventListener('dblclick', this.onDbl);
        window.addEventListener('keydown', this.onKey);
        window.addEventListener('resize', this.onResize);
    }

    // ---- items ----

    /**
     * Place a rendered element at world (x, y). Give it an id to target it
     * later (story, connectors, editing). Re-adding an id replaces the item.
     */
    public add(el: HTMLElement, x: number, y: number, id?: string, options: RectItemOptions = {}): this {
        if (id !== undefined && this.items.has(id)) {
            this.items.get(id)?.el.remove();
            this.items.delete(id);
        }

        el.style.position = 'absolute';
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        if (options.w !== undefined) el.style.width = options.w + 'px';
        if (options.h !== undefined) el.style.height = options.h + 'px';
        (options.layer === 'back' ? this.backLayer : this.frontLayer).appendChild(el);

        const item: Item = {
            id: id ?? null,
            el,
            x,
            y,
            movable: options.movable ?? true,
            resizable: options.resizable ?? true,
            connectable: options.connectable ?? true
        };
        if (options.w !== undefined) item.w = options.w;
        if (options.h !== undefined) item.h = options.h;

        if (id !== undefined) {
            el.dataset.rbItem = id;
            this.items.set(id, item);
            el.classList.toggle(this.selectedClass, this.selected.has(id));
            if (this.editable) this.ensureHandles(item);
        } else {
            this.anon.push(item);
        }

        return this;
    }

    /** Move and/or resize an item without a gesture (no `commit`). */
    public update(id: string, geometry: Partial<RectArea>): this {
        const item = this.items.get(id);
        if (item === undefined) return this;

        if (geometry.x !== undefined) item.x = geometry.x;
        if (geometry.y !== undefined) item.y = geometry.y;
        if (geometry.w !== undefined) item.w = geometry.w;
        if (geometry.h !== undefined) item.h = geometry.h;
        this.place(item);
        this.drawEdges();

        return this;
    }

    public remove(id: string): this {
        const item = this.items.get(id);
        if (item === undefined) return this;

        item.el.remove();
        this.items.delete(id);
        this.selected.delete(id);
        this.drawEdges();

        return this;
    }

    /** Remove every item and connector. The selection is kept for items re-added under the same id. */
    public clear(): this {
        for (const item of this.allItems()) item.el.remove();
        this.items.clear();
        this.anon.length = 0;
        this.edges = [];
        this.drawEdges();

        return this;
    }

    public has(id: string): boolean {
        return this.items.has(id);
    }

    /** Current world rect of an item. */
    public itemRect(id: string): RectArea | null {
        const item = this.items.get(id);
        return item === undefined ? null : this.rectOfItem(item);
    }

    // ---- connectors ----

    /**
     * Auto-route a connector between two added items (by id). Anchor points on
     * the box edges and the path are computed from the live geometry — move or
     * resize the boxes and it re-routes. Styles: 'curve' (default),
     * 'orthogonal' (right angles) or 'straight'.
     */
    public connect(fromId: string, toId: string, options: RectRouteOptions = {}): this {
        this.edges.push({...options, id: `rb-e${++this.edgeSeq}`, from: fromId, to: toId});
        this.drawEdges();

        return this;
    }

    /** Replace all connectors (editable boards keep them in sync with the host document). */
    public setEdges(edges: RectEdgeSpec[]): this {
        this.edges = edges.map((e) => ({...e}));
        if (this.selectedEdgeId !== null && !this.edges.some((e) => e.id === this.selectedEdgeId)) {
            this.selectedEdgeId = null;
        }
        this.drawEdges();

        return this;
    }

    /** Label position of a connector (the curve's midpoint), in world px. */
    public edgeMidpoint(id: string): RectPoint | null {
        const edge = this.edges.find((e) => e.id === id);
        const ends = edge === undefined ? null : this.edgeEnds(edge);
        if (edge === undefined || ends === null) return null;

        return this.midpoint(edge, ends[0], ends[1]);
    }

    // ---- selection ----

    public get selection(): string[] {
        return [...this.selected];
    }

    /** Set the item selection (`select` event only with `notify`). A non-empty selection clears the connector selection. */
    public select(ids: Iterable<string>, notify = false): void {
        const next = new Set([...ids].filter((id) => this.items.has(id)));
        for (const id of this.selected) {
            if (!next.has(id)) this.items.get(id)?.el.classList.remove(this.selectedClass);
        }
        for (const id of next) this.items.get(id)?.el.classList.add(this.selectedClass);
        this.selected = next;
        if (next.size > 0) this.setEdgeSelection(null, notify);
        if (notify) this.emit('select', [...next]);
    }

    public get selectedEdge(): string | null {
        return this.selectedEdgeId;
    }

    /** Select a connector (clears the item selection). */
    public selectEdge(id: string | null, notify = false): void {
        if (id !== null && this.selected.size > 0) this.select([], notify);
        this.setEdgeSelection(id, notify);
    }

    // ---- events ----

    public on<K extends keyof RectBoardEvents>(event: K, handler: RectBoardEvents[K]): this {
        this.handlers[event].push(handler);

        return this;
    }

    // ---- camera ----

    /** The transformed stage (world coordinates); hosts can place overlays (editors, ghosts) in it. */
    public get stage(): HTMLElement {
        return this.board;
    }

    public getView(): {scale: number; tx: number; ty: number} {
        return {scale: this.scale, tx: this.tx, ty: this.ty};
    }

    public setView(view: {scale: number; tx: number; ty: number}): void {
        this.scale = this.clampScale(view.scale);
        this.tx = view.tx;
        this.ty = view.ty;
        this.apply(false);
    }

    /** Client (page) coordinates → world coordinates. */
    public toWorld(clientX: number, clientY: number): RectPoint {
        const r = this.viewport.getBoundingClientRect();

        return {x: (clientX - r.left - this.tx) / this.scale, y: (clientY - r.top - this.ty) / this.scale};
    }

    /** Enable the scroll/arrow-driven camera story over the given item ids. */
    public story(ids: string[], handlers: RectStoryHandlers = {}): this {
        this.storyIds = ids.slice();
        this.storyHandlers = handlers;
        this.step = -1;

        return this;
    }

    public get stepIndex(): number {
        return this.step;
    }

    public next(): void {
        this.goto(this.step < 0 ? 0 : this.step + 1);
    }

    public prev(): void {
        if (this.step <= 0) {
            this.goto(-1);
        } else {
            this.goto(this.step - 1);
        }
    }

    /** Move the camera to story step `index` (-1 = whole board) and notify. */
    public goto(index: number): void {
        const clamped = Math.max(-1, Math.min(this.storyIds.length - 1, index));
        this.step = clamped;

        if (clamped < 0) {
            this.fitAll(true);
        } else {
            this.focus(this.storyIds[clamped] as string, true);
        }

        this.storyHandlers.onStep?.(clamped, clamped < 0 ? null : (this.storyIds[clamped] as string));
    }

    /** Fly the camera to frame a single item. */
    public focus(id: string, animate = true): void {
        const r = this.itemRect(id);

        if (r !== null) {
            this.fitRect(r.x, r.y, r.w, r.h, animate, 70);
        }
    }

    /** Fly the camera to frame the whole board. */
    public fitAll(animate = true): void {
        const b = G.bounds(this.allItems().map((item) => this.rectOfItem(item)));

        if (b !== null && b.w > 0 && b.h > 0) {
            this.fitRect(b.x, b.y, b.w, b.h, animate, this.editable ? this.padding : 40);
        }
    }

    public fitRect(x: number, y: number, w: number, h: number, animate = true, pad = this.padding): void {
        const vw = this.viewport.clientWidth;
        const vh = this.viewport.clientHeight;
        const s = this.clampScale(Math.min((vw - 2 * pad) / Math.max(w, 1), (vh - 2 * pad) / Math.max(h, 1)));

        this.scale = s;
        this.tx = vw / 2 - s * (x + w / 2);
        this.ty = vh / 2 - s * (y + h / 2);
        this.apply(animate);
    }

    /** Zoom by a factor about the viewport centre. */
    public zoomBy(factor: number): void {
        this.zoomAt(this.viewport.clientWidth / 2, this.viewport.clientHeight / 2, factor);
    }

    public destroy(): void {
        this.viewport.removeEventListener('wheel', this.onWheel);
        this.viewport.removeEventListener('pointerdown', this.onDown);
        this.viewport.removeEventListener('pointermove', this.onMove);
        this.viewport.removeEventListener('pointerup', this.onUp);
        this.viewport.removeEventListener('pointercancel', this.onUp);
        this.viewport.removeEventListener('dblclick', this.onDbl);
        window.removeEventListener('keydown', this.onKey);
        window.removeEventListener('resize', this.onResize);
        if (this.gesture !== null && this.gesture.kind === 'band') {
            this.gesture.el.remove();
        }
        this.gesture = null;
        this.board.remove();
        this.viewport.classList.remove('rb-viewport', 'rb-panning', 'rb-drafting');
    }

    // ---- internals: items ----

    private static layer(cls: string): HTMLDivElement {
        const div = document.createElement('div');
        div.className = cls;
        div.style.cssText = 'position:absolute; left:0; top:0;';
        return div;
    }

    private allItems(): Item[] {
        return [...this.items.values(), ...this.anon];
    }

    private rectOfItem(item: Item): RectArea {
        return {x: item.x, y: item.y, w: item.w ?? item.el.offsetWidth, h: item.h ?? item.el.offsetHeight};
    }

    private place(item: Item): void {
        item.el.style.left = item.x + 'px';
        item.el.style.top = item.y + 'px';
        if (item.w !== undefined) item.el.style.width = item.w + 'px';
        if (item.h !== undefined) item.el.style.height = item.h + 'px';
    }

    /** Default resize grip and side anchors, unless the host rendered its own (`data-rb="resize|anchor"`). */
    private ensureHandles(item: Item): void {
        if (item.resizable && item.w !== undefined && item.el.querySelector('[data-rb="resize"]') === null) {
            const grip = document.createElement('div');
            grip.className = 'rb-resize';
            grip.dataset.rb = 'resize';
            item.el.appendChild(grip);
        }
        if (item.connectable && item.el.querySelector('[data-rb="anchor"]') === null) {
            for (const side of RECT_SIDES) {
                const dot = document.createElement('div');
                dot.className = `rb-anchor rb-anchor-${side}`;
                dot.dataset.rb = 'anchor';
                dot.dataset.side = side;
                item.el.appendChild(dot);
            }
        }
    }

    /** The item under a client point (hit-tested, so pointer capture does not matter). */
    private itemAt(clientX: number, clientY: number): string | null {
        const hit = document.elementFromPoint(clientX, clientY);
        const el = hit instanceof Element ? hit.closest<HTMLElement>('[data-rb-item]') : null;
        const id = el?.dataset.rbItem;

        return el !== null && id !== undefined && this.viewport.contains(el) && this.items.has(id) ? id : null;
    }

    // ---- internals: connectors ----

    private ensureOverlay(): SVGSVGElement {
        if (this.overlay === null) {
            const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
            svg.classList.add('rb-edges');
            svg.style.cssText = 'position:absolute; left:0; top:0; overflow:visible; pointer-events:none;';
            this.board.insertBefore(svg, this.frontLayer); // over frames, under the boxes
            this.overlay = svg;
        }

        return this.overlay;
    }

    private edgeEnds(edge: Edge): [RectAnchorPoint, RectAnchorPoint] | null {
        const from = this.itemRect(edge.from);
        const to = this.itemRect(edge.to);
        if (from === null || to === null) return null;

        const g = this.gesture;
        const loose = g !== null && g.kind === 'reroute' && g.edgeId === edge.id ? g : null;
        const a: RectAnchorPoint = loose?.endpoint === 'from' ? {...loose.point} : G.endpoint(from, edge.fromSide, to);
        const b: RectAnchorPoint = loose?.endpoint === 'to' ? {...loose.point} : G.endpoint(to, edge.toSide, from);

        return [a, b];
    }

    private midpoint(edge: Edge, a: RectAnchorPoint, b: RectAnchorPoint): RectPoint {
        return (edge.style ?? 'curve') === 'curve' ? G.curveMidpoint(a, b, this.curve) : {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
    }

    /** (Re)draw every connector from current box geometry. */
    private drawEdges(): void {
        const svg = this.ensureOverlay();

        while (svg.firstChild !== null) {
            svg.removeChild(svg.firstChild);
        }

        // Sized to the content plus a margin, so hit-testing also works at negative coordinates.
        const b = G.bounds(this.allItems().map((item) => this.rectOfItem(item))) ?? {x: 0, y: 0, w: 1, h: 1};
        const m = 200;
        svg.style.left = `${b.x - m}px`;
        svg.style.top = `${b.y - m}px`;
        svg.setAttribute('width', String(b.w + 2 * m));
        svg.setAttribute('height', String(b.h + 2 * m));
        svg.setAttribute('viewBox', `${b.x - m} ${b.y - m} ${b.w + 2 * m} ${b.h + 2 * m}`);

        for (const edge of this.edges) {
            const ends = this.edgeEnds(edge);
            if (ends !== null) {
                this.drawEdge(svg, edge, ends[0], ends[1]);
            }
        }

        const g = this.gesture;
        if (g !== null && g.kind === 'draft') {
            const from = this.itemRect(g.from);
            if (from !== null) {
                const a = G.anchor(from, g.side);
                const line = RectBoard.svgEl('line', {x1: a.x, y1: a.y, x2: g.point.x, y2: g.point.y, 'pointer-events': 'none'});
                line.classList.add('rb-edge-draft');
                svg.appendChild(line);
            }
        }
    }

    private drawEdge(svg: SVGSVGElement, o: Edge, a: RectAnchorPoint, b: RectAnchorPoint): void {
        const stroke = RectColor.resolve(o.color, 'slate');
        const style = o.style ?? 'curve';
        const selected = o.id === this.selectedEdgeId;

        let d: string;
        if (style === 'straight') {
            d = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
        } else if (style === 'orthogonal') {
            d = G.orthogonalPath(a, b);
        } else {
            d = G.curvePath(a, b, this.curve);
        }

        const group = RectBoard.svgEl('g', {});
        group.classList.add('rb-edge');
        if (selected) group.classList.add('rb-edge-selected');
        if (o.className !== undefined) group.classList.add(...o.className.split(/\s+/).filter((c) => c !== ''));
        group.dataset.rbEdge = o.id;
        group.style.color = stroke;

        if (this.editable) {
            // Wide invisible stroke: easy to click even on a thin line.
            const hit = RectBoard.svgEl('path', {d, fill: 'none', stroke: 'transparent', 'stroke-width': 16, 'pointer-events': 'stroke'});
            hit.classList.add('rb-edge-hit');
            group.appendChild(hit);
        }

        const path = RectBoard.svgEl('path', {d, fill: 'none', stroke, 'stroke-width': selected ? 2.5 : 1.6, 'stroke-linecap': 'round'});
        path.classList.add('rb-edge-line');
        if (o.animated) {
            RectAnim.ensure();
            path.setAttribute('stroke-dasharray', '5 4');
            path.style.animation = `${RectAnim.FLOW} 0.7s linear infinite`;
        } else if (o.dashed) {
            path.setAttribute('stroke-dasharray', '3 3');
        }
        group.appendChild(path);

        if (o.arrow !== false) {
            group.appendChild(RectBoard.arrowHead(b, a, stroke));
        }
        if (o.fromArrow === true) {
            group.appendChild(RectBoard.arrowHead(a, b, stroke));
        }

        if (o.dots) {
            RectAnim.ensure();
            for (let i = 0; i < 3; i++) {
                const dot = RectBoard.svgEl('circle', {r: 2, cx: 0, cy: 0, fill: stroke});
                const s = dot.style;
                s.offsetPath = `path("${d}")`;
                s.offsetRotate = '0deg';
                s.animation = `${RectAnim.TRAVEL} 1.2s linear infinite`;
                s.animationDelay = `${(i * 0.4).toFixed(2)}s`;
                group.appendChild(dot);
            }
        }

        if (o.label !== undefined && o.label !== '') {
            const mid = this.midpoint(o, a, b);
            if (this.pillLabels) {
                const w = o.label.length * 6.6 + 14;
                const pill = RectBoard.svgEl('rect', {x: mid.x - w / 2, y: mid.y - 9, width: w, height: 18, rx: 9, 'pointer-events': 'none'});
                pill.classList.add('rb-edge-label-bg');
                group.appendChild(pill);
            }
            const text = RectBoard.svgEl('text', {
                x: mid.x,
                y: this.pillLabels ? mid.y : mid.y - 5,
                'text-anchor': 'middle',
                'dominant-baseline': this.pillLabels ? 'central' : 'auto',
                fill: this.pillLabels ? stroke : '#8595b5',
                'font-size': this.pillLabels ? 11 : 10,
                'font-weight': this.pillLabels ? 600 : 400,
                'font-family': 'system-ui, sans-serif',
                'pointer-events': 'none'
            });
            text.classList.add('rb-edge-label');
            text.textContent = o.label;
            group.appendChild(text);
        }

        svg.appendChild(group);

        // End handles of the selected connector: drag one onto another item to reroute.
        if (selected && this.editable) {
            for (const endpoint of ['from', 'to'] as const) {
                const p = endpoint === 'from' ? a : b;
                const handle = RectBoard.svgEl('circle', {cx: p.x, cy: p.y, r: 6, 'pointer-events': 'all'});
                handle.classList.add('rb-edge-handle');
                handle.dataset.rbEdge = o.id;
                handle.dataset.endpoint = endpoint;
                svg.appendChild(handle);
            }
        }
    }

    /** Arrowhead with its tip at `tip`, pointing into the box (along the side normal when known). */
    private static arrowHead(tip: RectAnchorPoint, from: RectAnchorPoint, fill: string): SVGElement {
        let ux: number;
        let uy: number;
        if (tip.side !== undefined) {
            const n = G.normal(tip.side);
            ux = -n.x;
            uy = -n.y;
        } else {
            const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
            ux = (tip.x - from.x) / len;
            uy = (tip.y - from.y) / len;
        }
        const back = 7;
        const half = 4.5;
        const bx = tip.x - ux * back;
        const by = tip.y - uy * back;
        const points = `${bx - uy * half},${by + ux * half} ${bx + uy * half},${by - ux * half} ${tip.x},${tip.y}`;
        const poly = RectBoard.svgEl('polygon', {points, fill});
        poly.classList.add('rb-edge-arrow');
        return poly;
    }

    private static svgEl(name: string, attrs: Record<string, string | number>): SVGElement {
        const node = document.createElementNS(SVG_NS, name) as SVGElement;
        for (const key of Object.keys(attrs)) {
            node.setAttribute(key, String(attrs[key]));
        }
        return node;
    }

    // ---- internals: camera ----

    private clampScale(s: number): number {
        return Math.max(this.minScale, Math.min(this.maxScale, s));
    }

    private apply(animate: boolean): void {
        this.board.style.transition = animate
            ? 'transform 0.55s cubic-bezier(0.22, 0.61, 0.36, 1)'
            : 'none';
        this.board.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    }

    private zoomAt(cx: number, cy: number, factor: number): void {
        const ns = this.clampScale(this.scale * factor);
        this.tx = cx - ((cx - this.tx) / this.scale) * ns;
        this.ty = cy - ((cy - this.ty) / this.scale) * ns;
        this.scale = ns;
        this.apply(false);
    }

    private refit(animate: boolean): void {
        if (this.step < 0) {
            this.fitAll(animate);
        } else {
            this.focus(this.storyIds[this.step] as string, animate);
        }
    }

    // ---- internals: input ----

    private emit<K extends keyof RectBoardEvents>(event: K, ...args: Parameters<RectBoardEvents[K]>): void {
        for (const handler of this.handlers[event]) {
            (handler as (...a: Parameters<RectBoardEvents[K]>) => void)(...args);
        }
    }

    private setEdgeSelection(id: string | null, notify: boolean): void {
        if (id === this.selectedEdgeId) return;
        this.selectedEdgeId = id;
        this.drawEdges();
        if (notify) this.emit('edgeSelect', id);
    }

    private handleWheel(e: WheelEvent): void {
        e.preventDefault();

        if (e.ctrlKey || e.metaKey || this.storyIds.length === 0) {
            const r = this.viewport.getBoundingClientRect();
            this.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? this.zoomStep : 1 / this.zoomStep);
            return;
        }

        if (this.cooling || Math.abs(e.deltaY) < 6) {
            return;
        }

        this.cooling = true;
        window.setTimeout(() => { this.cooling = false; }, 600);
        if (e.deltaY > 0) {
            this.next();
        } else {
            this.prev();
        }
    }

    private capture(e: PointerEvent): void {
        try {
            this.viewport.setPointerCapture(e.pointerId);
        } catch {
            // synthetic events have no active pointer
        }
    }

    private handleDown(e: PointerEvent): void {
        if (e.button !== 0) {
            return;
        }
        if (!this.editable) {
            this.startPan(e);
            return;
        }

        const target = e.target instanceof Element ? e.target : null;
        if (target === null) return;

        // Host controls in the viewport (toolbars, editors) and inside items keep their clicks.
        if (target.closest(INTERACTIVE) !== null) return;
        const itemEl = target.closest<HTMLElement>('[data-rb-item]');
        if (itemEl === null && !this.board.contains(target) && target !== this.viewport) return;

        const role = target instanceof HTMLElement ? target.dataset.rb : undefined;

        // A side anchor starts a new connector.
        if (role === 'anchor' && itemEl !== null) {
            const from = itemEl.dataset.rbItem as string;
            const side = (target as HTMLElement).dataset.side as RectSide | undefined;
            if (side !== undefined && this.items.get(from)?.connectable === true) {
                this.gesture = {kind: 'draft', from, side, point: this.toWorld(e.clientX, e.clientY)};
                this.viewport.classList.add('rb-drafting');
                this.capture(e);
                e.preventDefault();
                this.drawEdges();
                return;
            }
        }

        // An end handle of the selected connector starts a reroute.
        if (target instanceof SVGElement && target.classList.contains('rb-edge-handle')) {
            const edgeId = target.dataset.rbEdge;
            const endpoint = target.dataset.endpoint;
            if (edgeId !== undefined && (endpoint === 'from' || endpoint === 'to')) {
                this.gesture = {kind: 'reroute', edgeId, endpoint, point: this.toWorld(e.clientX, e.clientY)};
                this.viewport.classList.add('rb-drafting');
                this.capture(e);
                e.preventDefault();
                this.drawEdges();
                return;
            }
        }

        // A connector selects it.
        const edgeEl = target.closest<SVGGElement>('.rb-edge');
        const edgeId = edgeEl?.dataset.rbEdge;
        if (edgeId !== undefined) {
            this.selectEdge(edgeId, true);
            return;
        }

        if (itemEl !== null) {
            this.downOnItem(e, itemEl.dataset.rbItem as string, role === 'resize');
            return;
        }

        // Empty space: with a modifier a rubber band, otherwise clear the selection and pan.
        const shift = e.shiftKey;
        const ctrl = e.ctrlKey || e.metaKey;
        if (this.bandEnabled && (shift || ctrl)) {
            const start = this.toWorld(e.clientX, e.clientY);
            const el = document.createElement('div');
            el.className = `rb-band ${ctrl ? 'rb-band-select' : 'rb-band-shift'}`;
            el.style.cssText = 'position:absolute; pointer-events:none;';
            this.board.appendChild(el);
            this.gesture = {kind: 'band', start, point: start, shift, ctrl, el};
            this.drawBand();
            this.capture(e);
            e.preventDefault();
            return;
        }

        if (this.selected.size > 0) this.select([], true);
        if (this.selectedEdgeId !== null) this.setEdgeSelection(null, true);
        this.startPan(e);
    }

    private startPan(e: PointerEvent): void {
        this.gesture = {kind: 'pan', lastX: e.clientX, lastY: e.clientY};
        this.viewport.classList.add('rb-panning');
        if (!this.editable) this.viewport.style.cursor = 'grabbing';
        this.capture(e);
    }

    /**
     * Shift toggles the item in the selection (no drag). A click on an
     * unselected item selects only it; on a selected one the selection
     * stays, so the drag moves all of it.
     */
    private downOnItem(e: PointerEvent, id: string, resize: boolean): void {
        const item = this.items.get(id);
        if (item === undefined) return;

        if (e.shiftKey && !resize) {
            const next = new Set(this.selected);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            this.select(next, true);
            e.preventDefault();
            return;
        }
        if (!this.selected.has(id)) this.select([id], true);

        if (resize && item.resizable) {
            const r = this.rectOfItem(item);
            this.gesture = {kind: 'resize', id, startX: e.clientX, startY: e.clientY, w0: r.w, h0: r.h, moved: false};
        } else if (item.movable) {
            const origin = new Map<string, RectPoint>();
            const movers = new Set<string>([id, ...this.selected, ...(this.partnersOf?.(id) ?? [])]);
            for (const moverId of movers) {
                const mover = this.items.get(moverId);
                if (mover !== undefined && mover.movable) origin.set(moverId, {x: mover.x, y: mover.y});
            }
            this.gesture = {kind: 'move', id, startX: e.clientX, startY: e.clientY, origin, moved: false};
        } else {
            return;
        }

        // Suppress the native text selection that would otherwise start under the pointer.
        e.preventDefault();
        this.capture(e);
    }

    private handleMove(e: PointerEvent): void {
        const g = this.gesture;
        if (g === null) return;

        if (g.kind === 'pan') {
            this.tx += e.clientX - g.lastX;
            this.ty += e.clientY - g.lastY;
            g.lastX = e.clientX;
            g.lastY = e.clientY;
            this.apply(false);
            return;
        }
        if (g.kind === 'draft' || g.kind === 'reroute') {
            g.point = this.toWorld(e.clientX, e.clientY);
            this.drawEdges();
            return;
        }
        if (g.kind === 'band') {
            g.point = this.toWorld(e.clientX, e.clientY);
            this.drawBand();
            return;
        }

        const dx = (e.clientX - g.startX) / this.scale;
        const dy = (e.clientY - g.startY) / this.scale;
        if (!g.moved && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) g.moved = true;
        if (!g.moved) return;

        // Alt: pixel precise, otherwise on the grid; read per move, so it can change mid-drag.
        const align = (v: number): number => G.snap(v, e.altKey ? 0 : this.grid);

        if (g.kind === 'move') {
            for (const [id, o] of g.origin) {
                const item = this.items.get(id);
                if (item === undefined) continue;
                item.x = align(o.x + dx);
                item.y = align(o.y + dy);
                this.place(item);
            }
        } else {
            const item = this.items.get(g.id);
            if (item === undefined) return;
            item.w = Math.max(this.minSize.w, align(g.w0 + dx));
            item.h = Math.max(this.minSize.h, align(g.h0 + dy));
            this.place(item);
        }
        this.drawEdges();
    }

    private handleUp(e: PointerEvent): void {
        const g = this.gesture;
        if (g === null) return;
        this.gesture = null;
        try {
            if (this.viewport.hasPointerCapture(e.pointerId)) this.viewport.releasePointerCapture(e.pointerId);
        } catch {
            // already released
        }
        this.viewport.classList.remove('rb-panning', 'rb-drafting');
        if (!this.editable) this.viewport.style.cursor = 'grab';

        switch (g.kind) {
            case 'pan':
                return;
            case 'band':
                g.el.remove();
                this.finishBand(g);
                return;
            case 'draft':
                this.finishDraft(g, e);
                return;
            case 'reroute':
                this.finishReroute(g, e);
                return;
            case 'move': {
                if (!g.moved) return;
                const moved: Array<{id: string; from: RectPoint; to: RectPoint}> = [];
                for (const [id, from] of g.origin) {
                    const item = this.items.get(id);
                    if (item !== undefined && (item.x !== from.x || item.y !== from.y)) moved.push({id, from, to: {x: item.x, y: item.y}});
                }
                if (moved.length > 0) this.emit('commit', {type: 'move', items: moved});
                return;
            }
            case 'resize': {
                const item = this.items.get(g.id);
                if (!g.moved || item === undefined) return;
                const to = {w: item.w ?? g.w0, h: item.h ?? g.h0};
                if (to.w !== g.w0 || to.h !== g.h0) this.emit('commit', {type: 'resize', id: g.id, from: {w: g.w0, h: g.h0}, to});
                return;
            }
        }
    }

    private finishDraft(g: Extract<Gesture, {kind: 'draft'}>, e: PointerEvent): void {
        const to = this.itemAt(e.clientX, e.clientY);
        if (to === null || to === g.from || this.items.get(to)?.connectable !== true) {
            this.drawEdges();
            return;
        }
        const edgeId = `rb-e${++this.edgeSeq}`;
        this.edges.push({id: edgeId, from: g.from, to, fromSide: g.side});
        this.drawEdges();
        this.emit('commit', {type: 'connect', edgeId, from: g.from, fromSide: g.side, to});
    }

    private finishReroute(g: Extract<Gesture, {kind: 'reroute'}>, e: PointerEvent): void {
        const edge = this.edges.find((x) => x.id === g.edgeId);
        const fixed = edge === undefined ? null : (g.endpoint === 'from' ? edge.to : edge.from);
        const to = this.itemAt(e.clientX, e.clientY);
        if (edge === undefined || to === null || to === fixed || this.items.get(to)?.connectable !== true) {
            this.drawEdges();
            return;
        }
        if (g.endpoint === 'from') {
            edge.from = to;
            delete edge.fromSide;
        } else {
            edge.to = to;
            delete edge.toSide;
        }
        this.drawEdges();
        this.emit('commit', {type: 'reroute', edgeId: edge.id, endpoint: g.endpoint, to});
    }

    private drawBand(): void {
        const g = this.gesture;
        if (g === null || g.kind !== 'band') return;
        const r = G.fromCorners(g.start, g.point);
        Object.assign(g.el.style, {left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`});
    }

    /** A Ctrl/Cmd band selects what it touches (Ctrl+Shift adds); every band is reported to the host. */
    private finishBand(g: Extract<Gesture, {kind: 'band'}>): void {
        const rect = G.fromCorners(g.start, g.point);

        if (g.ctrl && (rect.w >= 4 || rect.h >= 4)) {
            const hit: string[] = [];
            for (const [id, item] of this.items) {
                if (G.overlaps(rect, this.rectOfItem(item))) hit.push(id);
            }
            this.select(g.shift ? new Set([...this.selected, ...hit]) : hit, true);
        }

        this.emit('band', rect, {shift: g.shift, ctrl: g.ctrl});
    }

    private handleDblClick(e: MouseEvent): void {
        if (!this.editable) return;

        // Pointer capture retargets the dblclick to the viewport: hit-test the position instead.
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const target = hit instanceof Element && this.viewport.contains(hit) ? hit : (e.target instanceof Element ? e.target : null);
        if (target === null || target.closest(INTERACTIVE) !== null) return;

        const edgeId = target.closest<SVGGElement>('.rb-edge')?.dataset.rbEdge;
        if (edgeId !== undefined) {
            this.emit('edgeDblClick', edgeId, e);
            return;
        }

        const id = target.closest<HTMLElement>('[data-rb-item]')?.dataset.rbItem;
        if (id !== undefined) {
            this.emit('itemDblClick', id, e);
            return;
        }

        if (this.board.contains(target) || target === this.viewport) {
            this.emit('backgroundDblClick', this.toWorld(e.clientX, e.clientY), e);
        }
    }

    private handleKey(e: KeyboardEvent): void {
        if (this.storyIds.length === 0) {
            return;
        }

        if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') {
            e.preventDefault();
            this.next();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') {
            e.preventDefault();
            this.prev();
        } else if (e.key === 'Home') {
            e.preventDefault();
            this.goto(-1);
        }
    }

}
