export type FrameRequester = (callback: (timeMs: number) => void) => number;
export type FrameCanceller = (handle: number) => void;

/**
 * On-demand animation-frame loop. Nothing runs unless someone asks for a
 * frame (`request`); the frame callback returns true when it needs another
 * one (layout still moving, camera flight, animated edges) and false once
 * the picture is static. So an idle graph costs zero CPU, and a graph in a
 * hidden PKG-Studio tab costs zero too: `pause` blocks every frame until
 * `resume`, which re-requests one so the picture catches up.
 *
 * The frame scheduler is injectable so the loop is testable without a
 * browser.
 */
export class RenderLoop {

    private handle: number | null = null;
    private paused = false;
    private pending = false;

    public constructor(
        private readonly onFrame: (timeMs: number) => boolean,
        private readonly requestFrame: FrameRequester = (cb) => requestAnimationFrame(cb),
        private readonly cancelFrame: FrameCanceller = (h) => cancelAnimationFrame(h)
    ) {
    }

    /** Ask for a frame. Cheap and idempotent: many calls before the next frame coalesce into one. */
    public request(): void {
        if (this.paused) {
            this.pending = true;
            return;
        }

        if (this.handle !== null) {
            return;
        }

        this.handle = this.requestFrame(this.tick);
    }

    /** Stop drawing until `resume`. Requests made meanwhile are remembered, not lost. */
    public pause(): void {
        if (this.paused) {
            return;
        }

        this.paused = true;

        if (this.handle !== null) {
            this.cancelFrame(this.handle);
            this.handle = null;
            this.pending = true;
        }
    }

    /** Leave the paused state and draw one catch-up frame (more if the scene is still animating). */
    public resume(): void {
        if (!this.paused) {
            return;
        }

        this.paused = false;
        this.pending = false;
        this.request();
    }

    public get isPaused(): boolean {
        return this.paused;
    }

    /** True while a frame is scheduled (the scene is animating or a redraw is pending). */
    public get isRunning(): boolean {
        return this.handle !== null;
    }

    /** True when a request arrived while paused. */
    public get hasPending(): boolean {
        return this.pending;
    }

    public destroy(): void {
        if (this.handle !== null) {
            this.cancelFrame(this.handle);
            this.handle = null;
        }

        this.paused = true;
        this.pending = false;
    }

    private readonly tick = (timeMs: number): void => {
        this.handle = null;

        if (this.paused) {
            return;
        }

        if (this.onFrame(timeMs)) {
            this.request();
        }
    };

}
