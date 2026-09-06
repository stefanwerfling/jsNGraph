import { GraphNode } from '../model/GraphNode';
import { CanvasRenderer } from '../render/CanvasRenderer';

export interface InteractionCallbacks {
    onHover(node: GraphNode | null): void;
    onClick(node: GraphNode | null, clientX: number, clientY: number): void;
}

/**
 * Manual hit-testing for the canvas (no DOM elements per node): tracks
 * pointer position, finds the topmost node under it, and drives
 * hover/click callbacks plus optional drag-to-reposition.
 */
export class InteractionController {

    private hovered: GraphNode | null = null;
    private dragging: GraphNode | null = null;
    private dragWasFixed = false;
    private downPos: {x: number; y: number} | null = null;

    public constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly getNodes: () => GraphNode[],
        private readonly callbacks: InteractionCallbacks,
        private readonly draggable = true
    ) {
        canvas.addEventListener('pointermove', this.onPointerMove);
        canvas.addEventListener('pointerdown', this.onPointerDown);
        canvas.addEventListener('pointerup', this.onPointerUp);
        canvas.addEventListener('pointerleave', this.onPointerLeave);
    }

    public destroy(): void {
        this.canvas.removeEventListener('pointermove', this.onPointerMove);
        this.canvas.removeEventListener('pointerdown', this.onPointerDown);
        this.canvas.removeEventListener('pointerup', this.onPointerUp);
        this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    }

    private hitTest(x: number, y: number): GraphNode | null {
        const nodes = this.getNodes();

        for (let i = nodes.length - 1; i >= 0; i--) {
            const node = nodes[i];

            if (node === undefined) {
                continue;
            }

            const dx = x - node.x;
            const dy = y - node.y;

            if (node.shape === 'card') {
                const size = CanvasRenderer.cardSize(node);

                if (Math.abs(dx) <= size.w / 2 && Math.abs(dy) <= size.h / 2) {
                    return node;
                }

                continue;
            }

            if (dx * dx + dy * dy <= node.radius * node.radius) {
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

        if (this.dragging !== null) {
            this.dragging.x = x;
            this.dragging.y = y;
            this.dragging.vx = 0;
            this.dragging.vy = 0;
            return;
        }

        const hit = this.hitTest(x, y);

        if (hit !== this.hovered) {
            this.hovered = hit;
            this.canvas.style.cursor = hit !== null ? 'pointer' : 'default';
            this.callbacks.onHover(hit);
        }
    };

    private readonly onPointerDown = (event: PointerEvent): void => {
        const {x, y} = this.toLocal(event);
        const hit = this.hitTest(x, y);

        this.downPos = {x: event.clientX, y: event.clientY};

        if (hit !== null && this.draggable) {
            this.dragging = hit;
            this.dragWasFixed = hit.fixed;
            hit.fixed = true;
            this.canvas.setPointerCapture(event.pointerId);
        }
    };

    private readonly onPointerUp = (event: PointerEvent): void => {
        const wasDrag = this.dragging !== null
            && this.downPos !== null
            && Math.hypot(event.clientX - this.downPos.x, event.clientY - this.downPos.y) > 3;

        if (this.dragging !== null) {
            this.dragging.fixed = this.dragWasFixed;
            this.dragging = null;
        }

        if (!wasDrag) {
            const {x, y} = this.toLocal(event);
            const hit = this.hitTest(x, y);

            this.callbacks.onClick(hit, event.clientX, event.clientY);
        }

        this.downPos = null;
    };

    private readonly onPointerLeave = (): void => {
        if (this.hovered !== null) {
            this.hovered = null;
            this.canvas.style.cursor = 'default';
            this.callbacks.onHover(null);
        }
    };

}
