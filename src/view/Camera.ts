import { Bounds } from '../util/Geometry';

export type { Bounds };

/** A camera pose: screen = world * scale + offset. */
export interface CameraState {
    scale: number;
    offsetX: number;
    offsetY: number;
}

interface CameraFlight {
    from: CameraState;
    to: CameraState;
    startMs: number | null;
    durationMs: number;
}

/**
 * A pan/zoom camera mapping world coordinates (where the layout places
 * things) to screen pixels: screen = world * scale + offset. Every
 * transform — drawing, hit-testing, fit-to-content — goes through here,
 * because a canvas has no per-node DOM to transform.
 *
 * Moves can be instant (`fit`, `zoomAt`, `setState`) or animated
 * (`flyTo`, then `step(nowMs)` once per frame until it returns false).
 * Any direct move cancels a running flight, so user input always wins.
 */
export class Camera {

    public scale = 1;
    public offsetX = 0;
    public offsetY = 0;

    private readonly minScale: number;
    private readonly maxScale: number;
    private flight: CameraFlight | null = null;

    public constructor(minScale = 0.15, maxScale = 3) {
        this.minScale = minScale;
        this.maxScale = maxScale;
    }

    public get limits(): {min: number; max: number} {
        return {min: this.minScale, max: this.maxScale};
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

    public toScreen(worldX: number, worldY: number): {x: number; y: number} {
        return {
            x: worldX * this.scale + this.offsetX,
            y: worldY * this.scale + this.offsetY
        };
    }

    /** The world rectangle currently visible in a viewW×viewH viewport. */
    public viewBounds(viewW: number, viewH: number): Bounds {
        const topLeft = this.toWorld(0, 0);
        const bottomRight = this.toWorld(viewW, viewH);

        return {minX: topLeft.x, minY: topLeft.y, maxX: bottomRight.x, maxY: bottomRight.y};
    }

    public getState(): CameraState {
        return {scale: this.scale, offsetX: this.offsetX, offsetY: this.offsetY};
    }

    public setState(state: CameraState): void {
        this.flight = null;
        this.scale = this.clampScale(state.scale);
        this.offsetX = state.offsetX;
        this.offsetY = state.offsetY;
    }

    public panBy(dx: number, dy: number): void {
        this.flight = null;
        this.offsetX += dx;
        this.offsetY += dy;
    }

    /** Zoom by `factor`, keeping the world point under (screenX, screenY) fixed. */
    public zoomAt(screenX: number, screenY: number, factor: number): void {
        this.flight = null;
        const before = this.toWorld(screenX, screenY);
        this.scale = this.clampScale(this.scale * factor);
        this.offsetX = screenX - before.x * this.scale;
        this.offsetY = screenY - before.y * this.scale;
    }

    /**
     * Frame the given world bounds inside a viewW×viewH viewport. `padding` is
     * the inset on the left/right/bottom; `padTop` (defaults to `padding`) is
     * the top inset — raise it to keep content clear of a floating toolbar.
     */
    public fit(bounds: Bounds, viewW: number, viewH: number, padding = 48, padTop = padding): void {
        this.setState(this.fitState(bounds, viewW, viewH, padding, padTop));
    }

    /** The pose `fit` would produce, without moving — feed it to `flyTo` for an animated fit. */
    public fitState(bounds: Bounds, viewW: number, viewH: number, padding = 48, padTop = padding): CameraState {
        const contentW = Math.max(1, bounds.maxX - bounds.minX);
        const contentH = Math.max(1, bounds.maxY - bounds.minY);
        const scaleX = (viewW - padding * 2) / contentW;
        const scaleY = (viewH - padding - padTop) / contentH;
        const scale = this.clampScale(Math.min(scaleX, scaleY));
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;

        return {
            scale: scale,
            offsetX: viewW / 2 - centerX * scale,
            // Vertically centre within the asymmetric band [padTop, viewH - padding].
            offsetY: (padTop + (viewH - padding)) / 2 - centerY * scale
        };
    }

    /** The pose that centres world point (x, y) in the viewport at `scale` (default: current). */
    public centerState(x: number, y: number, viewW: number, viewH: number, scale = this.scale): CameraState {
        const s = this.clampScale(scale);

        return {scale: s, offsetX: viewW / 2 - x * s, offsetY: viewH / 2 - y * s};
    }

    /** Start an animated move to `target`. durationMs <= 0 jumps immediately. */
    public flyTo(target: CameraState, durationMs = 400): void {
        const to = {...target, scale: this.clampScale(target.scale)};

        if (durationMs <= 0) {
            this.setState(to);
            return;
        }

        this.flight = {from: this.getState(), to: to, startMs: null, durationMs: durationMs};
    }

    public get animating(): boolean {
        return this.flight !== null;
    }

    /**
     * Advance a running flight to `nowMs`. Returns true while it is still in
     * flight (call again next frame), false once it has landed or none ran.
     * The first step after `flyTo` anchors the start time, so a flight never
     * skips ahead because the frame came late.
     */
    public step(nowMs: number): boolean {
        const flight = this.flight;

        if (flight === null) {
            return false;
        }

        flight.startMs ??= nowMs;
        const t = Math.min(1, (nowMs - flight.startMs) / flight.durationMs);

        if (t >= 1) {
            this.scale = flight.to.scale;
            this.offsetX = flight.to.offsetX;
            this.offsetY = flight.to.offsetY;
            this.flight = null;
            return false;
        }

        // Zoom interpolates in log space so a 10x zoom feels even; the world
        // point at the screen origin interpolates linearly alongside it.
        const e = Camera.easeInOutCubic(t);
        const scale = Math.exp(Math.log(flight.from.scale) + (Math.log(flight.to.scale) - Math.log(flight.from.scale)) * e);
        const fromOrigin = Camera.worldAtOrigin(flight.from);
        const toOrigin = Camera.worldAtOrigin(flight.to);

        this.scale = scale;
        this.offsetX = -(fromOrigin.x + (toOrigin.x - fromOrigin.x) * e) * scale;
        this.offsetY = -(fromOrigin.y + (toOrigin.y - fromOrigin.y) * e) * scale;
        return true;
    }

    public cancelFlight(): void {
        this.flight = null;
    }

    private clampScale(scale: number): number {
        return Math.min(this.maxScale, Math.max(this.minScale, scale));
    }

    /** World point that a pose maps to screen (0, 0). */
    private static worldAtOrigin(state: CameraState): {x: number; y: number} {
        return {x: -state.offsetX / state.scale, y: -state.offsetY / state.scale};
    }

    private static easeInOutCubic(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

}
