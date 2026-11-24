import { Color } from '../util/Color';
import { AreaBand, AreaLayout, AreaStack } from './AreaLayout';
import { ChartNote, ChartNotes, NoteAnchor } from './ChartNotes';
import { ChartRange, ChartRect, ChartScale } from './ChartScale';
import { ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { StreamLayout } from './StreamLayout';

export interface AreaSeries {
    id?: string;
    name: string;
    /** Any CSS colour (default: the palette). */
    color?: string;
    /** One value per x. */
    values: number[];
}

/** A vertical guide line (dashed by default). */
export interface AreaMark {
    x: number;
    label?: string;
    /** Default the theme's title colour; a light colour reads well over filled areas. */
    color?: string;
    dash?: boolean;
}

export interface AreaChartOptions {
    x?: number[];
    series?: AreaSeries[];
    /** 'zero' (stacked, default), 'expand' (shares, 100 %) or 'none' (each from 0, overlapping). */
    stack?: AreaStack;
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
    xRange?: ChartRange;
    yRange?: ChartRange;
    /** y tick text (default: numbers; percent for 'expand'). */
    yFormat?: (value: number) => string;
    xFormat?: (x: number) => string;
    /** Tooltip value text (default: yFormat; the raw value, its share in brackets for 'expand'). */
    format?: (value: number) => string;
    /** From this x on the data is a projection: drawn lighter, behind a divider. */
    projectFrom?: number;
    /** Text in the projected part (e.g. 'Projected'). */
    projectLabel?: string;
    marks?: AreaMark[];
    notes?: ChartNote[];
    /** Legend above the plot (default true). */
    legend?: boolean;
    /** Line along each band's top edge in px (default 0 when stacked, 1.5 for 'none'). */
    lineWidth?: number;
    /** Reveal left → right on new data (default true). */
    animate?: boolean;
}

export interface AreaChartEvents extends Record<string, unknown> {
    /** Nearest x under the pointer with every series' raw value, or null. */
    hover: {index: number; x: number; values: number[]} | null;
}

/**
 * Area chart: stacked, 100 % or overlapping areas over x, with a projected
 * part drawn lighter, dashed guide marks, notes with pointers, a legend and a
 * hover guide listing every series at the nearest x. Reveals left → right.
 * Canvas, zero dependencies.
 */
export class AreaChart extends ChartSurface<AreaChartEvents> {

    private static readonly PALETTE = ['#faab18', '#1380a1', '#990000', '#588300', '#6a3d9a', '#e8743b'];
    private static readonly REVEAL_MS = 900;

    private x: number[] = [];
    private series: AreaSeries[] = [];
    private bands: AreaBand[] = [];
    private stack: AreaStack;
    private fixedX: ChartRange | null;
    private fixedY: ChartRange | null;
    private readonly yFormatOpt: ((v: number) => string) | undefined;
    private readonly xFormat: (x: number) => string;
    private readonly formatOpt: ((v: number) => string) | undefined;
    private projectFrom: number | null;
    private projectLabel: string;
    private marks: AreaMark[];
    private readonly legend: boolean;
    private readonly lineWidthOpt: number | undefined;
    private readonly animate: boolean;
    private readonly notes: ChartNotes;
    private plot: ChartRect = {x: 0, y: 0, w: 1, h: 1};
    private xr: ChartRange = {min: 0, max: 1};
    private yr: ChartRange = {min: 0, max: 1};
    private revealStart = -1;
    private hoverIndex = -1;

    public constructor(container: HTMLElement, options: AreaChartOptions = {}) {
        super(container, options.theme);
        this.stack = options.stack ?? 'zero';
        this.fixedX = options.xRange === undefined ? null : {...options.xRange};
        this.fixedY = options.yRange === undefined ? null : {...options.yRange};
        this.yFormatOpt = options.yFormat;
        this.xFormat = options.xFormat ?? ((x) => String(Math.round(x * 100) / 100));
        this.formatOpt = options.format;
        this.projectFrom = options.projectFrom ?? null;
        this.projectLabel = options.projectLabel ?? '';
        this.marks = (options.marks ?? []).map((m) => ({...m}));
        this.legend = options.legend ?? true;
        this.lineWidthOpt = options.lineWidth;
        this.animate = options.animate ?? true;
        this.notes = new ChartNotes(this.root, this.theme);
        this.notes.set(options.notes ?? []);
        this.root.addEventListener('pointermove', this.onMove);
        this.root.addEventListener('pointerleave', this.onLeave);
        this.setData(options.x ?? [], options.series ?? []);
    }

    public setData(x: number[], series: AreaSeries[], animate = this.animate): void {
        this.x = x.slice();
        this.series = series.map((s) => ({...s, values: s.values.slice()}));
        this.restack();
        this.revealStart = animate ? 0 : -1;
        this.redraw();
    }

    /** A copy of x and the series. */
    public getData(): {x: number[]; series: AreaSeries[]} {
        return {x: this.x.slice(), series: this.series.map((s) => ({...s, values: s.values.slice()}))};
    }

    public setStack(stack: AreaStack): void {
        this.stack = stack;
        this.restack();
        this.redraw();
    }

    public setProjection(from: number | null, label = this.projectLabel): void {
        this.projectFrom = from;
        this.projectLabel = label;
        this.redraw();
    }

    public setMarks(marks: AreaMark[]): void {
        this.marks = marks.map((m) => ({...m}));
        this.redraw();
    }

    public setNotes(notes: ChartNote[]): void {
        this.notes.set(notes);
        this.redraw();
    }

    /** Reveal again. */
    public replay(): void {
        this.revealStart = 0;
        this.redraw();
    }

    public override destroy(): void {
        this.root.removeEventListener('pointermove', this.onMove);
        this.root.removeEventListener('pointerleave', this.onLeave);
        this.notes.destroy();
        super.destroy();
    }

    protected override themeChanged(): void {
        this.notes.setTheme(this.theme);
    }

    private restack(): void {
        this.bands = AreaLayout.stack(this.series.map((s) => s.values), this.x.length, this.stack);
    }

    private yFormat(v: number): string {
        if (this.yFormatOpt !== undefined) {
            return this.yFormatOpt(v);
        }

        return this.stack === 'expand' ? `${Math.round(v * 100)}%` : v.toLocaleString('en-US', {maximumFractionDigits: 2});
    }

    private color(i: number): string {
        return this.series[i]?.color ?? AreaChart.PALETTE[i % AreaChart.PALETTE.length]!;
    }

    private sx(x: number): number {
        return ChartScale.toPx(x, this.xr, this.plot.x, this.plot.x + this.plot.w);
    }

    private sy(y: number): number {
        return ChartScale.toPx(y, this.yr, this.plot.y + this.plot.h, this.plot.y);
    }

    protected draw(ctx: CanvasRenderingContext2D, timeMs: number): boolean {
        if (this.revealStart === 0) {
            this.revealStart = timeMs;
        }

        const theme = this.theme;
        const n = this.x.length;

        this.xr = this.fixedX ?? (n > 1 ? {min: this.x[0]!, max: this.x[n - 1]!} : {min: 0, max: 1});
        this.yr = this.fixedY ?? (this.stack === 'expand' ? {min: 0, max: 1} : (() => {
            const r = AreaLayout.range(this.bands);
            const step = ChartScale.niceStep(r.max - r.min, 5);
            return {min: Math.floor(r.min / step) * step, max: Math.ceil(r.max / step) * step};
        })());

        ctx.font = ChartSurface.FONT;

        const yTicks = ChartScale.ticks(this.yr, 4);
        const left = Math.ceil(Math.max(...yTicks.map((v) => ctx.measureText(this.yFormat(v)).width))) + 12;
        const top = 8 + (this.legend ? 26 : 0);

        this.plot = {x: left, y: top, w: Math.max(10, this.width - left - 14), h: Math.max(10, this.height - top - 26)};

        const plot = this.plot;
        const t = this.revealStart > 0 ? Math.min(1, (timeMs - this.revealStart) / AreaChart.REVEAL_MS) : 1;
        const reveal = 1 - ((1 - t) ** 3);

        if (this.legend) {
            this.drawLegend(ctx, left);
        }

        // grid under the areas
        ctx.strokeStyle = theme.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const v of yTicks) {
            const y = Math.round(this.sy(v)) + 0.5;
            ctx.moveTo(plot.x, y);
            ctx.lineTo(plot.x + plot.w, y);
        }
        ctx.stroke();

        ctx.save();
        ctx.beginPath();
        ctx.rect(plot.x, plot.y - 2, plot.w * reveal, plot.h + 2);
        ctx.clip();
        this.drawAreas(ctx);
        this.drawProjection(ctx);
        ctx.restore();

        this.drawMarks(ctx);

        // axes
        ctx.fillStyle = theme.text;
        ctx.font = ChartSurface.FONT;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (const v of yTicks) {
            ctx.fillText(this.yFormat(v), plot.x - 8, this.sy(v));
        }
        ctx.strokeStyle = theme.title;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plot.x, Math.round(plot.y + plot.h) + 0.5);
        ctx.lineTo(plot.x + plot.w, Math.round(plot.y + plot.h) + 0.5);
        for (const v of ChartScale.ticks(this.xr, Math.max(2, Math.floor(plot.w / 80)))) {
            const x = Math.round(this.sx(v)) + 0.5;
            ctx.moveTo(x, plot.y + plot.h);
            ctx.lineTo(x, plot.y + plot.h + 4);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(this.xFormat(v), x, plot.y + plot.h + 7);
        }
        ctx.stroke();
        this.drawHover(ctx);
        this.notes.setDimmed(this.hoverIndex >= 0);
        this.notes.place((note) => this.anchor(note), {width: this.width, top: plot.y, bottom: plot.y + plot.h});

        return t < 1;
    }

    private drawAreas(ctx: CanvasRenderingContext2D): void {
        const n = this.x.length;
        const lw = this.lineWidthOpt ?? (this.stack === 'none' ? 1.5 : 0);

        this.bands.forEach((band, s) => {
            const color = this.color(s);
            const path = new Path2D();

            for (let i = 0; i < n; i++) {
                const px = this.sx(this.x[i]!);
                const py = this.sy(band.upper[i]!);
                if (i === 0) {
                    path.moveTo(px, py);
                } else {
                    path.lineTo(px, py);
                }
            }

            const top = new Path2D(path);

            for (let i = n - 1; i >= 0; i--) {
                path.lineTo(this.sx(this.x[i]!), this.sy(band.lower[i]!));
            }
            path.closePath();
            ctx.fillStyle = this.stack === 'none' ? Color.withAlpha(color, 0.35) : color;
            ctx.fill(path);
            if (lw > 0) {
                ctx.strokeStyle = color;
                ctx.lineWidth = lw;
                ctx.lineJoin = 'round';
                ctx.stroke(top);
            }
        });
    }

    private drawProjection(ctx: CanvasRenderingContext2D): void {
        if (this.projectFrom === null || this.projectFrom >= this.xr.max) {
            return;
        }

        const plot = this.plot;
        const x = Math.max(plot.x, this.sx(this.projectFrom));

        ctx.fillStyle = Color.withAlpha(this.theme.background, 0.35);
        ctx.fillRect(x, plot.y, plot.x + plot.w - x, plot.h);
        ctx.strokeStyle = this.theme.background;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, plot.y);
        ctx.lineTo(Math.round(x) + 0.5, plot.y + plot.h);
        ctx.stroke();

        if (this.projectLabel !== '') {
            ctx.save();
            ctx.font = '700 12px system-ui, -apple-system, sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = 'rgba(0,0,0,0.35)';
            ctx.shadowBlur = 3;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            this.projectLabel.split('\n').forEach((line, i, all) => {
                ctx.fillText(line, (x + plot.x + plot.w) / 2, plot.y + plot.h * 0.4 + (i - (all.length - 1) / 2) * 15);
            });
            ctx.restore();
        }
    }

    private drawMarks(ctx: CanvasRenderingContext2D): void {
        const plot = this.plot;

        ctx.save();
        for (const m of this.marks) {
            if (m.x < this.xr.min || m.x > this.xr.max) {
                continue;
            }

            const x = Math.round(this.sx(m.x)) + 0.5;
            const color = m.color ?? this.theme.title;

            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.setLineDash(m.dash === false ? [] : [5, 4]);
            ctx.beginPath();
            ctx.moveTo(x, plot.y);
            ctx.lineTo(x, plot.y + plot.h);
            ctx.stroke();
            if (m.label !== undefined) {
                ctx.fillStyle = color;
                ctx.font = `700 ${ChartSurface.FONT}`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(m.label, x + 5, plot.y + 5);
            }
        }
        ctx.restore();
    }

    private drawLegend(ctx: CanvasRenderingContext2D, left: number): void {
        let x = left;

        ctx.save();
        ctx.font = ChartSurface.FONT;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        this.series.forEach((s, i) => {
            ctx.fillStyle = this.color(i);
            ctx.fillRect(x, 8, 12, 12);
            ctx.fillStyle = this.theme.text;
            ctx.fillText(s.name, x + 17, 14.5);
            x += ctx.measureText(s.name).width + 34;
        });
        ctx.restore();
    }

    private drawHover(ctx: CanvasRenderingContext2D): void {
        const i = this.hoverIndex;
        const xv = this.x[i];

        if (xv === undefined) {
            return;
        }

        const plot = this.plot;
        const px = Math.round(this.sx(xv)) + 0.5;
        const theme = this.theme;

        ctx.save();
        ctx.strokeStyle = theme.select;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, plot.y);
        ctx.lineTo(px, plot.y + plot.h);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // the tooltip lists the series top first, like the stack
        const rows = this.series.map((s, si) => {
            const raw = s.values[i] ?? 0;
            const band = this.bands[si]!;
            const share = band.upper[i]! - band.lower[i]!;
            const text = this.formatOpt !== undefined ? this.formatOpt(raw)
                : this.stack === 'expand' ? `${raw.toLocaleString('en-US', {maximumFractionDigits: 2})} (${Math.round(share * 100)}%)`
                    : this.yFormat(raw);

            return {name: s.name, text, color: this.color(si)};
        }).reverse();

        ctx.font = ChartSurface.FONT;

        const head = this.xFormat(xv);
        const w = Math.max(ctx.measureText(head).width, ...rows.map((r) => ctx.measureText(`${r.name}  ${r.text}`).width)) + 34;
        const h = 24 + rows.length * 16;
        const x = px + 12 + w > plot.x + plot.w ? px - 12 - w : px + 12;
        const y = plot.y + 6;

        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 5);
        ctx.fillStyle = Color.withAlpha(theme.background, 0.95);
        ctx.fill();
        ctx.strokeStyle = theme.axis;
        ctx.stroke();
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillStyle = theme.title;
        ctx.font = `700 ${ChartSurface.FONT}`;
        ctx.fillText(head, x + 9, y + 12);
        ctx.font = ChartSurface.FONT;
        rows.forEach((r, k) => {
            const ry = y + 28 + k * 16;
            ctx.fillStyle = r.color;
            ctx.fillRect(x + 9, ry - 4, 8, 8);
            ctx.fillStyle = theme.text;
            ctx.textAlign = 'left';
            ctx.fillText(r.name, x + 22, ry);
            ctx.fillStyle = theme.title;
            ctx.textAlign = 'right';
            ctx.fillText(r.text, x + w - 9, ry);
        });
        ctx.restore();
    }

    private anchor(note: ChartNote): NoteAnchor {
        const x = typeof note.x === 'number' ? note.x : Number(note.x);

        if (!Number.isFinite(x) || x < this.xr.min || x > this.xr.max || this.x.length === 0) {
            return null;
        }

        let y = note.y;

        if (y === undefined) {
            const i = StreamLayout.nearest(this.x, x);
            y = Math.max(0, ...this.bands.map((b) => b.upper[i] ?? 0));
        }

        return {x: this.sx(x), y: this.sy(y)};
    }

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);
        const plot = this.plot;
        let index = -1;

        if (p.x >= plot.x && p.x <= plot.x + plot.w && p.y >= plot.y && p.y <= plot.y + plot.h && this.x.length > 0) {
            index = StreamLayout.nearest(this.x, ChartScale.fromPx(p.x, this.xr, plot.x, plot.x + plot.w));
        }
        if (index !== this.hoverIndex) {
            this.hoverIndex = index;
            this.events.emit('hover', index < 0 ? null : {index, x: this.x[index]!, values: this.series.map((s) => s.values[index] ?? 0)});
            this.redraw();
        }
    };

    private readonly onLeave = (): void => {
        if (this.hoverIndex >= 0) {
            this.hoverIndex = -1;
            this.events.emit('hover', null);
            this.redraw();
        }
    };

}
