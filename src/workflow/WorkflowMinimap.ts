import { RectArea, RectBoardGeometry, RectPoint } from '../rect/RectBoardGeometry';

/** One rectangle the minimap draws. */
export interface WorkflowMinimapItem {
    rect: RectArea;
    kind: 'node' | 'note';
    /** Fill (any CSS colour); default from the theme. */
    color?: string;
    selected?: boolean;
    error?: boolean;
}

/** What the minimap needs from its editor. */
export interface WorkflowMinimapHost {
    items(): WorkflowMinimapItem[];
    /** The world rectangle currently visible. */
    viewport(): RectArea;
    /** Centre the view on a world point. */
    centerOn(point: RectPoint): void;
}

/** World → minimap pixels: p_map = (p_world - origin) * scale + pad offset. */
export interface WorkflowMinimapFrame {
    scale: number;
    offsetX: number;
    offsetY: number;
}

/**
 * Overview of the whole workflow in a corner of the editor: nodes and notes
 * as small rectangles plus the visible area as a frame. Click or drag on it
 * to move the view there. Drawn on a canvas, redrawn at most once a frame.
 */
export class WorkflowMinimap {

    public static readonly WIDTH = 200;
    public static readonly HEIGHT = 132;
    private static readonly PAD = 8;

    private readonly canvas: HTMLCanvasElement;
    private frame: WorkflowMinimapFrame = {scale: 1, offsetX: 0, offsetY: 0};
    private pending: number | null = null;
    private dragging = false;

    private readonly onDown = (e: PointerEvent): void => {
        e.stopPropagation();
        e.preventDefault();
        this.dragging = true;
        this.canvas.setPointerCapture(e.pointerId);
        this.jump(e);
    };
    private readonly onMove = (e: PointerEvent): void => {
        if (this.dragging) {
            this.jump(e);
        }
    };
    private readonly onUp = (e: PointerEvent): void => {
        this.dragging = false;
        this.schedule();
        if (this.canvas.hasPointerCapture(e.pointerId)) {
            this.canvas.releasePointerCapture(e.pointerId);
        }
    };
    private readonly onWheel = (e: WheelEvent): void => e.stopPropagation();

    public constructor(parent: HTMLElement, private readonly host: WorkflowMinimapHost) {
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'wf-minimap';
        this.canvas.style.width = `${WorkflowMinimap.WIDTH}px`;
        this.canvas.style.height = `${WorkflowMinimap.HEIGHT}px`;
        this.canvas.addEventListener('pointerdown', this.onDown);
        this.canvas.addEventListener('pointermove', this.onMove);
        this.canvas.addEventListener('pointerup', this.onUp);
        this.canvas.addEventListener('pointercancel', this.onUp);
        this.canvas.addEventListener('wheel', this.onWheel);
        parent.appendChild(this.canvas);
        this.schedule();
    }

    /**
     * Fit `world` into a w×h map with `pad` px inset, keeping the aspect ratio
     * and centring the slack.
     */
    public static fit(world: RectArea, w: number, h: number, pad: number): WorkflowMinimapFrame {
        const ww = Math.max(1, world.w);
        const wh = Math.max(1, world.h);
        const scale = Math.min((w - pad * 2) / ww, (h - pad * 2) / wh);

        return {
            scale,
            offsetX: (w - ww * scale) / 2 - world.x * scale,
            offsetY: (h - wh * scale) / 2 - world.y * scale
        };
    }

    /** Minimap pixel → world point under a frame. */
    public static toWorld(frame: WorkflowMinimapFrame, x: number, y: number): RectPoint {
        return {x: (x - frame.offsetX) / frame.scale, y: (y - frame.offsetY) / frame.scale};
    }

    /** Redraw on the next animation frame (calls coalesce). */
    public schedule(): void {
        if (this.pending !== null) {
            return;
        }
        if (typeof requestAnimationFrame === 'undefined') {
            this.draw();
            return;
        }
        this.pending = requestAnimationFrame(() => {
            this.pending = null;
            this.draw();
        });
    }

    public destroy(): void {
        if (this.pending !== null) {
            cancelAnimationFrame(this.pending);
        }
        this.canvas.remove();
    }

    private draw(): void {
        const ctx = this.canvas.getContext('2d');

        if (ctx === null) {
            return;
        }

        const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
        const w = WorkflowMinimap.WIDTH;
        const h = WorkflowMinimap.HEIGHT;

        if (this.canvas.width !== Math.round(w * dpr)) {
            this.canvas.width = Math.round(w * dpr);
            this.canvas.height = Math.round(h * dpr);
        }

        const items = this.host.items();
        const view = this.host.viewport();
        // Frame content and view together, so the view frame is always on the map.
        const world = RectBoardGeometry.bounds([...items.map((i) => i.rect), view]) ?? view;
        const style = getComputedStyle(this.canvas);
        const token = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;

        // While dragging on the map, keep its scale: the view frame is part of
        // the bounds, so refitting would move the map under the pointer.
        if (!this.dragging) {
            this.frame = WorkflowMinimap.fit(world, w, h, WorkflowMinimap.PAD);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const map = (r: RectArea): RectArea => ({
            x: r.x * this.frame.scale + this.frame.offsetX,
            y: r.y * this.frame.scale + this.frame.offsetY,
            w: Math.max(2, r.w * this.frame.scale),
            h: Math.max(2, r.h * this.frame.scale)
        });

        for (const item of items) {
            const r = map(item.rect);

            if (item.kind === 'note') {
                ctx.globalAlpha = 0.35;
                ctx.fillStyle = item.color ?? token('--wf-note', '#e8b931');
            } else {
                ctx.globalAlpha = 1;
                ctx.fillStyle = item.error === true ? token('--wf-bad', '#ef5b5b')
                    : item.selected === true ? token('--wf-sel', '#7aa2ff')
                        : item.color ?? token('--wf-edge', '#6b7488');
            }
            ctx.fillRect(r.x, r.y, r.w, r.h);
        }

        const v = map(view);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = token('--wf-sel', '#7aa2ff');
        ctx.lineWidth = 1.5;
        ctx.strokeRect(v.x, v.y, v.w, v.h);
    }

    private jump(e: PointerEvent): void {
        const r = this.canvas.getBoundingClientRect();

        this.host.centerOn(WorkflowMinimap.toWorld(this.frame, e.clientX - r.left, e.clientY - r.top));
    }

}
