import { Camera } from './Camera';
import { ModelEdge } from './ModelEdge';
import { ModelNode } from './ModelNode';
import { ModuleKind } from './ModelTypes';
import { ThemeTokens } from '../render/Theme';

export interface ModelRenderOptions {
    showLabels: boolean;
    animate: boolean;
}

/**
 * A container frame drawn behind an EXPANDED parent module's children — the
 * labeled "DecoderLayer ×N" box in hfviewer. Geometry is the tight bounding
 * box of the visible descendants; `pad` insets it (larger for outer groups so
 * nested frames sit cleanly inside).
 */
export interface GroupFrame {
    node: ModelNode;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    pad: number;
}

type Point = {x: number; y: number};

/**
 * Accent color per module kind — the OUTLINE/text color of a chip (hfviewer
 * draws outlined pills, not solid blocks), bright enough to read as a border
 * and a light-tinted label on a dark background, grouped by subsystem.
 */
const KIND_ACCENT: Record<ModuleKind, string> = {
    input: '#22d3ee',
    embedding: '#a78bfa',
    attention: '#818cf8',
    mlp: '#34d399',
    norm: '#38bdf8',
    head: '#fb7185',
    output: '#f472b6',
    block: '#fbbf24',
    op: '#94a3b8',
    generic: '#9ca3af'
};

/**
 * Draws the model flow graph hfviewer-style: a dark background, compact
 * OUTLINED pill chips (accent border, dark tinted fill, light-tinted accent
 * label), thin orthogonal right-angle edges with rounded corners, and a
 * stacked "×N" for collapsed repeats. All world-space through the Camera.
 */
export class ModelRenderer {

    private readonly ctx: CanvasRenderingContext2D;
    private theme: ThemeTokens;

    public constructor(private readonly canvas: HTMLCanvasElement, theme: ThemeTokens) {
        const ctx = canvas.getContext('2d');

        if (ctx === null) {
            throw new Error('ModelRenderer: 2d context unavailable');
        }

        this.ctx = ctx;
        this.theme = theme;
    }

    public setTheme(theme: ThemeTokens): void {
        this.theme = theme;
    }

    public accentFor(node: ModelNode): string {
        return node.accent ?? KIND_ACCENT[node.kind];
    }

    public draw(nodes: ModelNode[], edges: ModelEdge[], groups: GroupFrame[], camera: Camera,
        hoveredId: string | null, selectedId: string | null, timeMs: number, options: ModelRenderOptions): void {
        const {ctx, canvas, theme} = this;
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.width / dpr;
        const height = canvas.height / dpr;

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = theme.background;
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        camera.apply(ctx);

        for (const group of groups) {
            this.drawGroup(group);
        }

        for (const edge of edges) {
            this.drawEdge(edge, timeMs, options.animate);
        }

        for (const node of nodes) {
            this.drawNode(node, node.id === hoveredId, node.id === selectedId, options.showLabels);
        }

        ctx.restore();
        ctx.restore();
    }

    private drawGroup(group: GroupFrame): void {
        const {ctx, theme} = this;
        const accent = this.accentFor(group.node);
        const x = group.minX - group.pad;
        const y = group.minY - group.pad;
        const w = (group.maxX - group.minX) + group.pad * 2;
        const h = (group.maxY - group.minY) + group.pad * 2;

        ctx.save();

        // Faint tinted frame.
        ModelRenderer.roundRectPath(ctx, x, y, w, h, 12);
        ctx.fillStyle = ModelRenderer.mix(accent, theme.background, 0.93);
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Label tab at the top-left, sitting on the frame's top edge.
        const label = group.node.repeat > 1 ? `${group.node.label}  ×${group.node.repeat}` : group.node.label;

        ctx.font = '600 11px Inter, system-ui, sans-serif';
        const tabW = ctx.measureText(label).width + 16;
        const tabH = 18;

        ModelRenderer.roundRectPath(ctx, x + 10, y - tabH / 2, tabW, tabH, 5);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.fillStyle = ModelRenderer.isDark(theme.background) ? '#0b1020' : '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + 18, y - tabH / 2 + tabH / 2 + 0.5);

        ctx.restore();
    }

    private drawEdge(edge: ModelEdge, timeMs: number, animate: boolean): void {
        const {ctx, theme} = this;
        const sideRoute = edge.kind !== 'flow';
        const accent = this.accentFor(edge.source);
        const color = sideRoute ? theme.nodeStroke : accent;
        const points = sideRoute ? ModelRenderer.sideRoute(edge) : ModelRenderer.flowRoute(edge);

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = sideRoute ? 0.5 : 0.6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (sideRoute) {
            ctx.setLineDash([5, 5]);
        }

        ModelRenderer.strokeRoundedPolyline(ctx, points, 7);
        ctx.restore();

        if (edge.label !== null) {
            const mid = ModelRenderer.pointAlong(points, 0.5);

            ctx.save();
            ctx.fillStyle = theme.panelSubtext;
            ctx.font = '10px Inter, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(edge.label, mid.x + (sideRoute ? 10 : 0), mid.y);
            ctx.restore();
        }

        if (animate && edge.animated) {
            this.drawFlowDots(points, color, edge.phase, timeMs);
        }
    }

    /** Forward edge, orthogonal: down out of source, across at mid height, down into target. */
    private static flowRoute(edge: ModelEdge): Point[] {
        const s = edge.source;
        const t = edge.target;
        const y0 = s.y + s.h / 2;
        const y1 = t.y - t.h / 2;
        const midY = (y0 + y1) / 2;

        if (Math.abs(s.x - t.x) < 0.5) {
            return [{x: s.x, y: y0}, {x: t.x, y: y1}];
        }

        return [{x: s.x, y: y0}, {x: s.x, y: midY}, {x: t.x, y: midY}, {x: t.x, y: y1}];
    }

    /** Residual/skip edge: orthogonal detour out the right side of both blocks. */
    private static sideRoute(edge: ModelEdge): Point[] {
        const s = edge.source;
        const t = edge.target;
        const x0 = s.x + s.w / 2;
        const x1 = t.x + t.w / 2;
        const bendX = Math.max(x0, x1) + 34;

        return [{x: x0, y: s.y}, {x: bendX, y: s.y}, {x: bendX, y: t.y}, {x: x1, y: t.y}];
    }

    /** Stroke a polyline with rounded corners of radius r at each interior vertex. */
    private static strokeRoundedPolyline(ctx: CanvasRenderingContext2D, pts: Point[], r: number): void {
        if (pts.length < 2) {
            return;
        }

        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);

        for (let i = 1; i < pts.length - 1; i++) {
            ctx.arcTo(pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y, r);
        }

        const last = pts[pts.length - 1]!;

        ctx.lineTo(last.x, last.y);
        ctx.stroke();
    }

    /** Point at fraction u (0..1) along a polyline, by cumulative segment length. */
    private static pointAlong(pts: Point[], u: number): Point {
        if (pts.length === 1) {
            return pts[0]!;
        }

        const lengths: number[] = [];
        let total = 0;

        for (let i = 0; i < pts.length - 1; i++) {
            const d = Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);

            lengths.push(d);
            total += d;
        }

        let target = u * total;

        for (let i = 0; i < lengths.length; i++) {
            if (target <= lengths[i]! || i === lengths.length - 1) {
                const f = lengths[i]! === 0 ? 0 : target / lengths[i]!;

                return {
                    x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * f,
                    y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * f
                };
            }

            target -= lengths[i]!;
        }

        return pts[pts.length - 1]!;
    }

    private drawFlowDots(points: Point[], color: string, phase: number, timeMs: number): void {
        const {ctx} = this;
        const count = 2;
        const speed = 0.00022;

        ctx.save();
        ctx.fillStyle = color;

        for (let i = 0; i < count; i++) {
            const u = (phase + i / count + timeMs * speed) % 1;
            const point = ModelRenderer.pointAlong(points, u);

            ctx.beginPath();
            ctx.arc(point.x, point.y, 2.2, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    private drawNode(node: ModelNode, hovered: boolean, selected: boolean, showLabel: boolean): void {
        const {ctx, theme} = this;
        const accent = this.accentFor(node);
        const dark = ModelRenderer.isDark(theme.background);
        const fill = ModelRenderer.mix(accent, theme.background, 0.84);
        const textColor = dark ? ModelRenderer.mix(accent, '#ffffff', 0.55) : ModelRenderer.mix(accent, '#000000', 0.35);
        const x = node.x - node.w / 2;
        const y = node.y - node.h / 2;

        ctx.save();

        // Stacked outlined cards behind a collapsed "×N" repeat.
        if (node.repeat > 1) {
            for (let i = Math.min(2, node.repeat - 1); i >= 1; i--) {
                const off = i * 5;

                ModelRenderer.roundRectPath(ctx, x + off, y - off, node.w, node.h, 7);
                ctx.fillStyle = theme.background;
                ctx.fill();
                ctx.strokeStyle = ModelRenderer.mix(accent, theme.background, 0.5);
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }
        }

        // Chip body: dark tinted fill + accent outline.
        ModelRenderer.roundRectPath(ctx, x, y, node.w, node.h, 7);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = selected ? theme.nodeSelectedStroke : hovered ? theme.nodeHoverStroke : accent;
        ctx.lineWidth = selected ? 2.2 : hovered ? 2 : 1.5;
        ctx.stroke();

        // Label (+ sublabel), centered, in the accent tint.
        if (showLabel) {
            const maxTextW = node.w - 18;

            ctx.textAlign = 'center';
            ctx.fillStyle = textColor;
            ctx.font = '600 12px Inter, system-ui, sans-serif';
            ctx.textBaseline = 'middle';
            ctx.fillText(node.label, node.x, node.sublabel !== null ? node.y - 7 : node.y, maxTextW);

            if (node.sublabel !== null) {
                ctx.fillStyle = theme.panelSubtext;
                ctx.font = '10px Inter, system-ui, sans-serif';
                ctx.fillText(node.sublabel, node.x, node.y + 9, maxTextW);
            }
        }

        ctx.restore();

        // Big "×N" to the right of a collapsed repeat block.
        if (node.repeat > 1) {
            ctx.save();
            ctx.fillStyle = accent;
            ctx.font = '600 18px Inter, system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(`×${node.repeat}`, x + node.w + 14, node.y);
            ctx.restore();
        }
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

    /** Linear blend from colour `a` to colour `b` by t (0 = a, 1 = b). */
    private static mix(a: string, b: string, t: number): string {
        const ca = ModelRenderer.toRgb(a);
        const cb = ModelRenderer.toRgb(b);
        const m = (x: number, y: number): number => Math.round(x + (y - x) * t);

        return `rgb(${m(ca.r, cb.r)}, ${m(ca.g, cb.g)}, ${m(ca.b, cb.b)})`;
    }

    private static isDark(color: string): boolean {
        const {r, g, b} = ModelRenderer.toRgb(color);

        return (r * 0.299 + g * 0.587 + b * 0.114) < 140;
    }

    /** Parse #rgb / #rrggbb / rgb(...) into channels. */
    private static toRgb(color: string): {r: number; g: number; b: number} {
        const rgb = color.match(/rgba?\(([^)]+)\)/);

        if (rgb !== null) {
            const [r, g, b] = rgb[1]!.split(',').map((n) => parseFloat(n));

            return {r: r!, g: g!, b: b!};
        }

        const clean = color.replace('#', '');
        const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
        const num = parseInt(full, 16);

        return {r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255};
    }

}
