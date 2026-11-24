import { Camera, CameraState } from '../view/Camera';
import { RectArea, RectBoardGeometry, RectPoint } from '../rect/RectBoardGeometry';

/** What the viewport needs from the editor. */
export interface WorkflowViewportHost {
    readonly root: HTMLDivElement;
    readonly stage: HTMLDivElement;
    readonly grid: number;
    readonly fitOnLoad: boolean;
    /** Bounding box of everything drawn, or null when empty. */
    bounds(): RectArea | null;
    /** The camera moved (the minimap redraws). */
    changed(): void;
}

/**
 * The editor's view onto the stage (internal): applies the camera to the
 * stage transform and the dotted background, flies to framings, and keeps
 * re-fitting on resize until the user pans or zooms.
 */
export class WorkflowViewport {

    public readonly camera: Camera;
    /** Until the user pans/zooms, the view re-fits on resize. */
    private userMoved = false;
    private pendingFit = false;
    private flightFrame: number | null = null;
    private readonly resizeObserver: ResizeObserver | null = null;

    public constructor(private readonly host: WorkflowViewportHost, minScale: number, maxScale: number) {
        this.camera = new Camera(minScale, maxScale);

        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                if (this.pendingFit || (!this.userMoved && host.fitOnLoad)) {
                    this.fit(false);
                }
            });
            this.resizeObserver.observe(host.root);
        }
    }

    /** The user moved the view: stop auto-fitting. */
    public markMoved(): void {
        this.userMoved = true;
    }

    /** Auto-fit on resize again (after a load or tidy-up). */
    public resetMoved(): void {
        this.userMoved = false;
    }

    /** Root-local px of a mouse event. */
    public local(e: MouseEvent): RectPoint {
        const r = this.host.root.getBoundingClientRect();

        return {x: e.clientX - r.left, y: e.clientY - r.top};
    }

    /** World coordinates of a client point. */
    public toWorld(clientX: number, clientY: number): RectPoint {
        const r = this.host.root.getBoundingClientRect();

        return this.camera.toWorld(clientX - r.left, clientY - r.top);
    }

    public apply(): void {
        const {scale, offsetX, offsetY} = this.camera;
        const step = (this.host.grid > 0 ? this.host.grid : 20) * scale;
        const root = this.host.root;

        this.host.stage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        this.host.changed();
        root.style.backgroundSize = `${step}px ${step}px`;
        root.style.backgroundPosition = `${offsetX}px ${offsetY}px`;
    }

    /** Frame everything drawn (never past 1:1); waits for a size when the root has none. */
    public fit(animate: boolean): void {
        const w = this.host.root.clientWidth;
        const h = this.host.root.clientHeight;

        if (w === 0 || h === 0) {
            this.pendingFit = true;
            return;
        }

        this.pendingFit = false;
        const box = this.host.bounds();

        if (box === null) {
            this.camera.setState({scale: 1, offsetX: 0, offsetY: 0});
            this.apply();
            return;
        }

        const target = this.camera.fitState(
            {minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h}, w, h, 48
        );
        // Never blow a small workflow up past 1:1.
        const capped = target.scale > 1 ? this.camera.centerState(box.x + box.w / 2, box.y + box.h / 2, w, h, 1) : target;

        this.flyTo(capped, animate);
    }

    /** Centre a world rect, optionally at a zoom. */
    public focus(rect: RectArea, scale: number | undefined, animate: boolean): void {
        const c = RectBoardGeometry.center(rect);

        this.flyTo(this.camera.centerState(c.x, c.y, this.host.root.clientWidth, this.host.root.clientHeight, scale), animate);
    }

    /** Centre a world point at the current zoom (user move). */
    public centerOn(p: RectPoint): void {
        this.userMoved = true;
        this.camera.setState(this.camera.centerState(p.x, p.y, this.host.root.clientWidth, this.host.root.clientHeight));
        this.apply();
    }

    /** Zoom around a root-local point (user move). */
    public zoomAt(x: number, y: number, factor: number): void {
        this.userMoved = true;
        this.camera.zoomAt(x, y, factor);
        this.apply();
    }

    /** Pan by screen px (user move). */
    public panBy(dx: number, dy: number): void {
        this.userMoved = true;
        this.camera.panBy(dx, dy);
        this.apply();
    }

    /** Set the camera (user move). */
    public setState(state: CameraState): void {
        this.userMoved = true;
        this.camera.setState(state);
        this.apply();
    }

    /** The visible world area. */
    public viewRect(): RectArea {
        const b = this.camera.viewBounds(this.host.root.clientWidth, this.host.root.clientHeight);

        return {x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY};
    }

    private flyTo(state: CameraState, animate: boolean): void {
        if (this.flightFrame !== null) {
            cancelAnimationFrame(this.flightFrame);
            this.flightFrame = null;
        }

        if (!animate || typeof requestAnimationFrame === 'undefined') {
            this.camera.setState(state);
            this.apply();
            return;
        }

        this.camera.flyTo(state, 350);

        const frame = (now: number): void => {
            const more = this.camera.step(now);
            this.apply();
            this.flightFrame = more ? requestAnimationFrame(frame) : null;
        };

        this.flightFrame = requestAnimationFrame(frame);
    }

    public destroy(): void {
        if (this.flightFrame !== null) {
            cancelAnimationFrame(this.flightFrame);
        }
        this.resizeObserver?.disconnect();
    }

}
