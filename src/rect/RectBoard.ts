import { RectAnim } from './RectAnim';
import { RectColor } from './RectColor';
import { RectBoardOptions, RectRouteOptions, RectSide, RectStoryHandlers } from './RectKitTypes';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Item {
    el: HTMLElement;
    x: number;
    y: number;
}

interface Edge {
    from: string;
    to: string;
    options: RectRouteOptions;
}

interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * A pan/zoom composition board with an optional scroll-driven story.
 *
 * You build a picture by *adding objects*: `board.add(el, x, y)` places any
 * rendered element (a rect-kit element, a jsNGraph host div, anything) at a
 * world coordinate and the board assembles them under one CSS-transform
 * camera. `story([...ids])` then turns the mouse wheel / arrow keys into
 * smooth camera fly-throughs between the named items — the scrollytelling
 * "auto camera" of an explainer. Drag pans; ctrl/⌘-wheel and `zoomBy` zoom.
 * Pure DOM, zero deps.
 */
export class RectBoard {

    private readonly viewport: HTMLElement;
    private readonly board: HTMLDivElement;
    private readonly items = new Map<string, Item>();
    private readonly anon: Item[] = [];
    private readonly edges: Edge[] = [];
    private overlay: SVGSVGElement | null = null;
    private readonly minScale: number;
    private readonly maxScale: number;
    private readonly padding: number;

    private scale = 1;
    private tx = 0;
    private ty = 0;

    private storyIds: string[] = [];
    private handlers: RectStoryHandlers = {};
    private step = -1;
    private cooling = false;

    private dragging = false;
    private lastX = 0;
    private lastY = 0;

    private readonly onWheel: (e: WheelEvent) => void;
    private readonly onDown: (e: PointerEvent) => void;
    private readonly onMove: (e: PointerEvent) => void;
    private readonly onUp: (e: PointerEvent) => void;
    private readonly onKey: (e: KeyboardEvent) => void;
    private readonly onResize: () => void;

    public constructor(container: HTMLElement, options: RectBoardOptions = {}) {
        this.minScale = options.minScale ?? 0.1;
        this.maxScale = options.maxScale ?? 2.6;
        this.padding = options.padding ?? 60;

        this.viewport = container;
        this.viewport.style.overflow = 'hidden';
        if (getComputedStyle(this.viewport).position === 'static') {
            this.viewport.style.position = 'relative';
        }
        this.viewport.style.touchAction = 'none';
        this.viewport.style.cursor = 'grab';

        this.board = document.createElement('div');
        this.board.style.cssText = 'position:absolute; top:0; left:0; transform-origin:0 0; will-change:transform;';
        this.viewport.appendChild(this.board);

        this.onWheel = (e) => this.handleWheel(e);
        this.onDown = (e) => this.handleDown(e);
        this.onMove = (e) => this.handleMove(e);
        this.onUp = () => this.endDrag();
        this.onKey = (e) => this.handleKey(e);
        this.onResize = () => this.refit(false);

        this.viewport.addEventListener('wheel', this.onWheel, {passive: false});
        this.viewport.addEventListener('pointerdown', this.onDown);
        this.viewport.addEventListener('pointermove', this.onMove);
        this.viewport.addEventListener('pointerup', this.onUp);
        this.viewport.addEventListener('pointercancel', this.onUp);
        window.addEventListener('keydown', this.onKey);
        window.addEventListener('resize', this.onResize);
    }

    /** Place a rendered element at world (x, y). Give it an id to target later. */
    public add(el: HTMLElement, x: number, y: number, id?: string): this {
        el.style.position = 'absolute';
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        this.board.appendChild(el);

        const item: Item = {el: el, x: x, y: y};
        if (id !== undefined) {
            this.items.set(id, item);
        } else {
            this.anon.push(item);
        }

        return this;
    }

    /**
     * Auto-route a connector between two added items (by id). Anchor points on
     * the box edges and the path are computed from the live geometry — move or
     * resize the boxes and re-`connect()` and it re-routes. Styles: 'curve'
     * (default), 'orthogonal' (right angles) or 'straight'.
     */
    public connect(fromId: string, toId: string, options: RectRouteOptions = {}): this {
        this.edges.push({from: fromId, to: toId, options: options});
        this.drawEdges();

        return this;
    }

    /** Enable the scroll/arrow-driven camera story over the given item ids. */
    public story(ids: string[], handlers: RectStoryHandlers = {}): this {
        this.storyIds = ids.slice();
        this.handlers = handlers;
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

        this.handlers.onStep?.(clamped, clamped < 0 ? null : (this.storyIds[clamped] as string));
    }

    /** Fly the camera to frame a single item. */
    public focus(id: string, animate = true): void {
        const item = this.items.get(id);

        if (item !== undefined) {
            this.fitRect(item.x, item.y, item.el.offsetWidth, item.el.offsetHeight, animate, 70);
        }
    }

    /** Fly the camera to frame the whole board. */
    public fitAll(animate = true): void {
        let maxX = 0;
        let maxY = 0;

        for (const item of this.allItems()) {
            maxX = Math.max(maxX, item.x + item.el.offsetWidth);
            maxY = Math.max(maxY, item.y + item.el.offsetHeight);
        }

        this.fitRect(0, 0, maxX + this.padding, maxY + this.padding, animate, 40);
    }

    public fitRect(x: number, y: number, w: number, h: number, animate = true, pad = this.padding): void {
        const vw = this.viewport.clientWidth;
        const vh = this.viewport.clientHeight;
        const s = this.clampScale(Math.min((vw - 2 * pad) / w, (vh - 2 * pad) / h));

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
        window.removeEventListener('keydown', this.onKey);
        window.removeEventListener('resize', this.onResize);
        this.board.remove();
    }

    // ---- internals ----

    private allItems(): Item[] {
        return [...this.items.values(), ...this.anon];
    }

    private rectOf(id: string): Rect | null {
        const item = this.items.get(id);

        if (item === undefined) {
            return null;
        }

        return {x: item.x, y: item.y, w: item.el.offsetWidth, h: item.el.offsetHeight};
    }

    private ensureOverlay(): SVGSVGElement {
        if (this.overlay === null) {
            const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
            svg.style.cssText = 'position:absolute; left:0; top:0; overflow:visible; pointer-events:none;';
            this.board.insertBefore(svg, this.board.firstChild); // behind the boxes
            this.overlay = svg;
        }

        return this.overlay;
    }

    /** (Re)draw every auto-routed edge from current box geometry. */
    private drawEdges(): void {
        const svg = this.ensureOverlay();

        while (svg.firstChild !== null) {
            svg.removeChild(svg.firstChild);
        }

        let maxX = 1;
        let maxY = 1;
        for (const item of this.allItems()) {
            maxX = Math.max(maxX, item.x + item.el.offsetWidth);
            maxY = Math.max(maxY, item.y + item.el.offsetHeight);
        }
        svg.setAttribute('width', String(maxX));
        svg.setAttribute('height', String(maxY));
        svg.setAttribute('viewBox', `0 0 ${maxX} ${maxY}`);

        for (const edge of this.edges) {
            const from = this.rectOf(edge.from);
            const to = this.rectOf(edge.to);

            if (from !== null && to !== null) {
                RectBoard.drawEdge(svg, from, to, edge.options);
            }
        }
    }

    private static center(r: Rect): [number, number] {
        return [r.x + r.w / 2, r.y + r.h / 2];
    }

    private static anchor(r: Rect, side: RectSide): [number, number] {
        switch (side) {
            case 'left': return [r.x, r.y + r.h / 2];
            case 'right': return [r.x + r.w, r.y + r.h / 2];
            case 'top': return [r.x + r.w / 2, r.y];
            default: return [r.x + r.w / 2, r.y + r.h];
        }
    }

    /** Outward unit normal of a side. */
    private static normal(side: RectSide): [number, number] {
        switch (side) {
            case 'left': return [-1, 0];
            case 'right': return [1, 0];
            case 'top': return [0, -1];
            default: return [0, 1];
        }
    }

    /** Pick facing sides from the boxes' relative position. */
    private static autoSides(from: Rect, to: Rect): [RectSide, RectSide] {
        const [fx, fy] = RectBoard.center(from);
        const [tx, ty] = RectBoard.center(to);
        const dx = tx - fx;
        const dy = ty - fy;

        if (Math.abs(dx) >= Math.abs(dy)) {
            return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
        }

        return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
    }

    private static drawEdge(svg: SVGSVGElement, from: Rect, to: Rect, o: RectRouteOptions): void {
        const [fromSide, toSide] = (o.fromSide !== undefined && o.toSide !== undefined)
            ? [o.fromSide, o.toSide]
            : RectBoard.autoSides(from, to);
        const [sx, sy] = RectBoard.anchor(from, fromSide);
        const [ex, ey] = RectBoard.anchor(to, toSide);
        const stroke = RectColor.resolve(o.color, 'slate');
        const style = o.style ?? 'curve';

        let d: string;
        if (style === 'straight') {
            d = `M ${sx} ${sy} L ${ex} ${ey}`;
        } else if (style === 'orthogonal') {
            d = RectBoard.orthogonalPath(sx, sy, fromSide, ex, ey, toSide);
        } else {
            const [fnx, fny] = RectBoard.normal(fromSide);
            const [tnx, tny] = RectBoard.normal(toSide);
            const k = Math.max(40, Math.hypot(ex - sx, ey - sy) * 0.4);
            d = `M ${sx} ${sy} C ${sx + fnx * k} ${sy + fny * k} ${ex + tnx * k} ${ey + tny * k} ${ex} ${ey}`;
        }

        const path = RectBoard.svgEl('path', {d: d, fill: 'none', stroke: stroke, 'stroke-width': 1.6});
        if (o.animated) {
            RectAnim.ensure();
            path.setAttribute('stroke-dasharray', '5 4');
            (path as unknown as HTMLElement).style.animation = `${RectAnim.FLOW} 0.7s linear infinite`;
        } else if (o.dashed) {
            path.setAttribute('stroke-dasharray', '3 3');
        }
        svg.appendChild(path);

        if (o.arrow !== false) {
            svg.appendChild(RectBoard.arrowHead(ex, ey, toSide, stroke));
        }

        if (o.dots) {
            RectAnim.ensure();
            for (let i = 0; i < 3; i++) {
                const dot = RectBoard.svgEl('circle', {r: 2, cx: 0, cy: 0, fill: stroke});
                const s = (dot as unknown as HTMLElement).style;
                s.offsetPath = `path("${d}")`;
                s.offsetRotate = '0deg';
                s.animation = `${RectAnim.TRAVEL} 1.2s linear infinite`;
                s.animationDelay = `${(i * 0.4).toFixed(2)}s`;
                svg.appendChild(dot);
            }
        }

        if (o.label !== undefined) {
            const text = RectBoard.svgEl('text', {
                x: (sx + ex) / 2, y: (sy + ey) / 2 - 5, 'text-anchor': 'middle',
                fill: '#8595b5', 'font-size': 10, 'font-family': 'system-ui, sans-serif'
            });
            text.textContent = o.label;
            svg.appendChild(text);
        }
    }

    /** Right-angle path between two anchors, bending at the side midpoints. */
    private static orthogonalPath(sx: number, sy: number, fromSide: RectSide, ex: number, ey: number, toSide: RectSide): string {
        const fromH = fromSide === 'left' || fromSide === 'right';
        const toH = toSide === 'left' || toSide === 'right';

        if (fromH && toH) {
            const mx = (sx + ex) / 2;
            return `M ${sx} ${sy} L ${mx} ${sy} L ${mx} ${ey} L ${ex} ${ey}`;
        }
        if (!fromH && !toH) {
            const my = (sy + ey) / 2;
            return `M ${sx} ${sy} L ${sx} ${my} L ${ex} ${my} L ${ex} ${ey}`;
        }
        // one horizontal, one vertical: single corner
        const cx = fromH ? ex : sx;
        const cy = fromH ? sy : ey;
        return `M ${sx} ${sy} L ${cx} ${cy} L ${ex} ${ey}`;
    }

    private static arrowHead(x: number, y: number, toSide: RectSide, fill: string): SVGElement {
        const s = 4.5;
        let points: string; // tip at the anchor, base outside — arrow points INTO the box
        switch (toSide) {
            case 'left': points = `${x - 7},${y - s} ${x - 7},${y + s} ${x},${y}`; break;
            case 'right': points = `${x + 7},${y - s} ${x + 7},${y + s} ${x},${y}`; break;
            case 'top': points = `${x - s},${y - 7} ${x + s},${y - 7} ${x},${y}`; break;
            default: points = `${x - s},${y + 7} ${x + s},${y + 7} ${x},${y}`; break;
        }
        return RectBoard.svgEl('polygon', {points: points, fill: fill});
    }

    private static svgEl(name: string, attrs: Record<string, string | number>): SVGElement {
        const node = document.createElementNS(SVG_NS, name);
        for (const key of Object.keys(attrs)) {
            node.setAttribute(key, String(attrs[key]));
        }
        return node;
    }

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

    private handleWheel(e: WheelEvent): void {
        e.preventDefault();

        if (e.ctrlKey || e.metaKey || this.storyIds.length === 0) {
            const r = this.viewport.getBoundingClientRect();
            this.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
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

    private handleDown(e: PointerEvent): void {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.viewport.style.cursor = 'grabbing';
        this.viewport.setPointerCapture(e.pointerId);
    }

    private handleMove(e: PointerEvent): void {
        if (!this.dragging) {
            return;
        }

        this.tx += e.clientX - this.lastX;
        this.ty += e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.apply(false);
    }

    private endDrag(): void {
        this.dragging = false;
        this.viewport.style.cursor = 'grab';
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
