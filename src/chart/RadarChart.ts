import { ChartRange, ChartScale } from './ChartScale';
import { ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { RadarGeometry, RadarPoint } from './RadarGeometry';

/** One profile of a radar chart: a value per category. */
export interface RadarSeries {
    name: string;
    values: ReadonlyArray<number>;
    /** Line colour (any CSS colour); default from the built-in palette. */
    color?: string;
    /** Fill the area: true = the line colour, translucent; or an explicit colour. Default false. */
    fill?: boolean | string;
    /** Dots on the vertices. Default true. */
    markers?: boolean;
    width?: number;
    dash?: number[];
    /** Shown; the legend toggles it. Default true. */
    visible?: boolean;
}

export interface RadarChartOptions {
    /** Axis names, clockwise from the top. */
    categories?: string[];
    series?: RadarSeries[];
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
    /** Value range from centre to rim; default 0 … a round number above the data. */
    valueRange?: ChartRange;
    /** @deprecated use valueRange */
    range?: ChartRange;
    /** Ring shape. Default 'polygon' (a spider web); 'circle' for round rings. */
    grid?: 'polygon' | 'circle';
    /** Ring values printed along the first axis. Default true. */
    ticks?: boolean;
    /** Legend with show/hide boxes, top left. Default true. */
    legend?: boolean;
    /** Grow the profiles out of the centre on `setSeries`. Default true. */
    animate?: boolean;
    /** Wheel zooms, dragging pans, double-click resets. Default true. */
    zoom?: boolean;
    /** Value text in the tooltip. Default: the value with up to two decimals. */
    format?: (value: number) => string;
    /** 'linear' (default) or 'log': rings at 1, 10, 100, 1K …, values ≤ 0 at the centre. */
    scale?: 'linear' | 'log';
    /** Text of a ring value (default: the tick for linear, 1K / 10K for log). */
    ringFormat?: (value: number) => string;
}

export interface RadarChartEvents extends Record<string, unknown> {
    /** The vertex under the pointer changed (null: none). */
    hover: {series: number; axis: number; value: number} | null;
    /** The legend toggled a series. */
    toggle: {series: number; visible: boolean};
}

/**
 * A radar (spider / web / Kiviat) chart: one axis per category around a
 * centre, each series a closed profile across them. Dashed web rings,
 * filled or outlined profiles with vertex dots, a legend that toggles
 * series, a hover tooltip, grow-in animation and wheel zoom / drag pan.
 * Canvas, zero dependencies.
 */
export class RadarChart extends ChartSurface<RadarChartEvents> {

    private static readonly PALETTE = ['#4cc3e8', '#ff8a42', '#8bd45f', '#c48bff', '#ffd25e', '#ff6b8a'];
    private static readonly ANIM_MS = 650;

    private categories: string[] = [];
    private series: RadarSeries[] = [];
    private fixedRange: ChartRange | null;
    private gridShape: 'polygon' | 'circle';
    private readonly showTicks: boolean;
    private readonly showLegend: boolean;
    private readonly animate: boolean;
    private readonly zoomable: boolean;
    private readonly format: (value: number) => string;
    private scaleMode: 'linear' | 'log';
    private readonly ringFormat: ((value: number) => string) | null;

    private growStart = -1;
    private scale = 1;
    private pan = {x: 0, y: 0};
    private vertices: (RadarPoint[] | null)[] = [];
    private legendBoxes: {x: number; y: number; w: number; h: number}[] = [];
    private hovered: {series: number; axis: number} | null = null;
    private press: {x: number; y: number; panX: number; panY: number; moved: boolean} | null = null;

    public constructor(container: HTMLElement, options: RadarChartOptions = {}) {
        super(container, options.theme);
        const range = options.valueRange ?? options.range;
        this.fixedRange = range === undefined ? null : {...range};
        this.gridShape = options.grid ?? 'polygon';
        this.showTicks = options.ticks ?? true;
        this.showLegend = options.legend ?? true;
        this.animate = options.animate ?? true;
        this.zoomable = options.zoom ?? true;
        this.format = options.format ?? ((v) => String(Math.round(v * 100) / 100));
        this.scaleMode = options.scale ?? 'linear';
        this.ringFormat = options.ringFormat ?? null;
        this.categories = (options.categories ?? []).slice();

        this.root.addEventListener('pointerdown', this.onDown);
        this.root.addEventListener('pointermove', this.onMove);
        this.root.addEventListener('pointerup', this.onUp);
        this.root.addEventListener('pointercancel', this.onUp);
        this.root.addEventListener('pointerleave', this.onLeave);
        this.root.addEventListener('wheel', this.onWheel, {passive: false});
        this.root.addEventListener('dblclick', this.onDblClick);

        this.setSeries(options.series ?? []);
    }

    public setCategories(categories: string[]): void {
        this.categories = categories.slice();
        this.redraw();
    }

    /** Replace the profiles (grows them in when `animate`). */
    public setSeries(series: RadarSeries[], options: {animate?: boolean} = {}): void {
        this.series = RadarChart.copySeries(series);
        if (this.hovered !== null && (this.hovered.series >= this.series.length || !this.isVisible(this.hovered.series))) {
            this.hovered = null;   // kept otherwise: live updates do not drop the tooltip
        }
        this.growStart = (options.animate ?? this.animate) ? -2 : -1;   // -2: start on the next frame
        this.redraw();
    }

    /** A copy of the profiles (with their current visibility). */
    public getSeries(): ReadonlyArray<RadarSeries> {
        return RadarChart.copySeries(this.series);
    }

    public setVisible(index: number, visible: boolean): void {
        const s = this.series[index];

        if (s === undefined) {
            return;
        }

        s.visible = visible;
        if (this.hovered?.series === index && !visible) {
            this.hovered = null;
        }
        this.redraw();
    }

    public isVisible(index: number): boolean {
        return this.series[index]?.visible !== false;
    }

    public setGrid(shape: 'polygon' | 'circle'): void {
        this.gridShape = shape;
        this.redraw();
    }

    /** Value range from centre to rim (null = from the data). */
    public setValueRange(range: ChartRange | null): void {
        this.fixedRange = range === null ? null : {...range};
        this.redraw();
    }

    /** @deprecated use setValueRange */
    public setRange(range: ChartRange | null): void {
        this.setValueRange(range);
    }

    /** Play the grow-in again. */
    public replay(): void {
        this.growStart = -2;
        this.redraw();
    }

    /** Undo zoom and pan. */
    public resetView(): void {
        this.scale = 1;
        this.pan = {x: 0, y: 0};
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

    /** Switch between a linear and a log scale. */
    public setScale(scale: 'linear' | 'log'): void {
        this.scaleMode = scale;
        this.redraw();
    }

    public getScale(): 'linear' | 'log' {
        return this.scaleMode;
    }

    /** Ring value range: fixed, or 0 … the next nice tick above the largest value. */
    public get valueRange(): ChartRange {
        if (this.fixedRange !== null) {
            return {...this.fixedRange};
        }

        const ext = ChartScale.extent(this.series.flatMap((s) => s.values));
        if (this.scaleMode === 'log') {
            return {min: 0, max: RadarGeometry.logMax(ext.max)};
        }
        const min = Math.min(0, ext.min);
        const step = ChartScale.niceStep(ext.max - min, 5);

        return {min, max: Math.max(step, Math.ceil(ext.max / step - 1e-9) * step)};
    }

    /** @deprecated use valueRange */
    public get range(): ChartRange {
        return this.valueRange;
    }

    private static copySeries(series: readonly RadarSeries[]): RadarSeries[] {
        return series.map((s) => ({...s, values: s.values.slice(), ...(s.dash !== undefined ? {dash: s.dash.slice()} : {})}));
    }

    // ---- drawing -------------------------------------------------------

    protected draw(ctx: CanvasRenderingContext2D, timeMs: number): boolean {
        const n = this.categories.length;

        if (this.growStart === -2) {
            this.growStart = timeMs;
        }

        const t = this.growStart < 0 ? 1 : Math.min(1, (timeMs - this.growStart) / RadarChart.ANIM_MS);
        const grow = 1 - (1 - t) ** 3;
        const cx = this.width / 2 + this.pan.x;
        const cy = this.height / 2 + 6 + this.pan.y;
        const r = this.baseRadius(ctx, n) * this.scale;
        const range = this.valueRange;

        if (n >= 3) {
            this.drawWeb(ctx, cx, cy, r, n, range);
        }

        this.vertices = this.series.map((s, si) => {
            if (s.visible === false || n < 3) {
                return null;
            }

            const pts = this.categories.map((_, i) => {
                const full = RadarGeometry.point(cx, cy, r, i, n, s.values[i] ?? range.min, range, this.scaleMode);

                return {x: cx + (full.x - cx) * grow, y: cy + (full.y - cy) * grow};
            });

            this.drawProfile(ctx, s, si, pts, grow);

            return pts;
        });

        if (n >= 3) {
            this.drawLabels(ctx, cx, cy, r, n);
        }
        this.drawHover(ctx);
        if (this.showLegend) {
            this.drawLegend(ctx);
        }

        if (t < 1) {
            return true;
        }

        this.growStart = -1;

        return false;
    }

    /** Largest radius that leaves room for the axis labels (measured) on every side. */
    private baseRadius(ctx: CanvasRenderingContext2D, n: number): number {
        ctx.font = `500 ${ChartSurface.FONT.replace('11px', '12px')}`;

        let side = 0;

        this.categories.forEach((label, i) => {
            if (RadarGeometry.labelAlign(i, n).align !== 'center') {
                side = Math.max(side, ctx.measureText(label).width);
            }
        });

        return Math.max(10, Math.min(this.width / 2 - side - 16, this.height / 2 - 30));
    }

    private color(s: RadarSeries, index: number): string {
        return s.color ?? RadarChart.PALETTE[index % RadarChart.PALETTE.length]!;
    }

    private ringPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, n: number): void {
        ctx.beginPath();
        this.ringSubPath(ctx, cx, cy, radius, n);
    }

    private drawWeb(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: number, range: ChartRange): void {
        const log = this.scaleMode === 'log';
        const ticks = log ? RadarGeometry.logTicks(range.max) : ChartScale.ticks(range, 5).filter((v) => v > range.min);
        const step = ChartScale.niceStep(range.max - range.min, 5);

        ctx.save();
        ctx.lineWidth = 1;

        // faint alternating bands between rings
        if (this.theme.band !== '') {
            ctx.fillStyle = this.theme.band;
            ticks.forEach((v, k) => {
                if (k % 2 === 0) {
                    const inner = k === 0 ? 0 : r * RadarGeometry.fraction(ticks[k - 1]!, range, this.scaleMode);

                    this.ringPath(ctx, cx, cy, r * RadarGeometry.fraction(v, range, this.scaleMode), n);
                    if (inner > 0) {
                        this.ringSubPath(ctx, cx, cy, inner, n);
                    }
                    ctx.fill('evenodd');
                }
            });
        }

        ctx.strokeStyle = this.theme.axis;
        ctx.setLineDash([4, 4]);
        for (const v of ticks) {
            this.ringPath(ctx, cx, cy, r * RadarGeometry.fraction(v, range, this.scaleMode), n);
            ctx.stroke();
        }

        // spokes
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const a = RadarGeometry.angle(i, n);
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        if (this.showTicks) {
            ctx.fillStyle = this.theme.text;
            ctx.font = ChartSurface.FONT;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            for (const v of ticks) {
                const y = cy - r * RadarGeometry.fraction(v, range, this.scaleMode);
                const text = this.ringFormat !== null ? this.ringFormat(v)
                    : log ? RadarGeometry.compact(v) : ChartScale.format(v, step).replace(/\.0$/, '');
                ctx.fillText(text, cx + 5, y + 1);
            }
        }
        ctx.restore();
    }

    /** One ring as a subpath (no beginPath), for even-odd bands. */
    private ringSubPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, n: number): void {
        if (this.gridShape === 'circle') {
            ctx.moveTo(cx + radius, cy);
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            return;
        }
        for (let i = 0; i < n; i++) {
            const a = RadarGeometry.angle(i, n);
            const x = cx + Math.cos(a) * radius;
            const y = cy + Math.sin(a) * radius;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.closePath();
    }

    private drawProfile(ctx: CanvasRenderingContext2D, s: RadarSeries, index: number, pts: RadarPoint[], grow: number): void {
        const color = this.color(s, index);
        const hot = this.hovered?.series === index;

        ctx.save();
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();

        if (s.fill !== undefined && s.fill !== false) {
            ctx.fillStyle = typeof s.fill === 'string' ? s.fill : color;
            ctx.globalAlpha = (typeof s.fill === 'string' ? 1 : hot ? 0.32 : 0.2) * grow;
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = (s.width ?? 2) + (hot ? 1 : 0);
        ctx.lineJoin = 'round';
        ctx.setLineDash(s.dash ?? []);
        ctx.stroke();
        ctx.setLineDash([]);

        if (s.markers !== false) {
            ctx.fillStyle = color;
            for (const p of pts) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    private drawLabels(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: number): void {
        ctx.save();
        ctx.fillStyle = this.theme.title;
        ctx.font = `500 ${ChartSurface.FONT.replace('11px', '12px')}`;
        this.categories.forEach((label, i) => {
            const a = RadarGeometry.angle(i, n);
            const {align, baseline} = RadarGeometry.labelAlign(i, n);

            ctx.textAlign = align;
            ctx.textBaseline = baseline;
            ctx.fillText(label, cx + Math.cos(a) * (r + 10), cy + Math.sin(a) * (r + 10));
        });
        ctx.restore();
    }

    private drawHover(ctx: CanvasRenderingContext2D): void {
        const h = this.hovered;
        const p = h === null ? undefined : this.vertices[h.series]?.[h.axis];
        const s = h === null ? undefined : this.series[h.series];

        if (h === null || p === undefined || s === undefined) {
            return;
        }

        const color = this.color(s, h.series);
        const value = s.values[h.axis] ?? 0;
        const line1 = s.name;
        const line2 = `${this.categories[h.axis] ?? ''}: ${this.format(value)}`;

        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = this.theme.background;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = color;
        ctx.stroke();

        ctx.font = `600 ${ChartSurface.FONT}`;
        const w = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 20;
        const boxH = 38;
        let x = p.x + 12;
        let y = p.y - boxH - 8;

        if (x + w > this.width - 4) {
            x = p.x - 12 - w;
        }
        if (y < 4) {
            y = p.y + 12;
        }

        ctx.beginPath();
        ctx.roundRect(x, y, w, boxH, 6);
        ctx.fillStyle = this.theme.background;
        ctx.globalAlpha = 0.94;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.fillText(line1, x + 10, y + 12);
        ctx.font = ChartSurface.FONT;
        ctx.fillStyle = this.theme.title;
        ctx.fillText(line2, x + 10, y + 27);
        ctx.restore();
    }

    private drawLegend(ctx: CanvasRenderingContext2D): void {
        this.legendBoxes = [];

        if (this.series.length === 0) {
            return;
        }

        ctx.save();
        ctx.font = ChartSurface.FONT;

        const rowH = 20;
        const w = Math.max(...this.series.map((s) => ctx.measureText(s.name).width)) + 50;
        const x0 = 12;
        const y0 = 12;

        ctx.beginPath();
        ctx.roundRect(x0, y0, w, this.series.length * rowH + 8, 6);
        ctx.fillStyle = this.theme.pill;
        ctx.fill();

        this.series.forEach((s, i) => {
            const y = y0 + 4 + i * rowH;
            const on = s.visible !== false;
            const color = this.color(s, i);

            // checkbox
            ctx.beginPath();
            ctx.roundRect(x0 + 8, y + 5, 10, 10, 2);
            ctx.fillStyle = on ? this.theme.pillBorder : 'transparent';
            ctx.fill();
            ctx.strokeStyle = this.theme.pillBorder;
            ctx.lineWidth = 1.2;
            ctx.stroke();
            if (on) {
                ctx.strokeStyle = this.theme.background;
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.moveTo(x0 + 10.5, y + 10);
                ctx.lineTo(x0 + 12.5, y + 12.5);
                ctx.lineTo(x0 + 16, y + 7.5);
                ctx.stroke();
            }

            // swatch + name
            ctx.fillStyle = color;
            ctx.globalAlpha = on ? 1 : 0.4;
            ctx.fillRect(x0 + 24, y + 6, 14, 8);
            ctx.fillStyle = this.theme.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.name, x0 + 44, y + 10.5);
            ctx.globalAlpha = 1;

            this.legendBoxes.push({x: x0, y, w, h: rowH});
        });
        ctx.restore();
    }

    // ---- interaction ---------------------------------------------------

    private legendAt(x: number, y: number): number {
        return this.legendBoxes.findIndex((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    }

    private readonly onDown = (e: PointerEvent): void => {
        if (e.button !== 0) {
            return;
        }

        const p = this.local(e);
        const legend = this.legendAt(p.x, p.y);

        if (legend >= 0) {
            const visible = !this.isVisible(legend);

            this.setVisible(legend, visible);
            this.events.emit('toggle', {series: legend, visible});
            return;
        }

        this.press = {x: p.x, y: p.y, panX: this.pan.x, panY: this.pan.y, moved: false};
        this.root.setPointerCapture(e.pointerId);
    };

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);
        const press = this.press;

        if (press !== null && this.zoomable) {
            if (Math.hypot(p.x - press.x, p.y - press.y) > 3) {
                press.moved = true;
            }
            if (press.moved) {
                this.pan = {x: press.panX + p.x - press.x, y: press.panY + p.y - press.y};
                this.root.style.cursor = 'grabbing';
                this.redraw();
                return;
            }
        }

        const hit = RadarGeometry.hit(this.vertices, p.x, p.y, 10);

        this.root.style.cursor = this.legendAt(p.x, p.y) >= 0 || hit !== null ? 'pointer' : this.zoomable ? 'grab' : '';
        this.setHovered(hit);
    };

    private readonly onUp = (e: PointerEvent): void => {
        this.press = null;
        if (this.root.hasPointerCapture(e.pointerId)) {
            this.root.releasePointerCapture(e.pointerId);
        }
        this.root.style.cursor = this.zoomable ? 'grab' : '';
    };

    private readonly onLeave = (): void => {
        if (this.press === null) {
            this.setHovered(null);
        }
    };

    private readonly onWheel = (e: WheelEvent): void => {
        if (!this.zoomable) {
            return;
        }

        e.preventDefault();

        // zoom about the pointer: keep the point under it fixed
        const p = this.local(e);
        const next = Math.max(0.4, Math.min(6, this.scale * Math.exp(-e.deltaY * 0.0015)));
        const k = next / this.scale;
        const cx = this.width / 2 + this.pan.x;
        const cy = this.height / 2 + 6 + this.pan.y;

        this.pan = {x: this.pan.x + (p.x - cx) * (1 - k), y: this.pan.y + (p.y - cy) * (1 - k)};
        this.scale = next;
        this.redraw();
    };

    private readonly onDblClick = (e: MouseEvent): void => {
        const p = this.local(e);

        if (this.zoomable && this.legendAt(p.x, p.y) < 0) {
            this.resetView();
        }
    };

    private setHovered(hit: {series: number; axis: number} | null): void {
        const same = hit === this.hovered || (hit !== null && this.hovered !== null
            && hit.series === this.hovered.series && hit.axis === this.hovered.axis);

        if (same) {
            return;
        }

        this.hovered = hit;
        this.events.emit('hover', hit === null ? null : {...hit, value: this.series[hit.series]?.values[hit.axis] ?? 0});
        this.redraw();
    }

}
