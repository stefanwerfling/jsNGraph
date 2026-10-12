import { Camera } from './Camera';
import { ModelEdge } from './ModelEdge';
import { ModelNode } from './ModelNode';
import { ModuleKind } from './ModelTypes';
import { ThemeTokens } from '../render/Theme';

export interface ModelRenderOptions {
    showLabels: boolean;
    animate: boolean;
}

type Point = {x: number; y: number};
type Cubic = [Point, Point, Point, Point];

/** Accent color per module kind — mid-saturation so it reads on dark + light. */
const KIND_ACCENT: Record<ModuleKind, string> = {
    input: '#64748b',
    embedding: '#8b5cf6',
    attention: '#3b82f6',
    mlp: '#10b981',
    norm: '#f59e0b',
    head: '#ec4899',
    output: '#64748b',
    block: '#6366f1',
    op: '#94a3b8',
    generic: '#7a8699'
};

/** One-glyph monogram per kind drawn in the accent chip. */
const KIND_GLYPH: Record<ModuleKind, string> = {
    input: 'I',
    embedding: 'E',
    attention: 'A',
    mlp: 'M',
    norm: 'N',
    head: 'H',
    output: 'O',
    block: 'B',
    op: '·',
    generic: '□'
};

/**
 * Draws the model flow graph: a fixed screen-space dotted grid, then the flow
 * edges and module blocks in world space through the Camera. Blocks are
 * rounded cards with an accent chip, a label/sublabel, a "×N" badge for
 * collapsed repeats, and hover/selection strokes.
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

    public draw(nodes: ModelNode[], edges: ModelEdge[], camera: Camera, hoveredId: string | null,
        selectedId: string | null, timeMs: number, options: ModelRenderOptions): void {
        const {ctx, canvas, theme} = this;
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.width / dpr;
        const height = canvas.height / dpr;

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = theme.background;
        ctx.fillRect(0, 0, width, height);
        this.drawGrid(width, height);

        ctx.save();
        camera.apply(ctx);

        for (const edge of edges) {
            this.drawEdge(edge, timeMs, options.animate);
        }

        for (const node of nodes) {
            this.drawNode(node, node.id === hoveredId, node.id === selectedId, options.showLabels);
        }

        ctx.restore();
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

    private drawEdge(edge: ModelEdge, timeMs: number, animate: boolean): void {
        const {ctx, theme} = this;
        const sideRoute = edge.kind !== 'flow';
        const color = sideRoute ? theme.nodeStroke : theme.panelBar;
        const curve = sideRoute ? ModelRenderer.sideCurve(edge) : ModelRenderer.flowCurve(edge);

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = sideRoute ? 1.4 : 1.8;
        ctx.globalAlpha = sideRoute ? 0.55 : 0.85;

        if (sideRoute) {
            ctx.setLineDash([5, 4]);
        }

        ctx.beginPath();
        ctx.moveTo(curve[0].x, curve[0].y);
        ctx.bezierCurveTo(curve[1].x, curve[1].y, curve[2].x, curve[2].y, curve[3].x, curve[3].y);
        ctx.stroke();
        ctx.restore();

        if (!sideRoute) {
            ModelRenderer.drawArrowhead(ctx, curve[3], curve[2], color);
        }

        if (edge.label !== null) {
            const mid = ModelRenderer.cubicPoint(curve, 0.5);

            ctx.save();
            ctx.fillStyle = theme.panelSubtext;
            ctx.font = '10px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(edge.label, mid.x + (sideRoute ? 10 : 0), mid.y);
            ctx.restore();
        }

        if (animate && edge.animated) {
            this.drawFlowDots(curve, color, edge.phase, timeMs);
        }
    }

    /** Forward edge: source bottom-center down to target top-center, vertical S. */
    private static flowCurve(edge: ModelEdge): Cubic {
        const s = edge.source;
        const t = edge.target;
        const p0 = {x: s.x, y: s.y + s.h / 2};
        const p3 = {x: t.x, y: t.y - t.h / 2};
        const midY = (p0.y + p3.y) / 2;

        return [p0, {x: p0.x, y: midY}, {x: p3.x, y: midY}, p3];
    }

    /** Residual/skip edge: bowed out to the right of both blocks' right edges. */
    private static sideCurve(edge: ModelEdge): Cubic {
        const s = edge.source;
        const t = edge.target;
        const p0 = {x: s.x + s.w / 2, y: s.y};
        const p3 = {x: t.x + t.w / 2, y: t.y};
        const bow = Math.max(60, Math.abs(p3.y - p0.y) * 0.4);

        return [p0, {x: p0.x + bow, y: p0.y}, {x: p3.x + bow, y: p3.y}, p3];
    }

    private static cubicPoint(c: Cubic, u: number): Point {
        const v = 1 - u;
        const a = v * v * v;
        const b = 3 * v * v * u;
        const d = 3 * v * u * u;
        const e = u * u * u;

        return {
            x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
            y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y
        };
    }

    private static drawArrowhead(ctx: CanvasRenderingContext2D, tip: Point, from: Point, color: string): void {
        const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
        const size = 7;

        ctx.save();
        ctx.fillStyle = color;
        ctx.translate(tip.x, tip.y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-size, -size * 0.5);
        ctx.lineTo(-size, size * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    private drawFlowDots(curve: Cubic, color: string, phase: number, timeMs: number): void {
        const {ctx} = this;
        const count = 2;
        const speed = 0.00022;

        ctx.save();
        ctx.fillStyle = color;

        for (let i = 0; i < count; i++) {
            const u = (phase + i / count + timeMs * speed) % 1;
            const point = ModelRenderer.cubicPoint(curve, u);

            ctx.beginPath();
            ctx.arc(point.x, point.y, 2.4, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    private drawNode(node: ModelNode, hovered: boolean, selected: boolean, showLabel: boolean): void {
        const {ctx, theme} = this;
        const accent = this.accentFor(node);
        const x = node.x - node.w / 2;
        const y = node.y - node.h / 2;

        ctx.save();

        // Stacked-card shadows behind the block for a collapsed "×N" repeat.
        if (node.repeat > 1) {
            for (let i = Math.min(2, node.repeat - 1); i >= 1; i--) {
                const off = i * 4;

                ModelRenderer.roundRectPath(ctx, x + off, y - off, node.w, node.h, 9);
                ctx.fillStyle = theme.nodeFill;
                ctx.fill();
                ctx.lineWidth = 1;
                ctx.strokeStyle = theme.nodeStroke;
                ctx.stroke();
            }
        }

        // Body
        ModelRenderer.roundRectPath(ctx, x, y, node.w, node.h, 9);
        ctx.fillStyle = theme.nodeFill;
        ctx.fill();
        ctx.lineWidth = selected ? 2.5 : hovered ? 2 : 1.4;
        ctx.strokeStyle = selected
            ? theme.nodeSelectedStroke
            : hovered
                ? theme.nodeHoverStroke
                : theme.nodeStroke;
        ctx.stroke();

        // Accent stripe down the left edge (clipped to the rounded body).
        ctx.save();
        ModelRenderer.roundRectPath(ctx, x, y, node.w, node.h, 9);
        ctx.clip();
        ctx.fillStyle = accent;
        ctx.fillRect(x, y, 4, node.h);
        ctx.restore();

        // Accent chip with the kind monogram.
        const chip = node.h - 20;
        const chipX = x + 14;
        const chipY = node.y - chip / 2;

        ModelRenderer.roundRectPath(ctx, chipX, chipY, chip, chip, 6);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${Math.round(chip * 0.5)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(KIND_GLYPH[node.kind], chipX + chip / 2, chipY + chip / 2 + 0.5);

        // Texts
        if (showLabel) {
            const textX = chipX + chip + 10;
            const maxTextW = node.w - (textX - x) - 14;

            ctx.textAlign = 'left';
            ctx.fillStyle = theme.panelText;
            ctx.font = '600 12.5px system-ui, sans-serif';
            ctx.textBaseline = 'middle';
            ctx.fillText(node.label, textX, node.sublabel !== null ? node.y - 8 : node.y, maxTextW);

            if (node.sublabel !== null) {
                ctx.fillStyle = theme.panelSubtext;
                ctx.font = '10.5px system-ui, sans-serif';
                ctx.fillText(node.sublabel, textX, node.y + 9, maxTextW);
            }
        }

        // Repeat badge
        if (node.repeat > 1) {
            ModelRenderer.drawRepeatBadge(ctx, `×${node.repeat}`, x + node.w, y, accent);
        }

        ctx.restore();
    }

    private static drawRepeatBadge(ctx: CanvasRenderingContext2D, text: string, rightX: number,
        topY: number, accent: string): void {
        ctx.save();
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.textBaseline = 'middle';

        const padX = 6;
        const w = ctx.measureText(text).width + padX * 2;
        const h = 16;
        const bx = rightX - w - 6;
        const by = topY + 6;

        ModelRenderer.roundRectPath(ctx, bx, by, w, h, 8);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(text, bx + w / 2, by + h / 2 + 0.5);
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

}
