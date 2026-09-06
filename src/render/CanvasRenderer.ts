import { GraphEdge } from '../model/GraphEdge';
import { GraphNode } from '../model/GraphNode';
import { NodeIcons } from './NodeIcons';
import { ThemeTokens } from './Theme';

export interface RenderOptions {
    showLabels: boolean;
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
            this.drawEdge(edge, timeMs);
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

    private drawEdge(edge: GraphEdge, timeMs: number): void {
        const {ctx, theme} = this;
        const {source, target} = edge;
        const color = CanvasRenderer.lerpEdgeColor(edge.load, theme);

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 + edge.load * 2.5;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        ctx.restore();

        if (edge.animated && edge.load > 0.02) {
            this.drawTrafficDots(edge, color, timeMs);
        }
    }

    private drawTrafficDots(edge: GraphEdge, color: string, timeMs: number): void {
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

        ctx.save();
        ctx.fillStyle = color;

        for (let i = 0; i < count; i++) {
            const phase = (edge.dashPhase + i / count + timeMs * speed) % 1;
            const x = source.x + dx * phase;
            const y = source.y + dy * phase;

            ctx.beginPath();
            ctx.arc(x, y, 2.4, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    private drawNode(node: GraphNode, hovered: boolean, selected: boolean, showLabel: boolean, timeMs: number): void {
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
