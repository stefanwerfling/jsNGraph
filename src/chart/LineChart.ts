import { ChartRange, ChartRect, ChartScale } from './ChartScale';
import { CHART_FONT, ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { ChartSeriesData, WaterfallGeometry } from './WaterfallGeometry';

/** One series of a line chart. */
export interface LineSeries extends ChartSeriesData {
    name?: string;
    /** Stroke colour (any CSS colour); default the theme's `line`. */
    color?: string;
    width?: number;
    /** Dash pattern, e.g. [2, 2]. */
    dash?: number[];
    /** Fill under the line: a colour, or a vertical gradient [top, bottom]. */
    fill?: string | [string, string];
    /** Leave this series out of the legend. */
    legend?: boolean;
    /** A dot on every data point; a number sets its radius (default radius 2.5). */
    markers?: boolean | number;
    /** Indices drawn as a big ringed dot (the "current value" of a dashboard line). */
    highlight?: number | number[];
}

export interface LineChartOptions {
    series?: LineSeries[];
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
    title?: string;
    /** Fixed ranges; default: the data's extent (y padded). */
    xRange?: ChartRange;
    yRange?: ChartRange;
    /** Legend in the top-left corner. Default true when a series has a name. */
    legend?: boolean;
    /** Grid lines and alternating bands. Default true. */
    grid?: boolean;
    /**
     * Category labels on the x axis instead of numbers: label i sits at x = i
     * (series without `x` use the index anyway), e.g. month names.
     */
    xLabels?: string[];
    /** Text of a y tick (e.g. v => '$' + v). */
    yFormat?: (value: number) => string;
}

export interface LineChartEvents extends Record<string, unknown> {
    /** Pointer over the plot: data x nearest to it (of the first series), or null when it left. */
    hover: {x: number | null};
}

const PAD = {left: 46, right: 14, top: 12, bottom: 26};

/**
 * A plain x/y line (and area) chart with axes, grid, title and legend — the
 * companion of `WaterfallChart` for single traces and slices. Canvas, zero
 * dependencies; redraws only when something changes.
 */
export class LineChart extends ChartSurface<LineChartEvents> {

    private series: LineSeries[] = [];
    private title: string;
    private fixedX: ChartRange | null;
    private fixedY: ChartRange | null;
    private readonly legend: boolean | undefined;
    private readonly grid: boolean;
    private xLabels: string[] | null;
    private readonly yFormat: ((value: number) => string) | undefined;
    private plot: ChartRect | null = null;

    public constructor(container: HTMLElement, options: LineChartOptions = {}) {
        super(container, options.theme);
        this.title = options.title ?? '';
        this.fixedX = options.xRange ?? null;
        this.fixedY = options.yRange ?? null;
        this.legend = options.legend;
        this.grid = options.grid ?? true;
        this.xLabels = options.xLabels ?? null;
        this.yFormat = options.yFormat;
        this.root.addEventListener('pointermove', this.onMove);
        this.root.addEventListener('pointerleave', this.onLeave);
        this.setSeries(options.series ?? []);
    }

    public setSeries(series: LineSeries[]): void {
        this.series = series.slice();
        this.redraw();
    }

    /** Replace one series' data/style by position (adds it when missing). */
    public setSeriesAt(index: number, series: LineSeries): void {
        this.series[index] = series;
        this.redraw();
    }

    public getSeries(): ReadonlyArray<LineSeries> {
        return this.series;
    }

    public setTitle(title: string): void {
        this.title = title;
        this.redraw();
    }

    public setXRange(range: ChartRange | null): void {
        this.fixedX = range;
        this.redraw();
    }

    /** Category labels on the x axis (null = numbers again). */
    public setXLabels(labels: string[] | null): void {
        this.xLabels = labels;
        this.redraw();
    }

    public setYRange(range: ChartRange | null): void {
        this.fixedY = range;
        this.redraw();
    }

    public override destroy(): void {
        this.root.removeEventListener('pointermove', this.onMove);
        this.root.removeEventListener('pointerleave', this.onLeave);
        super.destroy();
    }

    protected draw(ctx: CanvasRenderingContext2D): boolean {
        const top = PAD.top + (this.title !== '' ? 20 : 0);
        const plot: ChartRect = {
            x: PAD.left, y: top,
            w: Math.max(10, this.width - PAD.left - PAD.right),
            h: Math.max(10, this.height - top - PAD.bottom)
        };
        const visible = this.series.filter((s) => s.y.length > 0);
        const xRange = this.fixedX ?? (this.xLabels !== null && this.xLabels.length > 1
            ? {min: 0, max: this.xLabels.length - 1}
            : ChartScale.extent(visible.flatMap((s) => [WaterfallGeometry.xAt(s, 0), WaterfallGeometry.xAt(s, s.y.length - 1)])));
        const yRange = this.fixedY ?? ChartScale.pad(ChartScale.extent(visible.flatMap((s) => Array.from(s.y))), 0.05);

        this.plot = plot;

        if (this.title !== '') {
            ctx.fillStyle = this.theme.title;
            ctx.font = `600 12px system-ui, -apple-system, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(this.title, plot.x + plot.w / 2, PAD.top - 2);
        }

        if (this.xLabels !== null) {
            this.drawCategoryAxis(ctx, plot, xRange, this.xLabels);
        } else {
            this.drawXAxis(plot, xRange, {grid: this.grid});
        }
        this.drawYAxis(plot, yRange, {grid: this.grid, format: this.yFormat});

        ctx.save();
        ctx.beginPath();
        ctx.rect(plot.x, plot.y, plot.w, plot.h);
        ctx.clip();
        for (const s of visible) {
            this.drawSeries(ctx, s, plot, xRange, yRange);
        }
        ctx.restore();
        for (const s of visible) {
            this.drawMarkers(ctx, s, plot, xRange, yRange);
        }

        if (this.legend ?? this.series.some((s) => s.name !== undefined)) {
            this.drawLegend(ctx, plot);
        }

        return false;
    }

    private drawSeries(ctx: CanvasRenderingContext2D, s: LineSeries, plot: ChartRect, xRange: ChartRange, yRange: ChartRange): void {
        const n = s.y.length;
        const line = new Path2D();
        let firstX = 0;
        let lastX = 0;

        for (let i = 0; i < n; i++) {
            const x = ChartScale.toPx(WaterfallGeometry.xAt(s, i), xRange, plot.x, plot.x + plot.w);
            const y = ChartScale.toPx(s.y[i] ?? 0, yRange, plot.y + plot.h, plot.y);

            if (i === 0) {
                line.moveTo(x, y);
                firstX = x;
            } else {
                line.lineTo(x, y);
            }
            lastX = x;
        }

        if (s.fill !== undefined) {
            const area = new Path2D(line);
            const bottom = plot.y + plot.h;

            area.lineTo(lastX, bottom);
            area.lineTo(firstX, bottom);
            area.closePath();

            if (typeof s.fill === 'string') {
                ctx.fillStyle = s.fill;
            } else {
                const g = ctx.createLinearGradient(0, plot.y, 0, bottom);
                g.addColorStop(0, s.fill[0]);
                g.addColorStop(1, s.fill[1]);
                ctx.fillStyle = g;
            }
            ctx.fill(area);
        }

        ctx.strokeStyle = s.color ?? this.theme.line;
        ctx.lineWidth = s.width ?? 1.5;
        ctx.lineJoin = 'round';
        ctx.setLineDash(s.dash ?? []);
        ctx.stroke(line);
        ctx.setLineDash([]);
    }

    /** Dots on the points and ringed highlight dots (outside the clip, so edge points stay round). */
    private drawMarkers(ctx: CanvasRenderingContext2D, s: LineSeries, plot: ChartRect, xRange: ChartRange, yRange: ChartRange): void {
        const color = s.color ?? this.theme.line;
        const at = (i: number): [number, number] => [
            ChartScale.toPx(WaterfallGeometry.xAt(s, i), xRange, plot.x, plot.x + plot.w),
            ChartScale.toPx(s.y[i] ?? 0, yRange, plot.y + plot.h, plot.y)
        ];

        ctx.save();
        if (s.markers !== undefined && s.markers !== false) {
            const r = typeof s.markers === 'number' ? s.markers : 2.5;

            ctx.fillStyle = color;
            ctx.beginPath();
            for (let i = 0; i < s.y.length; i++) {
                const [x, y] = at(i);
                ctx.moveTo(x + r, y);
                ctx.arc(x, y, r, 0, Math.PI * 2);
            }
            ctx.fill();
        }

        const marks = s.highlight === undefined ? [] : Array.isArray(s.highlight) ? s.highlight : [s.highlight];

        for (const i of marks) {
            if (i < 0 || i >= s.y.length) {
                continue;
            }

            const [x, y] = at(i);

            ctx.beginPath();
            ctx.arc(x, y, 7, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.25;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.arc(x, y, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = this.theme.background;
            ctx.stroke();
        }
        ctx.restore();
    }

    /** Category labels under the plot (one per index), with vertical grid lines. */
    private drawCategoryAxis(ctx: CanvasRenderingContext2D, plot: ChartRect, range: ChartRange, labels: string[]): void {
        const bottom = plot.y + plot.h;
        const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(plot.w / 46))));

        ctx.save();
        ctx.strokeStyle = this.theme.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        labels.forEach((_, i) => {
            if (this.grid && i % every === 0) {
                const x = Math.round(ChartScale.toPx(i, range, plot.x, plot.x + plot.w)) + 0.5;
                ctx.moveTo(x, plot.y);
                ctx.lineTo(x, bottom);
            }
        });
        ctx.stroke();
        ctx.strokeStyle = this.theme.axis;
        ctx.beginPath();
        ctx.moveTo(plot.x, Math.round(bottom) + 0.5);
        ctx.lineTo(plot.x + plot.w, Math.round(bottom) + 0.5);
        ctx.stroke();
        ctx.fillStyle = this.theme.text;
        ctx.font = CHART_FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        labels.forEach((label, i) => {
            if (i % every === 0) {
                ctx.fillText(label, ChartScale.toPx(i, range, plot.x, plot.x + plot.w), bottom + 7);
            }
        });
        ctx.restore();
    }

    private drawLegend(ctx: CanvasRenderingContext2D, plot: ChartRect): void {
        const items = this.series.filter((s) => s.name !== undefined && s.legend !== false);

        if (items.length === 0) {
            return;
        }

        ctx.save();
        ctx.font = CHART_FONT;

        const widths = items.map((s) => ctx.measureText(s.name!).width + 18);
        const w = widths.reduce((a, b) => a + b, 0) + 8 * (items.length - 1) + 14;
        const x0 = plot.x + 8;
        const y0 = plot.y + 8;

        ctx.beginPath();
        ctx.roundRect(x0, y0, w, 22, 4);
        ctx.fillStyle = this.theme.background;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = this.theme.pill;
        ctx.fill();

        let x = x0 + 7;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        items.forEach((s, i) => {
            ctx.fillStyle = s.color ?? this.theme.line;
            ctx.fillRect(x, y0 + 7, 8, 8);
            ctx.fillStyle = this.theme.text;
            ctx.fillText(s.name!, x + 13, y0 + 11.5);
            x += widths[i]! + 8;
        });
        ctx.restore();
    }

    private readonly onMove = (e: PointerEvent): void => {
        const plot = this.plot;
        const first = this.series.find((s) => s.y.length > 0);

        if (plot === null || first === undefined || !this.events.has('hover')) {
            return;
        }

        const p = this.local(e);

        if (p.x < plot.x || p.x > plot.x + plot.w || p.y < plot.y || p.y > plot.y + plot.h) {
            this.events.emit('hover', {x: null});
            return;
        }

        const xRange = this.fixedX ?? ChartScale.extent([WaterfallGeometry.xAt(first, 0), WaterfallGeometry.xAt(first, first.y.length - 1)]);
        const x = ChartScale.fromPx(p.x, xRange, plot.x, plot.x + plot.w);

        this.events.emit('hover', {x: WaterfallGeometry.xAt(first, WaterfallGeometry.nearestIndex(first, x))});
    };

    private readonly onLeave = (): void => {
        this.events.emit('hover', {x: null});
    };

}
