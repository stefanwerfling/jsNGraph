import { LayeredColumn } from '../layout/LayeredLayout';
import { Color } from '../util/Color';
import { Camera } from '../view/Camera';
import { NGraphOverlay } from './Effects';
import { ThemeTokens } from './Theme';

/** Titles over the columns of a layered graph (NGraphOptions.columnHeaders). */
export interface ColumnHeaderOptions {
    /** Title per layer: an array indexed by ring, or a ring → title map. Layers without one stay untitled. */
    labels: ReadonlyArray<string> | Readonly<Record<number, string>>;
    /** Append the member count, e.g. "STREAMS (3)". Default true. */
    counts?: boolean;
    /** Thin vertical lines between the columns. Default true. */
    separators?: boolean;
    /** Height of the title band at the top, screen px. Default 34. */
    height?: number;
    /** Upper-case the titles. Default true. */
    uppercase?: boolean;
}

/** Screen-space span of one column: its title starts at `left`. */
export interface ColumnSpan {
    ring: number;
    left: number;
    right: number;
    count: number;
}

/**
 * Column titles and separators for the layered layout. Drawn in screen
 * space (they stay on top while the graph pans and zooms): separators
 * under the edges, the title band over everything. Columns are split
 * halfway between neighbours; the outer ones get the same half-gap.
 */
export class ColumnHeaders {

    public readonly under: NGraphOverlay;
    public readonly over: NGraphOverlay;

    public constructor(
        private options: ColumnHeaderOptions,
        private readonly columns: () => ReadonlyArray<LayeredColumn>,
        private readonly camera: Camera,
        private readonly theme: () => ThemeTokens,
        private readonly viewport: () => {width: number; height: number; dpr: number}
    ) {
        this.under = {layer: 'under', draw: (ctx) => this.drawSeparators(ctx)};
        this.over = {layer: 'over', draw: (ctx) => this.drawBand(ctx)};
    }

    public setOptions(options: ColumnHeaderOptions): void {
        this.options = options;
    }

    /** Screen spans of the columns (pure: world positions + camera → px). */
    public static spans(columns: ReadonlyArray<LayeredColumn>, toScreenX: (x: number) => number): ColumnSpan[] {
        const xs = columns.map((c) => toScreenX(c.pos));

        return columns.map((c, i) => {
            const x = xs[i]!;
            const prev = xs[i - 1];
            const next = xs[i + 1];
            const half = next !== undefined ? (next - x) / 2 : prev !== undefined ? (x - prev) / 2 : 80;
            const halfPrev = prev !== undefined ? (x - prev) / 2 : half;

            return {ring: c.ring, left: x - halfPrev, right: x + half, count: c.count};
        });
    }

    public title(ring: number): string | null {
        const labels = this.options.labels;
        const raw = Array.isArray(labels) ? (labels as ReadonlyArray<string>)[ring] : (labels as Readonly<Record<number, string>>)[ring];

        return raw === undefined || raw === '' ? null : raw;
    }

    private toScreen(ctx: CanvasRenderingContext2D): ColumnSpan[] {
        const {dpr} = this.viewport();

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        return ColumnHeaders.spans(this.columns(), (x) => this.camera.toScreen(x, 0).x);
    }

    private drawSeparators(ctx: CanvasRenderingContext2D): void {
        if (this.options.separators === false) {
            return;
        }

        const spans = this.toScreen(ctx);
        const {height} = this.viewport();
        const band = this.options.height ?? 34;

        ctx.strokeStyle = Color.withAlpha(this.theme().nodeStroke, 0.28);
        ctx.lineWidth = 1;
        ctx.beginPath();
        spans.forEach((s, i) => {
            if (i > 0) {
                const x = Math.round(s.left) + 0.5;
                ctx.moveTo(x, band);
                ctx.lineTo(x, height);
            }
        });
        ctx.stroke();
    }

    private drawBand(ctx: CanvasRenderingContext2D): void {
        const spans = this.toScreen(ctx);
        const {width} = this.viewport();
        const theme = this.theme();
        const band = this.options.height ?? 34;

        ctx.fillStyle = Color.withAlpha(theme.background, 0.88);
        ctx.fillRect(0, 0, width, band);
        ctx.strokeStyle = Color.withAlpha(theme.nodeStroke, 0.35);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, band - 0.5);
        ctx.lineTo(width, band - 0.5);
        spans.forEach((s, i) => {
            if (i > 0 && this.options.separators !== false) {
                ctx.moveTo(Math.round(s.left) + 0.5, 0);
                ctx.lineTo(Math.round(s.left) + 0.5, band);
            }
        });
        ctx.stroke();

        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        for (const s of spans) {
            const raw = this.title(s.ring);

            if (raw === null || s.right < 0 || s.left > width) {
                continue;
            }

            const text = this.options.uppercase === false ? raw : raw.toUpperCase();
            const x = Math.max(8, s.left + 10);

            ctx.save();
            ctx.beginPath();
            ctx.rect(s.left, 0, s.right - s.left, band);
            ctx.clip();
            ctx.font = '600 11px system-ui, sans-serif';
            ctx.fillStyle = Color.withAlpha(theme.nodeLabel, 0.85);
            ctx.fillText(text, x, band / 2);

            if (this.options.counts !== false) {
                const w = ctx.measureText(text).width;

                ctx.font = '11px system-ui, sans-serif';
                ctx.fillStyle = Color.withAlpha(theme.nodeLabel, 0.45);
                ctx.fillText(`(${s.count})`, x + w + 5, band / 2);
            }
            ctx.restore();
        }
    }

}
