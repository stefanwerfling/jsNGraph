import { GraphEdge } from '../model/GraphEdge';
import { GraphNode } from '../model/GraphNode';
import { Point } from '../util/Geometry';
import { Camera } from '../view/Camera';

/** What the controller needs from its owner: hit-testing in screen space and the camera. */
export interface InteractionHost {
    readonly camera: Camera;
    hitNode(screenX: number, screenY: number): GraphNode | null;
    hitEdge(screenX: number, screenY: number): GraphEdge | null;
    /** Nodes whose centre lies inside the polygon (screen pixels). */
    nodesInPolygon(polygon: ReadonlyArray<Point>): GraphNode[];
}

export interface InteractionOptions {
    /** Drag nodes to reposition them. */
    draggable: boolean;
    /** Wheel/pinch zoom and drag-on-background panning. */
    panZoom: boolean;
    /** Shift+drag on the background draws a lasso. */
    lasso: boolean;
}

/** Modifier state of a click, for multi-select. */
export interface ClickModifiers {
    /** Shift, Ctrl or Cmd held: toggle instead of replace. */
    additive: boolean;
}

export interface InteractionCallbacks {
    onHover(node: GraphNode | null): void;
    onClick(node: GraphNode | null, edge: GraphEdge | null, clientX: number, clientY: number, modifiers: ClickModifiers): void;
    onDoubleClick(node: GraphNode | null, edge: GraphEdge | null, clientX: number, clientY: number): void;
    /** Return true to suppress the browser's own context menu. */
    onContextMenu(node: GraphNode | null, edge: GraphEdge | null, clientX: number, clientY: number): boolean;
    onLasso(nodes: GraphNode[], modifiers: ClickModifiers): void;
    /** Live lasso outline (screen px) while drawing, null when done. */
    onLassoChange(points: ReadonlyArray<Point> | null): void;
    onDragEnd(node: GraphNode): void;
    onViewportChange(): void;
    /** Something visible changed (drag, pan, hover) — draw a frame. */
    onNeedsFrame(): void;
}

type Gesture =
    | {kind: 'none'}
    | {kind: 'pending-node'; node: GraphNode; grabDx: number; grabDy: number}
    | {kind: 'drag-node'; node: GraphNode; grabDx: number; grabDy: number; wasFixed: boolean}
    | {kind: 'pan'; lastX: number; lastY: number}
    | {kind: 'lasso'; points: Point[]; additive: boolean}
    | {kind: 'pinch'; distance: number};

/** A pointer that moves less than this (CSS px) between down and up is a click, not a drag. */
const CLICK_SLOP = 4;

/**
 * Pointer handling for a canvas graph with no per-node DOM: hover, click,
 * double-click and context menu with node/edge hit-testing (delegated to
 * the host, which owns the spatial index), drag-to-reposition, background
 * pan, wheel and two-finger pinch zoom, and shift+drag lasso selection.
 */
export class InteractionController {

    private hovered: GraphNode | null = null;
    private gesture: Gesture = {kind: 'none'};
    private downPos: {x: number; y: number} | null = null;
    private moved = false;
    /** Active touch pointers, for two-finger pinch. */
    private readonly pointers = new Map<number, Point>();

    public constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly host: InteractionHost,
        private readonly callbacks: InteractionCallbacks,
        private options: InteractionOptions
    ) {
        canvas.addEventListener('pointermove', this.onPointerMove);
        canvas.addEventListener('pointerdown', this.onPointerDown);
        canvas.addEventListener('pointerup', this.onPointerUp);
        canvas.addEventListener('pointercancel', this.onPointerCancel);
        canvas.addEventListener('pointerleave', this.onPointerLeave);
        canvas.addEventListener('wheel', this.onWheel, {passive: false});
        canvas.addEventListener('dblclick', this.onDoubleClick);
        canvas.addEventListener('contextmenu', this.onContextMenu);
        this.applyTouchAction();
    }

    public setOptions(options: Partial<InteractionOptions>): void {
        this.options = {...this.options, ...options};
        this.applyTouchAction();
    }

    public destroy(): void {
        this.canvas.removeEventListener('pointermove', this.onPointerMove);
        this.canvas.removeEventListener('pointerdown', this.onPointerDown);
        this.canvas.removeEventListener('pointerup', this.onPointerUp);
        this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
        this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
        this.canvas.removeEventListener('wheel', this.onWheel);
        this.canvas.removeEventListener('dblclick', this.onDoubleClick);
        this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    }

    /** Forget a node that was removed from the graph mid-gesture. */
    public forget(node: GraphNode): void {
        if (this.hovered === node) {
            this.hovered = null;
        }

        if ((this.gesture.kind === 'drag-node' || this.gesture.kind === 'pending-node') && this.gesture.node === node) {
            this.gesture = {kind: 'none'};
        }
    }

    /** Pan/zoom owns touch gestures; otherwise leave page scrolling alone. */
    private applyTouchAction(): void {
        this.canvas.style.touchAction = this.options.panZoom || this.options.draggable ? 'none' : 'auto';
    }

    /**
     * Canvas-local CSS pixels. Uses the canvas' layout size (clientWidth)
     * against its on-screen rect so a CSS-transformed ancestor (a scaled
     * board) does not skew the hit-test.
     */
    private toLocal(event: MouseEvent): Point {
        const rect = this.canvas.getBoundingClientRect();
        const sx = rect.width > 0 ? this.canvas.clientWidth / rect.width : 1;
        const sy = rect.height > 0 ? this.canvas.clientHeight / rect.height : 1;

        return {x: (event.clientX - rect.left) * (sx || 1), y: (event.clientY - rect.top) * (sy || 1)};
    }

    private static additive(event: MouseEvent): ClickModifiers {
        return {additive: event.shiftKey || event.ctrlKey || event.metaKey};
    }

    private readonly onPointerDown = (event: PointerEvent): void => {
        if (event.button !== 0 && event.pointerType === 'mouse') {
            return;
        }

        const p = this.toLocal(event);

        // Only touch pointers can pinch. Tracking mouse pointers too would leak
        // an entry whenever the button is released outside the canvas.
        if (event.pointerType === 'touch') {
            this.pointers.set(event.pointerId, p);
        }

        if (this.pointers.size === 2 && this.options.panZoom) {
            this.cancelGesture();
            this.gesture = {kind: 'pinch', distance: this.pinchDistance()};
            return;
        }

        if (this.pointers.size > 1) {
            return;
        }

        this.downPos = {x: event.clientX, y: event.clientY};
        this.moved = false;
        const hit = this.host.hitNode(p.x, p.y);
        const world = this.host.camera.toWorld(p.x, p.y);

        if (hit !== null && this.options.draggable) {
            this.gesture = {kind: 'pending-node', node: hit, grabDx: hit.x - world.x, grabDy: hit.y - world.y};
        } else if (hit === null && event.shiftKey && this.options.lasso) {
            this.gesture = {kind: 'lasso', points: [p], additive: event.ctrlKey || event.metaKey};
        } else if (hit === null && this.options.panZoom) {
            this.gesture = {kind: 'pan', lastX: p.x, lastY: p.y};
        } else {
            this.gesture = {kind: 'none'};
        }

        if (this.gesture.kind !== 'none') {
            try {
                this.canvas.setPointerCapture(event.pointerId);
            } catch {
                // Synthetic events (tests, some embeds) have no capturable pointer.
            }
        }
    };

    private readonly onPointerMove = (event: PointerEvent): void => {
        const p = this.toLocal(event);

        if (this.pointers.has(event.pointerId)) {
            this.pointers.set(event.pointerId, p);
        }

        if (this.downPos !== null && Math.hypot(event.clientX - this.downPos.x, event.clientY - this.downPos.y) > CLICK_SLOP) {
            this.moved = true;
        }

        const gesture = this.gesture;

        switch (gesture.kind) {
            case 'pinch': {
                const distance = this.pinchDistance();
                const mid = this.pinchMidpoint();

                if (gesture.distance > 0 && distance > 0) {
                    this.host.camera.zoomAt(mid.x, mid.y, distance / gesture.distance);
                    gesture.distance = distance;
                    this.callbacks.onViewportChange();
                    this.callbacks.onNeedsFrame();
                }

                return;
            }
            case 'pending-node':
                if (this.moved) {
                    this.gesture = {
                        kind: 'drag-node',
                        node: gesture.node,
                        grabDx: gesture.grabDx,
                        grabDy: gesture.grabDy,
                        wasFixed: gesture.node.fixed
                    };
                    gesture.node.fixed = true;
                    this.onPointerMove(event);
                }

                return;
            case 'drag-node': {
                const world = this.host.camera.toWorld(p.x, p.y);

                gesture.node.x = world.x + gesture.grabDx;
                gesture.node.y = world.y + gesture.grabDy;
                gesture.node.vx = 0;
                gesture.node.vy = 0;
                this.callbacks.onNeedsFrame();
                return;
            }
            case 'pan':
                if (this.moved) {
                    this.host.camera.panBy(p.x - gesture.lastX, p.y - gesture.lastY);
                    this.canvas.style.cursor = 'grabbing';
                    this.callbacks.onViewportChange();
                    this.callbacks.onNeedsFrame();
                }

                gesture.lastX = p.x;
                gesture.lastY = p.y;
                return;
            case 'lasso': {
                const last = gesture.points[gesture.points.length - 1] as Point;

                if (Math.hypot(p.x - last.x, p.y - last.y) >= 3) {
                    gesture.points.push(p);
                    this.callbacks.onLassoChange(gesture.points);
                }

                return;
            }
            default:
                break;
        }

        const hit = this.host.hitNode(p.x, p.y);

        if (hit !== this.hovered) {
            this.hovered = hit;
            this.canvas.style.cursor = hit !== null ? 'pointer' : 'default';
            this.callbacks.onHover(hit);
        }
    };

    private readonly onPointerUp = (event: PointerEvent): void => {
        this.pointers.delete(event.pointerId);
        const gesture = this.gesture;
        const p = this.toLocal(event);

        if (gesture.kind === 'pinch') {
            // Lifting one finger ends the pinch; don't turn the other into a click.
            this.gesture = {kind: 'none'};
            this.downPos = null;
            return;
        }

        if (gesture.kind === 'drag-node') {
            gesture.node.fixed = gesture.wasFixed;
            this.callbacks.onDragEnd(gesture.node);
        } else if (gesture.kind === 'lasso') {
            this.callbacks.onLassoChange(null);

            if (gesture.points.length > 2 && this.moved) {
                this.callbacks.onLasso(this.host.nodesInPolygon(gesture.points), {additive: gesture.additive});
            }
        }

        if (gesture.kind === 'pan') {
            this.canvas.style.cursor = this.hovered !== null ? 'pointer' : 'default';
        }

        const wasClick = this.downPos !== null && !this.moved && gesture.kind !== 'lasso';

        this.gesture = {kind: 'none'};
        this.downPos = null;

        if (wasClick) {
            const node = this.host.hitNode(p.x, p.y);
            const edge = node === null ? this.host.hitEdge(p.x, p.y) : null;

            this.callbacks.onClick(node, edge, event.clientX, event.clientY, InteractionController.additive(event));
        }
    };

    private readonly onPointerCancel = (event: PointerEvent): void => {
        this.pointers.delete(event.pointerId);
        this.cancelGesture();
    };

    private readonly onPointerLeave = (): void => {
        if (this.gesture.kind !== 'none') {
            return;
        }

        if (this.hovered !== null) {
            this.hovered = null;
            this.canvas.style.cursor = 'default';
            this.callbacks.onHover(null);
        }
    };

    private readonly onWheel = (event: WheelEvent): void => {
        if (!this.options.panZoom) {
            return;
        }

        event.preventDefault();
        const p = this.toLocal(event);
        // Line-mode wheels (Firefox) report ~3 per notch; pixel-mode ~100.
        const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;

        this.host.camera.zoomAt(p.x, p.y, Math.exp(-delta * 0.0015));
        this.callbacks.onViewportChange();
        this.callbacks.onNeedsFrame();
    };

    private readonly onDoubleClick = (event: MouseEvent): void => {
        const p = this.toLocal(event);
        const node = this.host.hitNode(p.x, p.y);
        const edge = node === null ? this.host.hitEdge(p.x, p.y) : null;

        this.callbacks.onDoubleClick(node, edge, event.clientX, event.clientY);
    };

    private readonly onContextMenu = (event: MouseEvent): void => {
        const p = this.toLocal(event);
        const node = this.host.hitNode(p.x, p.y);
        const edge = node === null ? this.host.hitEdge(p.x, p.y) : null;

        if (this.callbacks.onContextMenu(node, edge, event.clientX, event.clientY)) {
            event.preventDefault();
        }
    };

    private cancelGesture(): void {
        const gesture = this.gesture;

        if (gesture.kind === 'drag-node') {
            gesture.node.fixed = gesture.wasFixed;
        }

        if (gesture.kind === 'lasso') {
            this.callbacks.onLassoChange(null);
        }

        this.gesture = {kind: 'none'};
        this.downPos = null;
    }

    private pinchDistance(): number {
        const [a, b] = [...this.pointers.values()];

        return a !== undefined && b !== undefined ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    }

    private pinchMidpoint(): Point {
        const [a, b] = [...this.pointers.values()];

        return a !== undefined && b !== undefined ? {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2} : {x: 0, y: 0};
    }

}
