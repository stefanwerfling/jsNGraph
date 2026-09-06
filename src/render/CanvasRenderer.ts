import { GraphEdge } from '../model/GraphEdge';
import { GraphNode } from '../model/GraphNode';
import { NodeIcons } from './NodeIcons';
import { ThemeTokens } from './Theme';

export interface RenderOptions {
    showLabels: boolean;
    /** 'line' (default): straight edges. 'curve': horizontal cubic beziers
     *  from node border to node border — the workflow-editor look. */
    edgeStyle?: 'line' | 'curve';
}

/**
 * Draws the current graph state to a canvas: background grid, load-colored
 * edges with animated traffic dots, then nodes with device icons, status
 * rings and labels on top.
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

    public draw(nodes: GraphNode[], edges: GraphEdge[], hoveredId: string | null,
        selectedId: string | null, timeMs: number, options: RenderOptions): void {
        const {ctx, canvas, theme} = this;
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.width / dpr;
        const height = canvas.height / dpr;

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = theme.background;
        ctx.fillRect(0, 0, width, height);

        this.drawGrid(width, height);

        for (const edge of edges) {
            this.drawEdge(edge, timeMs, options.edgeStyle ?? 'line');
        }

        for (const node of nodes) {
            this.drawNode(node, node.id === hoveredId, node.id === selectedId, options.showLabels, timeMs);
        }

        ctx.restore();
    }

    private drawGrid(width: number, height: number): void {
        const {ctx, theme} = this;
        const step = 28;

        ctx.fillStyle = theme.gridDot;

        for (let x = step / 2; x < width; x += step) {
            for (let y = step / 2; y < height; y += step) {
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }

    private drawEdge(edge: GraphEdge, timeMs: number, style: 'line' | 'curve'): void {
        const {ctx, theme} = this;
        const color = CanvasRenderer.lerpEdgeColor(edge.load, theme);

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 + edge.load * 2.5;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();

        if (style === 'curve') {
            const [p0, p1, p2, p3] = CanvasRenderer.curvePoints(edge);

            ctx.moveTo(p0.x, p0.y);
            ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
        } else {
            ctx.moveTo(edge.source.x, edge.source.y);
            ctx.lineTo(edge.target.x, edge.target.y);
        }

        ctx.stroke();
        ctx.restore();

        if (edge.animated && edge.load > 0.02) {
            this.drawTrafficDots(edge, color, timeMs, style);
        }
    }

    /** Border-to-border horizontal bezier: leaves the source's facing side,
     *  enters the target's facing side — the workflow-editor edge. */
    private static curvePoints(edge: GraphEdge): [
        {x: number; y: number}, {x: number; y: number},
        {x: number; y: number}, {x: number; y: number}
    ] {
        const {source, target} = edge;
        const dir = target.x >= source.x ? 1 : -1;
        const sHalf = source.shape === 'card' ? CanvasRenderer.cardSize(source).w / 2 : source.radius;
        const tHalf = target.shape === 'card' ? CanvasRenderer.cardSize(target).w / 2 : target.radius;
        const p0 = {x: source.x + dir * sHalf, y: source.y};
        const p3 = {x: target.x - dir * tHalf, y: target.y};
        const bend = Math.max(30, Math.abs(p3.x - p0.x) / 2);

        return [p0, {x: p0.x + dir * bend, y: p0.y}, {x: p3.x - dir * bend, y: p3.y}, p3];
    }

    private static cubicPoint(p: [
        {x: number; y: number}, {x: number; y: number},
        {x: number; y: number}, {x: number; y: number}
    ], u: number): {x: number; y: number} {
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

    private drawTrafficDots(edge: GraphEdge, color: string, timeMs: number, style: 'line' | 'curve'): void {
        const {ctx} = this;
        const {source, target} = edge;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 1) {
            return;
        }

        const speed = 0.00012 + edge.load * 0.00035;
        const count = 1 + Math.round(edge.load * 3);
        const curve = style === 'curve' ? CanvasRenderer.curvePoints(edge) : null;

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

    private drawNode(node: GraphNode, hovered: boolean, selected: boolean, showLabel: boolean, timeMs: number): void {
        if (node.shape === 'card') {
            this.drawCardNode(node, hovered, selected, timeMs);
            return;
        }

        const {ctx, theme} = this;
        const r = node.radius;

        ctx.save();
        ctx.translate(node.x, node.y);

        // Pulse: an animated glow ring in the status color ("working here").
        if (node.pulse) {
            const phase = (Math.sin(timeMs * 0.005) + 1) / 2;

            ctx.beginPath();
            ctx.arc(0, 0, r + 6 + phase * 7, 0, Math.PI * 2);
            ctx.strokeStyle = CanvasRenderer.statusColor(node.status, theme);
            ctx.globalAlpha = 0.25 + phase * 0.55;
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.globalAlpha = 1;
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
        ctx.fillStyle = theme.nodeFill;
        ctx.fill();
        ctx.lineWidth = selected ? 3 : hovered ? 2.5 : 1.5;
        ctx.strokeStyle = selected
            ? theme.nodeSelectedStroke
            : hovered
                ? theme.nodeHoverStroke
                : theme.nodeStroke;
        ctx.stroke();

        // Icon
        NodeIcons.draw(ctx, node.kind, r * 1.15, theme.nodeIcon);

        // Down overlay (stop sign)
        if (node.status === 'down') {
            CanvasRenderer.drawStopSign(ctx, r * 0.62, theme);
        }

        ctx.restore();

        if (showLabel) {
            ctx.save();
            ctx.fillStyle = theme.nodeLabel;
            ctx.font = '11px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(node.label, node.x, node.y + r + 14);

            if (node.sublabel !== null) {
                ctx.globalAlpha = 0.75;
                ctx.font = '9.5px system-ui, sans-serif';
                ctx.fillText(node.sublabel, node.x, node.y + r + 26);
            }

            ctx.restore();
        }
    }

    /** Card width/height used for drawing AND hit-testing. */
    public static cardSize(node: GraphNode): {w: number; h: number} {
        const labelW = 7.2 * node.label.length;
        const subW = node.sublabel !== null ? 5.4 * node.sublabel.length : 0;
        const w = Math.max(120, Math.min(210, 52 + Math.max(labelW, subW) + 14));

        return {w: w, h: 46};
    }

    /**
     * Agent/service card: rounded rect with an icon chip on the left, the
     * label + sublabel INSIDE the node, and a status dot top-right — the
     * n8n/orchestrator-style node instead of a device circle.
     */
    private drawCardNode(node: GraphNode, hovered: boolean, selected: boolean, timeMs: number): void {
        const {ctx, theme} = this;
        const {w, h} = CanvasRenderer.cardSize(node);
        const statusColor = CanvasRenderer.statusColor(node.status, theme);

        ctx.save();
        ctx.translate(node.x, node.y);

        if (node.pulse) {
            const phase = (Math.sin(timeMs * 0.005) + 1) / 2;

            ctx.globalAlpha = 0.2 + phase * 0.5;
            ctx.strokeStyle = statusColor;
            ctx.lineWidth = 3;
            CanvasRenderer.roundRectPath(ctx, -w / 2 - 4, -h / 2 - 4, w + 8, h + 8, 12);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        CanvasRenderer.roundRectPath(ctx, -w / 2, -h / 2, w, h, 9);
        ctx.fillStyle = theme.nodeFill;
        ctx.fill();
        ctx.lineWidth = selected ? 2.5 : hovered ? 2 : 1.4;
        ctx.strokeStyle = selected
            ? theme.nodeSelectedStroke
            : hovered
                ? theme.nodeHoverStroke
                : node.status !== 'ok' ? statusColor : theme.nodeStroke;
        ctx.stroke();

        // icon chip
        const chip = h - 16;

        CanvasRenderer.roundRectPath(ctx, -w / 2 + 8, -chip / 2, chip, chip, 7);
        ctx.fillStyle = theme.background;
        ctx.fill();
        ctx.strokeStyle = theme.nodeStroke;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.save();
        ctx.translate(-w / 2 + 8 + chip / 2, 0);
        NodeIcons.draw(ctx, node.kind, chip * 0.72, theme.nodeIcon);
        ctx.restore();

        // texts inside the card
        const textX = -w / 2 + 8 + chip + 9;

        ctx.textAlign = 'left';
        ctx.fillStyle = theme.panelText;
        ctx.font = '600 11.5px system-ui, sans-serif';
        ctx.fillText(node.label, textX, node.sublabel !== null ? -2 : 4, w - chip - 30);

        if (node.sublabel !== null) {
            ctx.fillStyle = theme.nodeLabel;
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

    private static lerpEdgeColor(load: number, theme: ThemeTokens): string {
        const [a, b, t] = load < 0.5
            ? [theme.edgeLow, theme.edgeMid, load / 0.5]
            : [theme.edgeMid, theme.edgeHigh, (load - 0.5) / 0.5];

        return CanvasRenderer.lerpColor(a, b, t);
    }

    private static lerpColor(hexA: string, hexB: string, t: number): string {
        const a = CanvasRenderer.hexToRgb(hexA);
        const b = CanvasRenderer.hexToRgb(hexB);
        const r = Math.round(a.r + (b.r - a.r) * t);
        const g = Math.round(a.g + (b.g - a.g) * t);
        const bl = Math.round(a.b + (b.b - a.b) * t);

        return `rgb(${r}, ${g}, ${bl})`;
    }

    private static hexToRgb(hex: string): {r: number; g: number; b: number} {
        const clean = hex.replace('#', '');
        const num = parseInt(clean, 16);

        return {r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255};
    }

}
