import { RectBoardOptions, RectStoryHandlers } from './RectKitTypes';

interface Item {
    el: HTMLElement;
    x: number;
    y: number;
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
