import { ChartRange, ChartRect, ChartScale } from './ChartScale';
import { CHART_FONT, ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { ChartSeriesData, WaterfallGeometry, WaterfallLayout } from './WaterfallGeometry';

/** One trace of the stack; index 0 is the front. */
export interface WaterfallSeries extends ChartSeriesData {
    name?: string;
    /** Line colour; default the theme's `line`. */
    color?: string;
}

export interface WaterfallChartOptions {
    series?: WaterfallSeries[];
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
    /** Fixed y range; default: the data's extent, padded. */
    yRange?: ChartRange;
    /** How far the back-most trace is shifted: fractions of the width / height. Defaults 0.28 / 0.42. */
    depthX?: number;
    depthY?: number;
    /** Each trace hides what lies behind it (filled to its baseline in the background colour). Default false. */
    occlude?: boolean;
    /** Wheel zooms and dragging pans the x axis; double-click resets. Default true. */
    zoom?: boolean;
    /** The draggable slice marker: its x (data) or null for none. Default: none. */
    marker?: number | null;
    /** Text of the marker's handle. Default 'Drag me!'. */
    markerLabel?: string;
    /** Selected trace (drawn on top in the `select` colour); null for none. Default 0. */
    selected?: number | null;
    /** Line width of normal traces. Default 1. */
    lineWidth?: number;
}

export interface WaterfallChartEvents extends Record<string, unknown> {
    /** The trace under the pointer changed (null: none). */
    hover: {index: number | null};
    /** A trace was clicked. */
    select: {index: number};
    /** The marker moved: data index (of the front trace) and x. */
    marker: {index: number; x: number};
    /** The visible x range changed (zoom/pan/reset). */
    rangeChange: ChartRange;
}

const PAD = {left: 52, right: 16, top: 16, bottom: 30};

/**
 * A waterfall (stacked spectra) chart: traces drawn one behind another,
 * each shifted right and up, so a series of spectra over time reads as a
 * landscape. Hover lights a trace, a click selects it, a draggable marker
 * cuts a slice through every trace at one x (`marker` event — e.g. to plot
 * that slice elsewhere). The x axis zooms (wheel) and pans (drag).
 * Canvas, zero dependencies.
 */
export class WaterfallChart extends ChartSurface<WaterfallChartEvents> {

    private series: WaterfallSeries[] = [];
    private readonly options: Required<Omit<WaterfallChartOptions, 'series' | 'theme' | 'yRange' | 'marker' | 'selected'>>;
    private fixedY: ChartRange | null;
    private dataX: ChartRange = {min: 0, max: 1};
    private xRange: ChartRange = {min: 0, max: 1};
    private zoomed = false;
    private markerX: number | null;
    private hovered: number | null = null;
    private selectedIndex: number | null;
    private layout: WaterfallLayout | null = null;
    private press: {kind: 'marker' | 'pan'; startX: number; last: number; moved: boolean} | null = null;

    public constructor(container: HTMLElement, options: WaterfallChartOptions = {}) {
        super(container, options.theme);
        this.options = {
            depthX: options.depthX ?? 0.28,
            depthY: options.depthY ?? 0.42,
            occlude: options.occlude ?? false,
            zoom: options.zoom ?? true,
            markerLabel: options.markerLabel ?? 'Drag me!',
            lineWidth: options.lineWidth ?? 1
        };
        this.fixedY = options.yRange ?? null;
        this.markerX = options.marker ?? null;
        this.selectedIndex = options.selected === undefined ? 0 : options.selected;

        this.root.addEventListener('pointerdown', this.onDown);
        this.root.addEventListener('pointermove', this.onMove);
        this.root.addEventListener('pointerup', this.onUp);
        this.root.addEventListener('pointercancel', this.onUp);
        this.root.addEventListener('pointerleave', this.onLeave);
        this.root.addEventListener('wheel', this.onWheel, {passive: false});
        this.root.addEventListener('dblclick', this.onDblClick);

        this.setSeries(options.series ?? []);
    }

    /**
     * Replace the traces (index 0 = front). Keeps the zoom when the x extent
     * stays the same (a streaming update), resets it otherwise.
     */
    public setSeries(series: WaterfallSeries[]): void {
        const prev = this.dataX;

        this.series = series.slice();
        this.dataX = ChartScale.extent(this.series.flatMap((s) => s.y.length === 0
            ? []
            : [WaterfallGeometry.xAt(s, 0), WaterfallGeometry.xAt(s, s.y.length - 1)]));

        if (!this.zoomed || prev.min !== this.dataX.min || prev.max !== this.dataX.max) {
            this.xRange = {...this.dataX};
            this.zoomed = false;
        }
        if (this.hovered !== null && this.hovered >= this.series.length) {
            this.hovered = null;
        }
        if (this.selectedIndex !== null && this.selectedIndex >= this.series.length) {
            this.selectedIndex = this.series.length > 0 ? 0 : null;
        }
        this.redraw();
    }

    public getSeries(): ReadonlyArray<WaterfallSeries> {
        return this.series;
    }

    public get selected(): number | null {
        return this.selectedIndex;
    }

    public select(index: number | null): void {
        this.selectedIndex = index === null || index < 0 || index >= this.series.length ? null : index;
        this.redraw();
    }

    public get hoveredIndex(): number | null {
        return this.hovered;
    }

    /** Move the marker to data x (snapped to the front trace's nearest index); null hides it. */
    public setMarker(x: number | null): void {
        this.markerX = x;
        this.redraw();
    }

    /** The marker as data x and the front trace's index there, or null. */
    public getMarker(): {index: number; x: number} | null {
        const front = this.series[0];

        if (this.markerX === null || front === undefined) {
            return null;
        }

        const index = WaterfallGeometry.nearestIndex(front, this.markerX);

        return {index, x: WaterfallGeometry.xAt(front, index)};
    }

    /** Every trace's value at the marker: the slice through the stack (front first). */
    public slice(): number[] {
        const m = this.getMarker();

        return m === null ? [] : this.series.map((s) => s.y[WaterfallGeometry.nearestIndex(s, m.x)] ?? NaN);
    }

    public get xVisible(): ChartRange {
        return {...this.xRange};
    }

    public setXRange(range: ChartRange | null): void {
        this.xRange = range === null ? {...this.dataX} : ChartScale.clamp(range, this.dataX);
        this.zoomed = range !== null;
        this.events.emit('rangeChange', {...this.xRange});
        this.redraw();
    }

    public setYRange(range: ChartRange | null): void {
        this.fixedY = range;
        this.redraw();
    }

    public override destroy(): void {
        this.root.removeEventListener('pointerdown', this.onDown);
        this.root.removeEventListener('pointermove', this.onMove);
        this.root.removeEventListener('pointerup', this.onUp);
        this.root.removeEventListener('pointercancel', this.onUp);
        this.root.removeEventListener('pointerleave', this.onLeave);
        this.root.removeEventListener('wheel', this.onWheel);
        this.root.removeEventListener('dblclick', this.onDblClick);
        super.destroy();
    }

    // ---- drawing -------------------------------------------------------

    protected draw(ctx: CanvasRenderingContext2D): boolean {
        const area: ChartRect = {
            x: PAD.left, y: PAD.top,
            w: Math.max(10, this.width - PAD.left - PAD.right),
            h: Math.max(10, this.height - PAD.top - PAD.bottom)
        };
        const layout = WaterfallGeometry.layout(area, this.series.length, this.options.depthX, this.options.depthY);
        const yRange = this.yRange();

        this.layout = layout;
        this.drawYAxis(layout.plot, yRange, {line: false});
        this.drawXAxis(layout.plot, this.xRange, {line: false});

        ctx.save();
        ctx.beginPath();
        ctx.rect(area.x, 0, area.w, area.y + area.h);
        ctx.clip();

        // Back to front, so nearer traces lie over farther ones. Without
        // occlusion the highlighted traces go on top; with it they keep their
        // place in the stack (on top, their fill would blank the traces in front).
        const occlude = this.options.occlude;

        for (let s = this.series.length - 1; s >= 0; s--) {
            const highlighted = s === this.hovered || s === this.selectedIndex;

            if (!highlighted) {
                this.drawTrace(layout, s, yRange, this.series[s]!.color ?? this.theme.line, this.options.lineWidth, occlude);
            } else if (occlude) {
                this.drawHighlight(layout, s, yRange, true);
            }
        }
        if (!occlude) {
            if (this.hovered !== null && this.hovered !== this.selectedIndex) {
                this.drawHighlight(layout, this.hovered, yRange, false);
            }
            if (this.selectedIndex !== null) {
                this.drawHighlight(layout, this.selectedIndex, yRange, false);
            }
        }

        this.drawSlice(layout, yRange);
        ctx.restore();
        this.drawMarkerHandle(layout, yRange);

        return false;
    }

    private yRange(): ChartRange {
        return this.fixedY ?? ChartScale.pad(ChartScale.extent(this.series.flatMap((s) => Array.from(s.y))), 0.05);
    }

    private drawHighlight(layout: WaterfallLayout, s: number, yRange: ChartRange, occlude: boolean): void {
        const selected = s === this.selectedIndex;

        this.drawTrace(layout, s, yRange, selected ? this.theme.select : this.theme.hover, selected ? 2 : 2.5, occlude);
    }

    /** One trace, clipped to its own (shifted) plot, only its visible points; `occlude` fills below it first. */
    private drawTrace(layout: WaterfallLayout, s: number, yRange: ChartRange, color: string, width: number, occlude: boolean): void {
        const {ctx} = this;
        const data = this.series[s]!;
        const n = data.y.length;

        if (n === 0) {
            return;
        }

        const {plot} = layout;
        const left = plot.x + s * layout.stepX;
        const from = Math.max(0, WaterfallGeometry.nearestIndex(data, this.xRange.min) - 1);
        const to = Math.min(n - 1, WaterfallGeometry.nearestIndex(data, this.xRange.max) + 1);

        ctx.save();
        ctx.beginPath();
        ctx.rect(left, 0, plot.w, this.height);
        ctx.clip();
        ctx.beginPath();

        for (let i = from; i <= to; i++) {
            const p = WaterfallGeometry.point(layout, s, WaterfallGeometry.xAt(data, i), data.y[i] ?? 0, this.xRange, yRange);

            if (i === from) {
                ctx.moveTo(p.x, p.y);
            } else {
                ctx.lineTo(p.x, p.y);
            }
        }

        if (occlude) {
            const base = plot.y + plot.h + s * layout.stepY;
            const last = WaterfallGeometry.point(layout, s, WaterfallGeometry.xAt(data, to), 0, this.xRange, yRange);
            const first = WaterfallGeometry.point(layout, s, WaterfallGeometry.xAt(data, from), 0, this.xRange, yRange);
            const path = new Path2D();

            path.moveTo(first.x, base);
            for (let i = from; i <= to; i++) {
                const p = WaterfallGeometry.point(layout, s, WaterfallGeometry.xAt(data, i), data.y[i] ?? 0, this.xRange, yRange);
                path.lineTo(p.x, p.y);
            }
            path.lineTo(last.x, base);
            path.closePath();
            ctx.fillStyle = this.theme.background;
            ctx.fill(path);
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
    }

    /** The marker's cut: a short highlighted piece of every trace around the marker index. */
    private drawSlice(layout: WaterfallLayout, yRange: ChartRange): void {
        const m = this.getMarker();

        if (m === null) {
            return;
        }

        const {ctx} = this;

        ctx.save();
        ctx.strokeStyle = this.theme.marker;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';

        for (let s = this.series.length - 1; s >= 0; s--) {
            const data = this.series[s]!;
            const k = WaterfallGeometry.nearestIndex(data, m.x);

            if (k < 0) {
                continue;
            }

            ctx.beginPath();
            for (let i = Math.max(0, k - 1); i <= Math.min(data.y.length - 1, k + 1); i++) {
                const p = WaterfallGeometry.point(layout, s, WaterfallGeometry.xAt(data, i), data.y[i] ?? 0, this.xRange, yRange);
                if (i === Math.max(0, k - 1)) {
                    ctx.moveTo(p.x, p.y);
                } else {
                    ctx.lineTo(p.x, p.y);
                }
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    /** Where the handle sits: under the front trace's point at the marker. */
    private handleBox(layout: WaterfallLayout, yRange: ChartRange): {x: number; dotY: number; box: ChartRect} | null {
        const m = this.getMarker();
        const front = this.series[0];

        if (m === null || front === undefined || m.x < this.xRange.min || m.x > this.xRange.max) {
            return null;
        }

        const p = WaterfallGeometry.point(layout, 0, m.x, front.y[m.index] ?? 0, this.xRange, yRange);
        const bottom = layout.plot.y + layout.plot.h;
        const w = Math.max(70, this.ctx.measureText(this.options.markerLabel).width + 24);
        const h = 24;
        const boxY = bottom - h + 2;            // fixed on the baseline: the handle never jumps with the data

        return {x: p.x, dotY: p.y, box: {x: p.x - w / 2, y: boxY, w, h}};
    }

    private drawMarkerHandle(layout: WaterfallLayout, yRange: ChartRange): void {
        const {ctx, theme} = this;

        ctx.save();
        ctx.font = `600 ${CHART_FONT}`;

        const handle = this.handleBox(layout, yRange);

        if (handle === null) {
            ctx.restore();
            return;
        }

        const {x, dotY, box} = handle;

        ctx.strokeStyle = theme.marker;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(x, dotY);
        ctx.lineTo(x, box.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = theme.marker;
        ctx.beginPath();
        ctx.arc(x, dotY, 4.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.w, box.h, 10);
        ctx.fillStyle = theme.background;
        ctx.fill();
        ctx.fillStyle = theme.pill;
        ctx.fill();
        ctx.lineWidth = this.press?.kind === 'marker' ? 2 : 1.5;
        ctx.strokeStyle = theme.pillBorder;
        ctx.stroke();
        ctx.fillStyle = theme.title;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.options.markerLabel, x, box.y + box.h / 2 + 0.5);
        ctx.restore();
    }

    // ---- interaction ---------------------------------------------------

    private onHandle(x: number, y: number): boolean {
        if (this.layout === null) {
            return false;
        }

        this.ctx.font = `600 ${CHART_FONT}`;

        const h = this.handleBox(this.layout, this.yRange());

        if (h === null) {
            return false;
        }

        const {box} = h;

        return (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) || Math.hypot(x - h.x, y - h.dotY) <= 8;
    }

    private hitTrace(x: number, y: number): number | null {
        return this.layout === null ? null : WaterfallGeometry.hit(this.layout, this.series, x, y, this.xRange, this.yRange(), 6);
    }

    private dataXAt(px: number): number {
        const plot = this.layout?.plot;

        return plot === undefined ? 0 : ChartScale.fromPx(px, this.xRange, plot.x, plot.x + plot.w);
    }

    private readonly onDown = (e: PointerEvent): void => {
        if (e.button !== 0) {
            return;
        }

        const p = this.local(e);
        const kind = this.onHandle(p.x, p.y) ? 'marker' : 'pan';

        this.press = {kind, startX: p.x, last: p.x, moved: false};
        this.root.setPointerCapture(e.pointerId);
        this.redraw();
    };

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);
        const press = this.press;

        if (press === null) {
            const over = this.onHandle(p.x, p.y);
            const hit = over ? null : this.hitTrace(p.x, p.y);

            this.root.style.cursor = over ? 'ew-resize' : hit !== null ? 'pointer' : this.options.zoom ? 'grab' : '';
            this.setHovered(hit);
            return;
        }

        if (Math.abs(p.x - press.startX) > 3) {
            press.moved = true;
        }

        if (press.kind === 'marker') {
            const x = Math.max(this.xRange.min, Math.min(this.xRange.max, this.dataXAt(p.x)));
            const before = this.getMarker()?.index;

            this.markerX = x;
            const now = this.getMarker();

            if (now !== null && now.index !== before) {
                this.events.emit('marker', now);
            }
            this.redraw();
        } else if (press.moved && this.options.zoom) {
            const plot = this.layout?.plot;

            if (plot !== undefined) {
                const delta = -(p.x - press.last) / plot.w * (this.xRange.max - this.xRange.min);

                this.xRange = ChartScale.pan(this.xRange, delta, this.dataX);
                this.zoomed = true;
                this.root.style.cursor = 'grabbing';
                this.events.emit('rangeChange', {...this.xRange});
                this.redraw();
            }
        }
        press.last = p.x;
    };

    private readonly onUp = (e: PointerEvent): void => {
        const press = this.press;

        this.press = null;
        if (this.root.hasPointerCapture(e.pointerId)) {
            this.root.releasePointerCapture(e.pointerId);
        }
        if (press === null) {
            return;
        }

        if (press.kind === 'marker') {
            const m = this.getMarker();
            if (m !== null) {
                this.markerX = m.x;     // snap onto the data
                this.events.emit('marker', m);
            }
        } else if (!press.moved && e.type === 'pointerup') {
            const p = this.local(e);
            const hit = this.hitTrace(p.x, p.y);

            if (hit !== null) {
                this.selectedIndex = hit;
                this.events.emit('select', {index: hit});
            }
        }
        this.redraw();
    };

    private readonly onLeave = (): void => {
        if (this.press === null) {
            this.setHovered(null);
        }
    };

    private readonly onWheel = (e: WheelEvent): void => {
        const plot = this.layout?.plot;

        if (!this.options.zoom || plot === undefined) {
            return;
        }

        e.preventDefault();

        const at = this.dataXAt(this.local(e).x);
        const span = this.dataX.max - this.dataX.min;

        this.xRange = ChartScale.zoom(this.xRange, at, Math.exp(e.deltaY * 0.0015), this.dataX, span / 500);
        this.zoomed = true;
        this.events.emit('rangeChange', {...this.xRange});
        this.redraw();
    };

    private readonly onDblClick = (): void => {
        if (this.options.zoom) {
            this.setXRange(null);
        }
    };

    private setHovered(index: number | null): void {
        if (index === this.hovered) {
            return;
        }

        this.hovered = index;
        this.events.emit('hover', {index});
        this.redraw();
    }

}
