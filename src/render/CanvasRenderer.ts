import { GraphEdge } from '../model/GraphEdge';
import { GraphNode } from '../model/GraphNode';
import { Bounds, Geometry, Point } from '../util/Geometry';
import { Color } from '../util/Color';
import { Camera } from '../view/Camera';
import { NodeIcons } from './NodeIcons';
import { ResolvedEdgeStyle, ResolvedNodeStyle, StyleResolver } from './StyleResolver';
import { ThemeTokens } from './Theme';

/** Everything one frame needs. Built by NGraph, consumed read-only here. */
export interface RenderScene {
    nodes: ReadonlyArray<GraphNode>;
    edges: ReadonlyArray<GraphEdge>;
    camera: Camera;
    /** Viewport size in CSS pixels. */
    width: number;
    height: number;
    timeMs: number;
    hoveredId: string | null;
    selection: ReadonlySet<string>;
    /** Highlighted node ids, or null for no highlight. */
    highlight: ReadonlySet<string> | null;
    dimOthers: boolean;
    showLabels: boolean;
    /** Below this camera scale node labels are skipped (they would be unreadable). */
    labelMinZoom: number;
    edgeStyle: 'line' | 'curve';
    grid: boolean;
    /** Lasso polygon in screen pixels while the user draws one. */
    lasso: ReadonlyArray<Point> | null;
    styles: StyleResolver;
}

export type Cubic = [Point, Point, Point, Point];

interface NodeDrawState {
    hovered: boolean;
    selected: boolean;
    highlighted: boolean;
    alpha: number;
    showLabel: boolean;
}

/**
 * Draws the current graph state to a canvas: background grid, edges (load-
 * colored or styled, with arrowheads, dashes, labels, traffic dots), then
 * nodes (device circles, cards or plain dots) with labels on top.
 *
 * World-space content goes through the camera; nodes and edges outside the
 * viewport are culled. `draw` reports whether something on screen is
 * animating, so the render loop can go idle when nothing is.
 */
export class CanvasRenderer {

    private readonly ctx: CanvasRenderingContext2D;
    private theme: ThemeTokens;

    public constructor(private readonly canvas: HTMLCanvasElement, theme: ThemeTokens) {
        const ctx = canvas.getContext('2d');

        if (ctx === null) {
            throw new Error('CanvasRenderer: 2d context unavailable');
        }

        this.ctx = ctx;
        this.theme = theme;
    }

    public setTheme(theme: ThemeTokens): void {
        this.theme = theme;
    }

    /** Draw one frame. Returns true when a visible element animates (traffic dots, pulse). */
    public draw(scene: RenderScene): boolean {
        const {ctx, canvas, theme} = this;
        const dpr = window.devicePixelRatio || 1;
        const {camera} = scene;
        const view = Geometry.expand(camera.viewBounds(scene.width, scene.height), 60 / camera.scale);
        const dimOpacity = theme.dimOpacity ?? 0.15;
        const highlight = scene.highlight;
        let animating = false;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(dpr, dpr);
        ctx.fillStyle = theme.background;
        ctx.fillRect(0, 0, scene.width, scene.height);

        if (scene.grid) {
            this.drawGrid(scene);
        }

        ctx.save();
        camera.apply(ctx);

        const zoomedIn = camera.scale >= scene.labelMinZoom;

        for (const edge of scene.edges) {
            if (!CanvasRenderer.edgeVisible(edge, view)) {
                continue;
            }

            const style = scene.styles.edge(edge);
            const dimmed = highlight !== null && scene.dimOthers
                && !(highlight.has(edge.source.id) && highlight.has(edge.target.id));

            if (this.drawEdge(edge, style, dimmed ? dimOpacity : 1, scene, zoomedIn)) {
                animating = true;
            }
        }

        const showLabels = scene.showLabels && zoomedIn;

        for (const node of scene.nodes) {
            const style = scene.styles.node(node);
            const extent = style.shape === 'card' ? CanvasRenderer.cardSize(node).w / 2 : style.radius + 30;

            if (node.x + extent < view.minX || node.x - extent > view.maxX
                || node.y + extent < view.minY || node.y - extent > view.maxY) {
                continue;
            }

            const highlighted = highlight !== null && highlight.has(node.id);
            const dimmed = highlight !== null && scene.dimOthers && !highlighted;

            this.drawNode(node, style, {
                hovered: node.id === scene.hoveredId,
                selected: scene.selection.has(node.id),
                highlighted: highlighted,
                alpha: (dimmed ? dimOpacity : 1) * style.opacity,
                showLabel: showLabels
            }, scene.timeMs);

            if (node.pulse && !dimmed) {
                animating = true;
            }
        }

        ctx.restore();

        if (scene.lasso !== null && scene.lasso.length > 1) {
            this.drawLasso(scene.lasso);
        }

        return animating;
    }

    /** Card width/height used for drawing AND hit-testing. */
    public static cardSize(node: GraphNode): {w: number; h: number} {
        const labelW = 7.2 * node.label.length;
        const subW = node.sublabel !== null ? 5.4 * node.sublabel.length : 0;
        const w = Math.max(120, Math.min(210, 52 + Math.max(labelW, subW) + 14));

        return {w: w, h: 46};
    }

    /** Border-to-border horizontal bezier: leaves the source's facing side,
     *  enters the target's facing side — the workflow-editor edge. */
    public static curvePoints(edge: GraphEdge): Cubic {
        const {source, target} = edge;
        const dir = target.x >= source.x ? 1 : -1;
        const sHalf = source.shape === 'card' ? CanvasRenderer.cardSize(source).w / 2 : source.radius;
        const tHalf = target.shape === 'card' ? CanvasRenderer.cardSize(target).w / 2 : target.radius;
        const p0 = {x: source.x + dir * sHalf, y: source.y};
        const p3 = {x: target.x - dir * tHalf, y: target.y};
        const bend = Math.max(30, Math.abs(p3.x - p0.x) / 2);

        return [p0, {x: p0.x + dir * bend, y: p0.y}, {x: p3.x - dir * bend, y: p3.y}, p3];
    }

    public static cubicPoint(p: Cubic, u: number): Point {
        const v = 1 - u;
        const a = v * v * v;
        const b = 3 * v * v * u;
        const c = 3 * v * u * u;
        const d = u * u * u;
        const [p0, p1, p2, p3] = p;

        return {
            x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
            y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
        };
    }

    private static edgeVisible(edge: GraphEdge, view: Bounds): boolean {
        const {source, target} = edge;

        return Math.max(source.x, target.x) >= view.minX && Math.min(source.x, target.x) <= view.maxX
            && Math.max(source.y, target.y) >= view.minY && Math.min(source.y, target.y) <= view.maxY;
    }

    /** World-space dot grid that pans with the content; skipped when zoomed far out (too dense to read). */
    private drawGrid(scene: RenderScene): void {
        const {ctx, theme} = this;
        const {camera} = scene;
        const step = 28;

        if (step * camera.scale < 10) {
            return;
        }

        const view = camera.viewBounds(scene.width, scene.height);
        const startX = Math.floor(view.minX / step) * step + step / 2;
        const startY = Math.floor(view.minY / step) * step + step / 2;
        const size = Math.max(1, camera.scale);

        ctx.fillStyle = theme.gridDot;

        for (let wx = startX; wx < view.maxX; wx += step) {
            for (let wy = startY; wy < view.maxY; wy += step) {
                const s = camera.toScreen(wx, wy);
                ctx.fillRect(Math.round(s.x), Math.round(s.y), size, size);
            }
        }
    }

    /** Returns true when the edge draws animated traffic dots this frame. */
    private drawEdge(edge: GraphEdge, style: ResolvedEdgeStyle, alpha: number, scene: RenderScene,
        showLabel: boolean): boolean {
        const {ctx} = this;
        const curve = scene.edgeStyle === 'curve' ? CanvasRenderer.curvePoints(edge) : null;
        const {start, end} = CanvasRenderer.lineEnds(edge, style.directed);

        ctx.save();
        ctx.globalAlpha = style.opacity * alpha;
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.width;

        if (style.dash !== null) {
            ctx.setLineDash(style.dash);
        }

        ctx.beginPath();

        if (curve !== null) {
            ctx.moveTo(curve[0].x, curve[0].y);
            ctx.bezierCurveTo(curve[1].x, curve[1].y, curve[2].x, curve[2].y, curve[3].x, curve[3].y);
        } else {
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
        }

        ctx.stroke();
        ctx.setLineDash([]);

        if (style.directed) {
            const tip = curve !== null ? curve[3] : end;
            const from = curve !== null ? curve[2] : start;

            CanvasRenderer.arrowHead(ctx, from, tip, 5 + style.width * 1.6, style.color);
        }

        if (showLabel && style.label !== null && style.label.length > 0) {
            const mid = curve !== null
                ? CanvasRenderer.cubicPoint(curve, 0.5)
                : {x: (edge.source.x + edge.target.x) / 2, y: (edge.source.y + edge.target.y) / 2};

            this.drawEdgeLabel(style.label, mid);
        }

        ctx.restore();

        if (style.animated && edge.load > 0.02 && alpha >= 1) {
            this.drawTrafficDots(edge, style.color, scene.timeMs, curve);
            return true;
        }

        return false;
    }

    /**
     * Straight-edge endpoints. A directed edge stops at the target's rim so
     * the arrowhead is visible instead of hidden under the node.
     */
    private static lineEnds(edge: GraphEdge, directed: boolean): {start: Point; end: Point} {
        const {source, target} = edge;
        const start = {x: source.x, y: source.y};

        if (!directed) {
            return {start: start, end: {x: target.x, y: target.y}};
        }

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.hypot(dx, dy);
        const rim = target.shape === 'card' ? CanvasRenderer.cardSize(target).h / 2 : target.radius + 2;

        if (dist <= rim) {
            return {start: start, end: {x: target.x, y: target.y}};
        }

        return {start: start, end: {x: target.x - (dx / dist) * rim, y: target.y - (dy / dist) * rim}};
    }

    private static arrowHead(ctx: CanvasRenderingContext2D, from: Point, tip: Point, size: number, color: string): void {
        const angle = Math.atan2(tip.y - from.y, tip.x - from.x);

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x - Math.cos(angle - 0.42) * size, tip.y - Math.sin(angle - 0.42) * size);
        ctx.lineTo(tip.x - Math.cos(angle + 0.42) * size, tip.y - Math.sin(angle + 0.42) * size);
        ctx.closePath();
        ctx.fill();
    }

    private drawEdgeLabel(text: string, at: Point): void {
        const {ctx, theme} = this;

        ctx.font = '9.5px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(text).width + 8;

        ctx.fillStyle = Color.withAlpha(theme.background, 0.85);
        ctx.fillRect(at.x - w / 2, at.y - 7, w, 14);
        ctx.fillStyle = theme.edgeLabel ?? theme.nodeLabel;
        ctx.fillText(text, at.x, at.y);
        ctx.textBaseline = 'alphabetic';
    }

    private drawTrafficDots(edge: GraphEdge, color: string, timeMs: number, curve: Cubic | null): void {
        const {ctx} = this;
        const {source, target} = edge;
        const dx = target.x - source.x;
        const dy = target.y - source.y;

        if (Math.hypot(dx, dy) < 1) {
            return;
        }

        const speed = 0.00012 + edge.load * 0.00035;
        const count = 1 + Math.round(edge.load * 3);

        ctx.save();
        ctx.fillStyle = color;

        for (let i = 0; i < count; i++) {
            const phase = (edge.dashPhase + i / count + timeMs * speed) % 1;
            const point = curve !== null
                ? CanvasRenderer.cubicPoint(curve, phase)
                : {x: source.x + dx * phase, y: source.y + dy * phase};

            ctx.beginPath();
            ctx.arc(point.x, point.y, 2.4, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    private drawNode(node: GraphNode, style: ResolvedNodeStyle, state: NodeDrawState, timeMs: number): void {
        const {ctx} = this;

        ctx.save();
        ctx.globalAlpha = state.alpha;

        if (style.shape === 'card') {
            this.drawCardNode(node, style, state, timeMs);
        } else if (style.shape === 'dot') {
            this.drawDotNode(node, style, state);
        } else {
            this.drawCircleNode(node, style, state, timeMs);
        }

        ctx.restore();
    }

    private drawDotNode(node: GraphNode, style: ResolvedNodeStyle, state: NodeDrawState): void {
        const {ctx, theme} = this;
        const r = style.radius;

        if (state.highlighted || state.selected || state.hovered) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 3.5, 0, Math.PI * 2);
            ctx.strokeStyle = state.selected
                ? theme.nodeSelectedStroke
                : state.highlighted
                    ? theme.highlightStroke ?? theme.statusWarning
                    : theme.nodeHoverStroke;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = style.fill;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = style.stroke;
        ctx.stroke();

        // Dense graphs: labels of hovered/selected dots stay readable even when the rest are off.
        if (state.showLabel || state.hovered || state.selected) {
            this.drawLabel(node, style, r + 12);
        }
    }

    private drawCircleNode(node: GraphNode, style: ResolvedNodeStyle, state: NodeDrawState, timeMs: number): void {
        const {ctx, theme} = this;
        const r = style.radius;

        ctx.save();
        ctx.translate(node.x, node.y);

        // Pulse: an animated glow ring in the status color ("working here").
        if (node.pulse) {
            const phase = (Math.sin(timeMs * 0.005) + 1) / 2;
            const base = ctx.globalAlpha;

            ctx.beginPath();
            ctx.arc(0, 0, r + 6 + phase * 7, 0, Math.PI * 2);
            ctx.strokeStyle = CanvasRenderer.statusColor(node.status, theme);
            ctx.globalAlpha = base * (0.25 + phase * 0.55);
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.globalAlpha = base;
        }

        if (state.highlighted) {
            ctx.beginPath();
            ctx.arc(0, 0, r + 9, 0, Math.PI * 2);
            ctx.strokeStyle = theme.highlightStroke ?? theme.statusWarning;
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        // Status ring
        if (node.status !== 'ok') {
            ctx.beginPath();
            ctx.arc(0, 0, r + 5, 0, Math.PI * 2);
            ctx.strokeStyle = CanvasRenderer.statusColor(node.status, theme);
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        // Body
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = style.fill;
        ctx.fill();
        ctx.lineWidth = state.selected ? 3 : state.hovered ? 2.5 : 1.5;
        ctx.strokeStyle = state.selected
            ? theme.nodeSelectedStroke
            : state.hovered
                ? theme.nodeHoverStroke
                : style.stroke;
        ctx.stroke();

        if (style.icon !== null) {
            NodeIcons.draw(ctx, style.icon, r * 1.15, theme.nodeIcon);
        }

        // Down overlay (stop sign)
        if (node.status === 'down') {
            CanvasRenderer.drawStopSign(ctx, r * 0.62, theme);
        }

        ctx.restore();

        if (state.showLabel) {
            this.drawLabel(node, style, r + 14);
        }
    }

    private drawLabel(node: GraphNode, style: ResolvedNodeStyle, offsetY: number): void {
        const {ctx} = this;

        ctx.save();
        ctx.fillStyle = style.labelColor;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(style.label, node.x, node.y + offsetY);

        if (node.sublabel !== null) {
            ctx.globalAlpha *= 0.75;
            ctx.font = '9.5px system-ui, sans-serif';
            ctx.fillText(node.sublabel, node.x, node.y + offsetY + 12);
        }

        ctx.restore();
    }

    /**
     * Agent/service card: rounded rect with an icon chip on the left, the
     * label + sublabel INSIDE the node, and a status dot top-right — the
     * n8n/orchestrator-style node instead of a device circle.
     */
    private drawCardNode(node: GraphNode, style: ResolvedNodeStyle, state: NodeDrawState, timeMs: number): void {
        const {ctx, theme} = this;
        const {w, h} = CanvasRenderer.cardSize(node);
        const statusColor = CanvasRenderer.statusColor(node.status, theme);

        ctx.save();
        ctx.translate(node.x, node.y);

        if (node.pulse || state.highlighted) {
            const phase = node.pulse ? (Math.sin(timeMs * 0.005) + 1) / 2 : 1;
            const base = ctx.globalAlpha;

            ctx.globalAlpha = base * (0.2 + phase * 0.5);
            ctx.strokeStyle = state.highlighted ? theme.highlightStroke ?? theme.statusWarning : statusColor;
            ctx.lineWidth = 3;
            CanvasRenderer.roundRectPath(ctx, -w / 2 - 4, -h / 2 - 4, w + 8, h + 8, 12);
            ctx.stroke();
            ctx.globalAlpha = base;
        }

        CanvasRenderer.roundRectPath(ctx, -w / 2, -h / 2, w, h, 9);
        ctx.fillStyle = style.fill;
        ctx.fill();
        ctx.lineWidth = state.selected ? 2.5 : state.hovered ? 2 : 1.4;
        ctx.strokeStyle = state.selected
            ? theme.nodeSelectedStroke
            : state.hovered
                ? theme.nodeHoverStroke
                : node.status !== 'ok' ? statusColor : style.stroke;
        ctx.stroke();

        // icon chip
        const chip = h - 16;

        CanvasRenderer.roundRectPath(ctx, -w / 2 + 8, -chip / 2, chip, chip, 7);
        ctx.fillStyle = theme.background;
        ctx.fill();
        ctx.strokeStyle = theme.nodeStroke;
        ctx.lineWidth = 1;
        ctx.stroke();

        if (style.icon !== null) {
            ctx.save();
            ctx.translate(-w / 2 + 8 + chip / 2, 0);
            NodeIcons.draw(ctx, style.icon, chip * 0.72, theme.nodeIcon);
            ctx.restore();
        }

        // texts inside the card
        const textX = -w / 2 + 8 + chip + 9;

        ctx.textAlign = 'left';
        ctx.fillStyle = theme.panelText;
        ctx.font = '600 11.5px system-ui, sans-serif';
        ctx.fillText(style.label, textX, node.sublabel !== null ? -2 : 4, w - chip - 30);

        if (node.sublabel !== null) {
            ctx.fillStyle = style.labelColor;
            ctx.font = '9.5px system-ui, sans-serif';
            ctx.fillText(node.sublabel, textX, 12, w - chip - 30);
        }

        // status dot
        ctx.beginPath();
        ctx.arc(w / 2 - 9, -h / 2 + 9, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = statusColor;
        ctx.fill();

        ctx.restore();
    }

    private drawLasso(points: ReadonlyArray<Point>): void {
        const {ctx, theme} = this;
        const first = points[0] as Point;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);

        for (let i = 1; i < points.length; i++) {
            const p = points[i] as Point;
            ctx.lineTo(p.x, p.y);
        }

        ctx.closePath();
        ctx.fillStyle = Color.withAlpha(theme.nodeSelectedStroke, 0.12);
        ctx.fill();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = theme.nodeSelectedStroke;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
    }

    private static roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number,
        w: number, h: number, r: number): void {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    private static drawStopSign(ctx: CanvasRenderingContext2D, size: number, theme: ThemeTokens): void {
        ctx.save();
        ctx.translate(size * 0.55, -size * 0.55);
        ctx.rotate(Math.PI / 8);
        ctx.fillStyle = theme.statusDown;
        ctx.beginPath();

        const sides = 8;

        for (let i = 0; i < sides; i++) {
            const angle = (i / sides) * Math.PI * 2;
            const x = Math.cos(angle) * size * 0.4;
            const y = Math.sin(angle) * size * 0.4;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = size * 0.12;
        ctx.beginPath();
        ctx.moveTo(-size * 0.18, 0);
        ctx.lineTo(size * 0.18, 0);
        ctx.stroke();
        ctx.restore();
    }

    private static statusColor(status: GraphNode['status'], theme: ThemeTokens): string {
        switch (status) {
            case 'warning':
                return theme.statusWarning;
            case 'critical':
                return theme.statusCritical;
            case 'down':
                return theme.statusDown;
            default:
                return theme.statusOk;
        }
    }

}
