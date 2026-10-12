import { Camera } from './Camera';
import { ModelNode } from './ModelNode';

export interface ModelInteractionCallbacks {
    onHover(node: ModelNode | null): void;
    onClick(node: ModelNode | null, clientX: number, clientY: number): void;
    /** Fired after any pan/zoom so the owner can request a redraw if idle. */
    onCameraChange(): void;
}

/**
 * Pointer + wheel handling for the model canvas. There is no per-module DOM,
 * so hit-testing is manual and runs in world space via the Camera: drag the
 * background to pan, wheel to zoom at the cursor, click a block to select it.
 */
export class ModelInteraction {

    private hovered: ModelNode | null = null;
    private panning = false;
    private moved = false;
    private lastX = 0;
    private lastY = 0;
    private downPos: {x: number; y: number} | null = null;

    public constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly camera: Camera,
        private readonly getNodes: () => ModelNode[],
        private readonly callbacks: ModelInteractionCallbacks
    ) {
        canvas.addEventListener('pointermove', this.onPointerMove);
        canvas.addEventListener('pointerdown', this.onPointerDown);
        canvas.addEventListener('pointerup', this.onPointerUp);
        canvas.addEventListener('pointerleave', this.onPointerLeave);
        canvas.addEventListener('wheel', this.onWheel, {passive: false});
    }

    public destroy(): void {
        this.canvas.removeEventListener('pointermove', this.onPointerMove);
        this.canvas.removeEventListener('pointerdown', this.onPointerDown);
        this.canvas.removeEventListener('pointerup', this.onPointerUp);
        this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
        this.canvas.removeEventListener('wheel', this.onWheel);
    }

    private hitTest(worldX: number, worldY: number): ModelNode | null {
        const nodes = this.getNodes();

        for (let i = nodes.length - 1; i >= 0; i--) {
            const node = nodes[i];

            if (node === undefined) {
                continue;
            }

            if (Math.abs(worldX - node.x) <= node.w / 2 && Math.abs(worldY - node.y) <= node.h / 2) {
                return node;
            }
        }

        return null;
    }

    private toLocal(event: PointerEvent): {x: number; y: number} {
        const rect = this.canvas.getBoundingClientRect();

        return {x: event.clientX - rect.left, y: event.clientY - rect.top};
    }

    private readonly onPointerMove = (event: PointerEvent): void => {
        const {x, y} = this.toLocal(event);

        if (this.panning) {
            this.camera.panBy(x - this.lastX, y - this.lastY);
            this.lastX = x;
            this.lastY = y;

            if (this.downPos !== null && Math.hypot(x - this.downPos.x, y - this.downPos.y) > 3) {
                this.moved = true;
            }

            this.callbacks.onCameraChange();
            return;
        }

        const world = this.camera.toWorld(x, y);
        const hit = this.hitTest(world.x, world.y);

        if (hit !== this.hovered) {
            this.hovered = hit;
            this.canvas.style.cursor = hit !== null ? 'pointer' : 'grab';
            this.callbacks.onHover(hit);
        }
    };

    private readonly onPointerDown = (event: PointerEvent): void => {
        const {x, y} = this.toLocal(event);

        this.panning = true;
        this.moved = false;
        this.lastX = x;
        this.lastY = y;
        this.downPos = {x: x, y: y};
        this.canvas.style.cursor = 'grabbing';
        this.canvas.setPointerCapture(event.pointerId);
    };

    private readonly onPointerUp = (event: PointerEvent): void => {
        const wasDrag = this.moved;

        this.panning = false;
        this.downPos = null;
        this.canvas.style.cursor = this.hovered !== null ? 'pointer' : 'grab';

        if (!wasDrag) {
            const {x, y} = this.toLocal(event);
            const world = this.camera.toWorld(x, y);
            const hit = this.hitTest(world.x, world.y);

            this.callbacks.onClick(hit, event.clientX, event.clientY);
        }
    };

    private readonly onPointerLeave = (): void => {
        if (this.hovered !== null) {
            this.hovered = null;
            this.canvas.style.cursor = 'default';
            this.callbacks.onHover(null);
        }
    };

    private readonly onWheel = (event: WheelEvent): void => {
        event.preventDefault();

        const rect = this.canvas.getBoundingClientRect();
        const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;

        this.camera.zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
        this.callbacks.onCameraChange();
    };

}
