export interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * A simple pan/zoom camera mapping world coordinates (where the layout places
 * modules) to screen pixels. screen = world * scale + offset. Because
 * ModelView owns a single canvas with no per-module DOM, every transform —
 * drawing, hit-testing, fit-to-content — goes through here.
 */
export class Camera {

    public scale = 1;
    public offsetX = 0;
    public offsetY = 0;

    private readonly minScale: number;
    private readonly maxScale: number;

    public constructor(minScale = 0.15, maxScale = 3) {
        this.minScale = minScale;
        this.maxScale = maxScale;
    }

    /** Apply the camera to a 2d context so subsequent drawing is in world space. */
    public apply(ctx: CanvasRenderingContext2D): void {
        ctx.translate(this.offsetX, this.offsetY);
        ctx.scale(this.scale, this.scale);
    }

    public toWorld(screenX: number, screenY: number): {x: number; y: number} {
        return {
            x: (screenX - this.offsetX) / this.scale,
            y: (screenY - this.offsetY) / this.scale
        };
    }

    public panBy(dx: number, dy: number): void {
        this.offsetX += dx;
        this.offsetY += dy;
    }

    /** Zoom by `factor`, keeping the world point under (screenX, screenY) fixed. */
    public zoomAt(screenX: number, screenY: number, factor: number): void {
        const before = this.toWorld(screenX, screenY);
        this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
        this.offsetX = screenX - before.x * this.scale;
        this.offsetY = screenY - before.y * this.scale;
    }

    /**
     * Frame the given world bounds inside a viewW×viewH viewport. `padding` is
     * the inset on the left/right/bottom; `padTop` (defaults to `padding`) is
     * the top inset — raise it to keep content clear of a floating toolbar.
     */
    public fit(bounds: Bounds, viewW: number, viewH: number, padding = 48, padTop = padding): void {
        const contentW = Math.max(1, bounds.maxX - bounds.minX);
        const contentH = Math.max(1, bounds.maxY - bounds.minY);
        const scaleX = (viewW - padding * 2) / contentW;
        const scaleY = (viewH - padding - padTop) / contentH;

        this.scale = Math.min(this.maxScale, Math.max(this.minScale, Math.min(scaleX, scaleY)));

        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;

        this.offsetX = viewW / 2 - centerX * this.scale;
        // Vertically centre within the asymmetric band [padTop, viewH - padding].
        this.offsetY = (padTop + (viewH - padding)) / 2 - centerY * this.scale;
    }

}
