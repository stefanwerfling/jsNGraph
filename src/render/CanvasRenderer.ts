import { GraphEdge } from '../model/GraphEdge';
import { GraphNode } from '../model/GraphNode';
import { Bounds, Geometry, Point } from '../util/Geometry';
import { Color } from '../util/Color';
import { Camera } from '../view/Camera';
import { BulkSink } from './BulkBuffers';
import { EdgeBatcher } from './EdgeBatcher';
import { ImageCache } from './ImageCache';
import { NGraphOverlay, OverlayContext } from './Effects';
import { LabelPlacer } from './LabelPlacer';
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
    /** Edge under the pointer: drawn on its own, a little wider. */
    hoveredEdgeId?: string | null;
    selection: ReadonlySet<string>;
    /** Highlighted node ids, or null for no highlight. */
    highlight: ReadonlySet<string> | null;
    dimOthers: boolean;
    showLabels: boolean;
    /** Below this camera scale node labels are skipped (they would be unreadable). */
    labelMinZoom: number;
    /** Skip node labels that would overlap a more important one. */
    labelCollision: boolean;
    edgeStyle: 'line' | 'curve';
    grid: boolean;
    /** Lasso polygon in screen pixels while the user draws one. */
    lasso: ReadonlyArray<Point> | null;
    styles: StyleResolver;
    /** Cluster outlines in world coordinates, drawn under edges and nodes. */
    hulls: ReadonlyArray<RenderHull>;
    /** Drawing hooks (J8), run in world coordinates. */
    overlays: ReadonlyArray<NGraphOverlay>;
    overlayContext: OverlayContext;
    /** Zoomed out with clusters set: draw these super-nodes instead of nodes and edges. */
    clusters: RenderClusters | null;
}

/** A cluster disc in world coordinates; its radius is constant on screen. */
export interface RenderCluster {
    id: string;
    x: number;
    y: number;
    size: number;
    /** World extent the disc stays inside (Infinity = no limit). */
    radius: number;
    color: string;
    label: string | null;
}

export interface RenderClusterEdge {
    source: RenderCluster;
    target: RenderCluster;
    weight: number;
}

export interface RenderClusters {
    /** Draw order: biggest first, so small clusters stay on top (and win hit tests). */
    discs: ReadonlyArray<RenderCluster>;
    edges: ReadonlyArray<RenderClusterEdge>;
}

export interface RenderHull {
    polygon: ReadonlyArray<Point>;
    color: string;
    opacity: number;
}

export type Cubic = [Point, Point, Point, Point];

/** A node label waiting for collision placement (drawn after all bodies). */
interface QueuedLabel {
    node: GraphNode;
    style: ResolvedNodeStyle;
    offsetY: number;
    alpha: number;
    /** Higher wins: forced (hover/selection) > highlight > bigger node. */
    priority: number;
    forced: boolean;
}

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

    /** Arrowheads smaller than this on screen are left out (LOD). */
    public static readonly MIN_ARROW_PX = 2;

    /** Plain dots smaller than this radius on screen are drawn as batched squares (LOD). */
    public static readonly DOT_DETAIL_PX = 2;

    /** Horizontal padding of a label pill, world px. */
    public static readonly PILL_PAD_X = 7;

    /** Cluster disc radius in screen px: grows with the member count, stays inside the cluster's extent. */
    public static clusterRadiusPx(cluster: RenderCluster, scale: number): number {
        const bySize = Math.min(64, 6 + Math.sqrt(Math.max(0, cluster.size)) * 2.5);

        return Math.max(3, Math.min(bySize, cluster.radius * scale));
    }

    private readonly ctx: CanvasRenderingContext2D;
    private theme: ThemeTokens;
    private readonly batcher = new EdgeBatcher();
    private readonly placer = new LabelPlacer();
    /** Non-null while a frame with label collision collects its labels. */
    private labelQueue: QueuedLabel[] | null = null;
    /** Measured label widths (world px at 11px font), by text. */
    private readonly labelWidths = new Map<string, number>();
    /** Tiny dots of the current frame as x, y, r triples, by `color|alpha`. */
    private readonly dotBatches = new Map<string, number[]>();
    /** Node pictures (NGraphNodeData.image), loaded on first use. */
    private readonly images: ImageCache;

    /** `onAsset` is called when a node picture finished loading (request a frame). */
    public constructor(private readonly canvas: HTMLCanvasElement, theme: ThemeTokens, onAsset: () => void = () => undefined) {
        this.images = new ImageCache(onAsset);

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

    /**
     * Draw one frame. Returns true when a visible element animates (traffic
     * dots, pulse). With a `bulk` sink (the WebGL layer underneath, J11) the
     * canvas stays transparent and plain straight edges and plain dots go to
     * the sink instead of being drawn here.
     */
    public draw(scene: RenderScene, bulk: BulkSink | null = null): boolean {
        const {ctx, canvas, theme} = this;
        const dpr = window.devicePixelRatio || 1;
        const {camera} = scene;
        const view = Geometry.expand(camera.viewBounds(scene.width, scene.height), 60 / camera.scale);
        const dimOpacity = theme.dimOpacity ?? 0.15;
        let animating = false;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(dpr, dpr);

        if (bulk === null) {
            ctx.fillStyle = theme.background;
            ctx.fillRect(0, 0, scene.width, scene.height);
        }

        if (scene.grid) {
            this.drawGrid(scene);
        }

        ctx.save();
        camera.apply(ctx);

        for (const hull of scene.hulls) {
            this.drawHull(hull, camera.scale);
        }

        if (this.runOverlays(scene, 'under')) {
            animating = true;
        }

        if (scene.clusters !== null) {
            this.drawClusters(scene.clusters, scene);
        } else {
            animating = this.drawGraph(scene, view, dimOpacity, bulk) || animating;
        }

        if (this.runOverlays(scene, 'over')) {
            animating = true;
        }

        ctx.restore();

        if (scene.lasso !== null && scene.lasso.length > 1) {
            this.drawLasso(scene.lasso);
        }

        return animating;
    }

    /** Edges, nodes and labels; true when something animates. */
    private drawGraph(scene: RenderScene, view: Bounds, dimOpacity: number, bulk: BulkSink | null): boolean {
        const {camera} = scene;
        const highlight = scene.highlight;
        let animating = false;
        const zoomedIn = camera.scale >= scene.labelMinZoom;
        let hovered: {edge: GraphEdge; style: ResolvedEdgeStyle} | null = null;

        for (const edge of scene.edges) {
            if (!CanvasRenderer.edgeVisible(edge, view)) {
                continue;
            }

            const style = scene.styles.edge(edge);
            const dimmed = highlight !== null && scene.dimOthers
                && !(highlight.has(edge.source.id) && highlight.has(edge.target.id));
            const alpha = dimmed ? dimOpacity : 1;

            if (edge.id === scene.hoveredEdgeId) {
                hovered = {edge, style};
                continue;
            }

            // Plain straight edges are stroked in batches (one path per look).
            if (scene.edgeStyle === 'line' && style.dash === null && !style.animated
                && (style.label === null || style.label.length === 0 || !zoomedIn)) {
                const {start, end} = CanvasRenderer.lineEnds(edge, style.directed);
                const arrow = 5 + style.width * 1.6;

                const segment = {
                    from: start,
                    to: end,
                    // LOD: an arrowhead under ~2 px on screen is not visible, skip it.
                    arrow: style.directed && arrow * camera.scale >= CanvasRenderer.MIN_ARROW_PX ? arrow : 0
                };

                if (bulk !== null) {
                    bulk.line(style.color, style.width, style.opacity * alpha, segment);
                } else {
                    this.batcher.add(style.color, style.width, style.opacity * alpha, segment);
                }
                continue;
            }

            if (this.drawEdge(edge, style, alpha, scene, zoomedIn)) {
                animating = true;
            }
        }

        this.batcher.flush(this.ctx);

        // The hovered edge last, over its neighbours, wider and fully opaque.
        if (hovered !== null) {
            const style = {...hovered.style, width: hovered.style.width + 2, opacity: Math.max(hovered.style.opacity, 0.95)};

            if (this.drawEdge(hovered.edge, style, 1, scene, zoomedIn)) {
                animating = true;
            }
        }

        const showLabels = scene.showLabels && zoomedIn;
        this.labelQueue = scene.labelCollision ? [] : null;

        for (const node of scene.nodes) {
            const style = scene.styles.node(node);
            const extent = style.shape === 'card' ? CanvasRenderer.cardSize(node).w / 2 : style.radius + 30;

            if (node.x + extent < view.minX || node.x - extent > view.maxX
                || node.y + extent < view.minY || node.y - extent > view.maxY) {
                continue;
            }

            const highlighted = highlight !== null && highlight.has(node.id);
            const dimmed = highlight !== null && scene.dimOthers && !highlighted;
            const hovered = node.id === scene.hoveredId;
            const selected = scene.selection.has(node.id);
            const alpha = (dimmed ? dimOpacity : 1) * style.opacity;

            // WebGL: every plain dot is one instance; only its label stays on the canvas.
            if (bulk !== null && style.shape === 'dot' && style.ring === null && style.badge === null && !hovered && !selected && !highlighted) {
                bulk.disc(node.x, node.y, style.radius, style.fill, style.stroke, alpha);

                if (showLabels && style.radius * camera.scale >= CanvasRenderer.DOT_DETAIL_PX) {
                    this.ctx.globalAlpha = alpha;
                    this.labelOrQueue(node, style, style.radius + 12,
                        {hovered: false, selected: false, highlighted: false, alpha: alpha, showLabel: true});
                    this.ctx.globalAlpha = 1;
                }
                continue;
            }

            // LOD: a plain dot under ~2 px on screen is one square in a batch.
            if (style.shape === 'dot' && style.radius * camera.scale < CanvasRenderer.DOT_DETAIL_PX
                && style.ring === null && style.badge === null && !hovered && !selected && !highlighted) {
                // At least ~1.2 px wide, so a zoomed-out cloud stays visible.
                this.batchDot(node.x, node.y, Math.max(style.radius, 0.6 / camera.scale), style.fill, alpha);
                continue;
            }

            this.drawNode(node, style, {
                hovered: hovered,
                selected: selected,
                highlighted: highlighted,
                alpha: alpha,
                showLabel: showLabels
            }, scene.timeMs);

            if (node.pulse && !dimmed) {
                animating = true;
            }
        }

        this.flushDots();

        if (this.labelQueue !== null) {
            this.placeLabels(this.labelQueue, scene);
            this.labelQueue = null;
        }

        return animating;
    }

    private batchDot(x: number, y: number, r: number, color: string, alpha: number): void {
        const key = `${color}|${Math.round(alpha * 100) / 100}`;
        let batch = this.dotBatches.get(key);

        if (batch === undefined) {
            batch = [];
            this.dotBatches.set(key, batch);
        }

        batch.push(x, y, r);
    }

    /** One fillStyle per batch; squares need no path, so there is no per-dot path cost. */
    private flushDots(): void {
        const {ctx} = this;

        for (const [key, batch] of this.dotBatches) {
            const cut = key.lastIndexOf('|');

            ctx.fillStyle = key.slice(0, cut);
            ctx.globalAlpha = Number(key.slice(cut + 1));

            for (let i = 0; i < batch.length; i += 3) {
                const r = batch[i + 2] as number;
                ctx.fillRect((batch[i] as number) - r, (batch[i + 1] as number) - r, r * 2, r * 2);
            }
        }

        ctx.globalAlpha = 1;
        this.dotBatches.clear();
    }

    /**
     * Zoomed-out overview: aggregated edges (width by weight), then one disc
     * per cluster with its member count, labels placed without overlap.
     * Sizes are in screen px, so the overview reads the same at any zoom.
     */
    private drawClusters(clusters: RenderClusters, scene: RenderScene): void {
        const {ctx, theme} = this;
        const scale = scene.camera.scale;
        let maxWeight = 1;

        for (const e of clusters.edges) {
            maxWeight = Math.max(maxWeight, e.weight);
        }

        ctx.save();
        ctx.strokeStyle = theme.edgeNeutral ?? theme.nodeStroke;
        ctx.globalAlpha = 0.45;

        for (const e of clusters.edges) {
            ctx.lineWidth = Math.max(0.5, (e.weight / maxWeight) * 4) / scale;
            ctx.beginPath();
            ctx.moveTo(e.source.x, e.source.y);
            ctx.lineTo(e.target.x, e.target.y);
            ctx.stroke();
        }

        ctx.restore();
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const c of clusters.discs) {
            const r = CanvasRenderer.clusterRadiusPx(c, scale) / scale;

            ctx.beginPath();
            ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
            ctx.globalAlpha = 0.72;
            ctx.fillStyle = c.color;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.lineWidth = 1 / scale;
            ctx.strokeStyle = c.color;
            ctx.stroke();

            if (r * scale >= 10) {
                ctx.font = `${10 / scale}px system-ui, sans-serif`;
                ctx.fillStyle = theme.background;
                ctx.fillText(String(c.size), c.x, c.y);
            }
        }

        // Labels only where they cover no disc; the biggest clusters claim their space first.
        this.placer.reset();

        for (const c of clusters.discs) {
            const at = scene.camera.toScreen(c.x, c.y);
            const r = CanvasRenderer.clusterRadiusPx(c, scale);

            this.placer.tryPlace({x: at.x - r, y: at.y - r, w: r * 2, h: r * 2});
        }

        ctx.font = `${11 / scale}px system-ui, sans-serif`;
        ctx.fillStyle = theme.nodeLabel;

        for (let i = 0; i < clusters.discs.length; i++) {
            const c = clusters.discs[i] as RenderCluster;

            if (c.label === null || c.label.length === 0) {
                continue;
            }

            const w = ctx.measureText(c.label).width * scale;
            const at = scene.camera.toScreen(c.x, c.y);
            const r = CanvasRenderer.clusterRadiusPx(c, scale);

            if (this.placer.tryPlace({x: at.x - w / 2, y: at.y + r + 3, w: w, h: 13})) {
                ctx.fillText(c.label, c.x, c.y + (r + 10) / scale);
            }
        }

        ctx.restore();
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

        this.drawRing(node.x, node.y, r, style);

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

        if (style.badge !== null) {
            this.drawBadge(node.x + r * 0.72, node.y - r * 0.72, style.badge, style.badgeColor);
        }

        // Dense graphs: labels of hovered/selected dots stay readable even when the rest are off.
        if (state.showLabel || state.hovered || state.selected) {
            this.labelOrQueue(node, style, r + 12, state);
        }
    }

    /** Run the overlays of one layer; true when any of them animates. */
    private runOverlays(scene: RenderScene, layer: 'under' | 'over'): boolean {
        let animating = false;

        for (const overlay of scene.overlays) {
            if ((overlay.layer ?? 'over') !== layer) {
                continue;
            }

            this.ctx.save();

            try {
                if (overlay.draw(this.ctx, scene.overlayContext) === true) {
                    animating = true;
                }
            } finally {
                this.ctx.restore();
            }
        }

        return animating;
    }

    private drawHull(hull: RenderHull, scale: number): void {
        const {ctx} = this;
        const first = hull.polygon[0];

        if (first === undefined || hull.polygon.length < 3) {
            return;
        }

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);

        for (let i = 1; i < hull.polygon.length; i++) {
            const p = hull.polygon[i] as Point;
            ctx.lineTo(p.x, p.y);
        }

        ctx.closePath();
        ctx.fillStyle = hull.color;
        ctx.globalAlpha = hull.opacity;
        ctx.fill();
        ctx.strokeStyle = hull.color;
        ctx.globalAlpha = Math.min(1, hull.opacity * 3);
        ctx.lineJoin = 'round';
        // Constant 1 px on screen, whatever the zoom.
        ctx.lineWidth = 1 / scale;
        ctx.stroke();
        ctx.restore();
    }

    /** The optional outer ring (NodeStyle.ring), e.g. a heat indicator. */
    private drawRing(x: number, y: number, r: number, style: ResolvedNodeStyle): void {
        const ring = style.ring;

        if (ring === null) {
            return;
        }

        const {ctx} = this;
        const base = ctx.globalAlpha;

        ctx.beginPath();
        ctx.arc(x, y, r + 1 + ring.width / 2, 0, Math.PI * 2);
        ctx.strokeStyle = ring.color;
        ctx.globalAlpha = base * ring.opacity;
        ctx.lineWidth = ring.width;
        ctx.stroke();
        ctx.globalAlpha = base;
    }

    private labelOrQueue(node: GraphNode, style: ResolvedNodeStyle, offsetY: number, state: NodeDrawState): void {
        if (this.labelQueue === null) {
            this.drawLabel(node, style, offsetY, state.hovered || state.selected);
            return;
        }

        const forced = state.hovered || state.selected;

        this.labelQueue.push({
            node: node,
            style: style,
            offsetY: offsetY,
            alpha: state.alpha,
            priority: (forced ? 1e6 : 0) + (state.highlighted ? 1e5 : 0) + style.radius,
            forced: forced
        });
    }

    /**
     * Draw queued labels most important first, skipping any whose screen box
     * would overlap one already drawn. Forced labels (hover, selection) are
     * always drawn and claim their space first.
     */
    private placeLabels(queue: QueuedLabel[], scene: RenderScene): void {
        const {ctx} = this;
        const {camera} = scene;

        queue.sort((a, b) => b.priority - a.priority);
        this.placer.reset();
        ctx.font = '11px system-ui, sans-serif';

        for (const item of queue) {
            const text = item.style.label;

            if (text.length === 0) {
                continue;
            }

            let w = this.labelWidths.get(text);

            if (w === undefined) {
                w = ctx.measureText(text).width;

                if (this.labelWidths.size > 20000) {
                    this.labelWidths.clear();
                }

                this.labelWidths.set(text, w);
            }

            const pad = item.style.labelBackground !== null ? CanvasRenderer.PILL_PAD_X : 0;
            const top = camera.toScreen(item.node.x - w / 2 - pad, item.node.y + item.offsetY - 10);
            const lines = item.node.sublabel !== null ? 24 : 13;
            const fits = this.placer.tryPlace({x: top.x, y: top.y, w: (w + 2 * pad) * camera.scale, h: lines * camera.scale});

            if (!fits && !item.forced) {
                continue;
            }

            ctx.save();
            ctx.globalAlpha = item.alpha;
            this.drawLabel(item.node, item.style, item.offsetY, item.forced);
            ctx.restore();
        }
    }

    private drawCircleNode(node: GraphNode, style: ResolvedNodeStyle, state: NodeDrawState, timeMs: number): void {
        const {ctx, theme} = this;
        const r = style.radius;

        this.drawRing(node.x, node.y, r, style);

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

        const image = style.image !== null ? this.images.get(style.image) : null;

        if (image !== null) {
            ctx.save();
            ctx.clip();
            CanvasRenderer.drawCover(ctx, image, -r, -r, 2 * r, 2 * r);
            ctx.restore();
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
        }

        ctx.lineWidth = state.selected ? 3 : state.hovered ? 2.5 : 1.5;
        ctx.strokeStyle = state.selected
            ? theme.nodeSelectedStroke
            : state.hovered
                ? theme.nodeHoverStroke
                : style.stroke;
        ctx.stroke();

        if (style.icon !== null && image === null) {
            NodeIcons.draw(ctx, style.icon, r * 1.15, theme.nodeIcon);
        }

        // Down overlay (stop sign)
        if (node.status === 'down') {
            CanvasRenderer.drawStopSign(ctx, r * 0.62, theme);
        }

        ctx.restore();

        if (style.badge !== null) {
            this.drawBadge(node.x + r * 0.72, node.y - r * 0.72, style.badge, style.badgeColor);
        }

        if (state.showLabel) {
            this.labelOrQueue(node, style, r + 14, state);
        }
    }

    /**
     * Label (+ sublabel) centred under a node. With a pill background the
     * text sits on a rounded backdrop; `strong` (hovered/selected) inverts
     * the pill to the label colour, so the focused node's name stands out.
     */
    private drawLabel(node: GraphNode, style: ResolvedNodeStyle, offsetY: number, strong = false): void {
        const {ctx, theme} = this;
        // A pill sits a little lower, clear of status/highlight rings.
        const y = node.y + offsetY + (style.labelBackground !== null ? 4 : 0);

        ctx.save();
        ctx.textAlign = 'center';

        if (style.labelBackground !== null) {
            ctx.font = '600 11px system-ui, sans-serif';

            const w = ctx.measureText(style.label).width + 2 * CanvasRenderer.PILL_PAD_X;
            const h = node.sublabel !== null ? 28 : 16;

            CanvasRenderer.roundRectPath(ctx, node.x - w / 2, y - 12, w, h, 8);
            ctx.fillStyle = strong ? style.labelColor : style.labelBackground;
            ctx.fill();
            ctx.fillStyle = strong ? theme.background : style.labelColor;
        } else {
            ctx.font = '11px system-ui, sans-serif';
            ctx.fillStyle = style.labelColor;
        }

        ctx.fillText(style.label, node.x, y);

        if (node.sublabel !== null) {
            ctx.globalAlpha *= 0.75;
            ctx.font = '9.5px system-ui, sans-serif';
            ctx.fillText(node.sublabel, node.x, y + 12);
        }

        ctx.restore();
    }

    /**
     * Agent/service card: rounded rect with an icon chip on the left, the
     * label + sublabel INSIDE the node, and a status dot top-right — the
     * workflow/orchestrator-style node instead of a device circle.
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

        const image = style.image !== null ? this.images.get(style.image) : null;

        if (image !== null) {
            ctx.save();
            CanvasRenderer.roundRectPath(ctx, -w / 2 + 8, -chip / 2, chip, chip, 7);
            ctx.clip();
            CanvasRenderer.drawCover(ctx, image, -w / 2 + 8, -chip / 2, chip, chip);
            ctx.restore();
        } else if (style.icon !== null) {
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

        if (style.badge !== null) {
            this.drawBadge(node.x + w / 2 - 2, node.y - h / 2 + 2, style.badge, style.badgeColor);
        }
    }

    /** Count bubble centred at (x, y): a pill that grows with the text, ringed in the background colour. */
    private drawBadge(x: number, y: number, text: string, color: string): void {
        const {ctx, theme} = this;

        ctx.save();
        ctx.font = '700 9.5px system-ui, sans-serif';

        const h = 15;
        const w = Math.max(h, ctx.measureText(text).width + 8);

        CanvasRenderer.roundRectPath(ctx, x - w / 2, y - h / 2, w, h, h / 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = theme.background;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y + 0.5);
        ctx.restore();
    }

    /** Draw `image` scaled to cover the box (centre crop), like CSS object-fit: cover. */
    private static drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement,
        x: number, y: number, w: number, h: number): void {
        const iw = image.naturalWidth;
        const ih = image.naturalHeight;
        const scale = Math.max(w / iw, h / ih);
        const sw = w / scale;
        const sh = h / scale;

        ctx.drawImage(image, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
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
