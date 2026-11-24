import { Color } from '../util/Color';
import { ChartRange, ChartRect, ChartScale } from './ChartScale';
import { ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { TimeScale } from './TimeScale';

/** A line over time: times in ms since epoch (sorted ascending) and one value each. */
export interface TimeSeries {
    name?: string;
    /** Any CSS colour (default the theme's line colour, then a palette). */
    color?: string;
    t: number[];
    values: number[];
    width?: number;
    /** Fill under the line: true = a fading gradient of the line colour, or a CSS colour. */
    fill?: boolean | string;
}

/** Bars under the line (sales, volume …), on their own small axis. */
export interface TimeVolume {
    t: number[];
    values: number[];
    color?: string;
    /** Word after the number in the tooltip (e.g. 'sold'). */
    name?: string;
}

/** A zoom button: the last `span` ms, or everything. */
export interface TimePreset {
    label: string;
    span: number | 'all';
}

export interface TimeSeriesChartOptions {
    series?: TimeSeries[];
    volume?: TimeVolume;
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
    title?: string;
    /** Zoom buttons under the chart (e.g. Week / Month / Lifetime). */
    presets?: TimePreset[];
    /** Text before the buttons (default 'Zoom graph'). */
    presetLabel?: string;
    /** Preset active at start (label); default: everything. */
    initialPreset?: string;
    /** Overview strip with a draggable window (default false). */
    navigator?: boolean;
    /** Value text on the axis and in the tooltip (default: 2 decimals). */
    format?: (value: number) => string;
    /** Volume text (default: thousands separated). */
    volumeFormat?: (value: number) => string;
    /** BCP 47 locale for dates (default the browser's). */
    locale?: string;
    /** Wheel zoom, drag pan, double-click shows everything (default true). */
    zoom?: boolean;
    /** Smallest visible span in ms (default 1 hour). */
    minSpan?: number;
}

export interface TimeSeriesChartEvents extends Record<string, unknown> {
    /** Time under the pointer (nearest point of the first series) with every series' value there, or null. */
    hover: {t: number; values: (number | null)[]; volume: number | null} | null;
    rangeChange: ChartRange;
}

/**
 * Time series chart (price history style): lines over a calendar time axis
 * whose ticks follow the zoom (minutes … years), zoom buttons for the last
 * week / month / everything, wheel zoom and drag pan, a y axis that refits
 * to the visible part, a crosshair tooltip, optional volume bars and an
 * overview strip with a draggable window. Dense data is drawn min/max per
 * pixel so spikes survive. Canvas, zero dependencies.
 */
export class TimeSeriesChart extends ChartSurface<TimeSeriesChartEvents> {

    private static readonly PALETTE = ['#a4d007', '#66c0f4', '#f5a623', '#e0565b', '#b48ef5'];
    private static readonly ANIM_MS = 380;
    private static readonly NAV_H = 40;

    private series: TimeSeries[] = [];
    private volume: TimeVolume | null;
    private title: string;
    private readonly presets: TimePreset[];
    private readonly format: (v: number) => string;
    private readonly volumeFormat: (v: number) => string;
    private readonly locale: string | undefined;
    private readonly zoomOn: boolean;
    private readonly minSpan: number;
    private navigatorOn: boolean;
    private readonly presetBar: HTMLDivElement | null;
    private full: ChartRange = {min: 0, max: 1};
    private view: ChartRange | null = null;
    private anim: {from: ChartRange; to: ChartRange; start: number} | null = null;
    private yShown: ChartRange | null = null;
    private activePreset: string | null;
    private plot: ChartRect = {x: 0, y: 0, w: 1, h: 1};
    private volRect: ChartRect | null = null;
    private navRect: ChartRect | null = null;
    private hoverT: number | null = null;
    private pointer: {x: number; y: number} | null = null;
    private press: {mode: 'pan' | 'nav-move' | 'nav-min' | 'nav-max'; x: number; view: ChartRange; moved: boolean} | null = null;

    public constructor(container: HTMLElement, options: TimeSeriesChartOptions = {}) {
        super(container, options.theme);
        this.volume = options.volume === undefined ? null : {...options.volume};
        this.title = options.title ?? '';
        this.presets = (options.presets ?? []).map((p) => ({...p}));
        this.format = options.format ?? ((v) => v.toFixed(2));
        this.volumeFormat = options.volumeFormat ?? ((v) => Math.round(v).toLocaleString(options.locale));
        this.locale = options.locale;
        this.zoomOn = options.zoom ?? true;
        this.minSpan = options.minSpan ?? TimeScale.HOUR;
        this.navigatorOn = options.navigator ?? false;
        this.activePreset = options.initialPreset ?? null;

        if (this.presets.length > 0) {
            this.presetBar = document.createElement('div');
            this.presetBar.style.cssText = 'position:absolute;right:10px;bottom:2px;display:flex;gap:10px;align-items:center;'
                + 'font:12px system-ui,-apple-system,sans-serif';
            this.root.appendChild(this.presetBar);
            this.buildPresets(options.presetLabel ?? 'Zoom graph');
        } else {
            this.presetBar = null;
        }

        this.canvas.addEventListener('pointerdown', this.onDown);
        this.canvas.addEventListener('pointermove', this.onMove);
        this.canvas.addEventListener('pointerup', this.onUp);
        this.canvas.addEventListener('pointercancel', this.onUp);
        this.canvas.addEventListener('pointerleave', this.onLeave);
        this.canvas.addEventListener('wheel', this.onWheel, {passive: false});
        this.canvas.addEventListener('dblclick', this.onDblClick);
        this.setSeries(options.series ?? []);
        if (this.activePreset !== null) {
            const p = this.presets.find((x) => x.label === this.activePreset);
            if (p !== undefined) {
                this.view = this.presetRange(p);
            }
        }
    }

    /**
     * New data. When the view ended at the newest point it keeps following
     * the end (live data); otherwise the shown range stays put.
     */
    public setSeries(series: TimeSeries[], volume: TimeVolume | null = this.volume): void {
        const before = this.full;
        const followed = this.view !== null && this.view.max >= before.max - 1;

        this.series = series.map((s) => ({...s}));
        this.volume = volume === null ? null : {...volume};
        this.full = this.extent();
        if (this.view !== null) {
            if (followed) {
                const span = this.view.max - this.view.min;
                const preset = this.presets.find((p) => p.label === this.activePreset);

                this.view = preset?.span === 'all'
                    ? null
                    : ChartScale.clamp({min: this.full.max - span, max: this.full.max}, this.full);
            } else {
                this.view = ChartScale.clamp(this.view, this.full);
            }
        }
        this.redraw();
    }

    /** A copy of the series. */
    public getSeries(): ReadonlyArray<TimeSeries> {
        return this.series.map((s) => ({...s, t: s.t.slice(), values: s.values.slice()}));
    }

    public setTitle(title: string): void {
        this.title = title;
        this.redraw();
    }

    /** Show or hide the overview strip. */
    public setNavigator(on: boolean): void {
        this.navigatorOn = on;
        this.redraw();
    }

    /** Show a time range (null: everything), eased. */
    public setRange(range: ChartRange | null, animate = true): void {
        const to = range === null ? null : ChartScale.clamp(range, this.full);

        this.activePreset = null;
        this.syncPresets();
        this.go(to, animate);
    }

    public getRange(): ChartRange {
        return {...this.currentView(performance.now())};
    }

    /** Show the last `span` ms ('all' = everything), eased; marks a preset with that span active. */
    public zoomTo(span: number | 'all', animate = true): void {
        const preset = this.presets.find((p) => p.span === span);

        this.activePreset = preset?.label ?? null;
        this.syncPresets();
        this.go(span === 'all' ? null : this.presetRange({label: '', span}), animate);
    }

    /** Show everything again, eased (like a double-click). */
    public resetView(): void {
        const all = this.presets.find((p) => p.span === 'all');

        this.activePreset = all?.label ?? null;
        this.syncPresets();
        this.go(null, true);
    }

    public override destroy(): void {
        this.canvas.removeEventListener('pointerdown', this.onDown);
        this.canvas.removeEventListener('pointermove', this.onMove);
        this.canvas.removeEventListener('pointerup', this.onUp);
        this.canvas.removeEventListener('pointercancel', this.onUp);
        this.canvas.removeEventListener('pointerleave', this.onLeave);
        this.canvas.removeEventListener('wheel', this.onWheel);
        this.canvas.removeEventListener('dblclick', this.onDblClick);
        super.destroy();
    }

    protected override themeChanged(): void {
        this.syncPresets();
    }

    // ---- ranges ----------------------------------------------------------

    private extent(): ChartRange {
        let min = Infinity;
        let max = -Infinity;

        for (const s of this.series) {
            if (s.t.length > 0) {
                min = Math.min(min, s.t[0]!);
                max = Math.max(max, s.t[s.t.length - 1]!);
            }
        }

        return min < max ? {min, max} : min === max && Number.isFinite(min) ? {min: min - TimeScale.DAY, max: max + TimeScale.DAY} : {min: 0, max: 1};
    }

    private presetRange(p: TimePreset): ChartRange | null {
        if (p.span === 'all') {
            return null;
        }

        return ChartScale.clamp({min: this.full.max - p.span, max: this.full.max}, this.full);
    }

    private go(to: ChartRange | null, animate: boolean): void {
        const from = this.currentView(performance.now());

        this.view = to;
        this.anim = animate ? {from, to: to ?? this.full, start: 0} : null;
        this.events.emit('rangeChange', to ?? this.full);
        this.redraw();
    }

    private currentView(now: number): ChartRange {
        const target = this.view ?? this.full;
        const a = this.anim;

        if (a === null || a.start === 0) {
            return a === null ? target : a.from;
        }

        const t = Math.min(1, (now - a.start) / TimeSeriesChart.ANIM_MS);

        if (t >= 1) {
            this.anim = null;
            return target;
        }

        const k = 1 - ((1 - t) ** 3);

        return {min: a.from.min + (a.to.min - a.from.min) * k, max: a.from.max + (a.to.max - a.from.max) * k};
    }

    /** Value range of the points inside `range` (padded), for all series. */
    private visibleY(range: ChartRange): ChartRange {
        let min = Infinity;
        let max = -Infinity;

        for (const s of this.series) {
            const a = Math.max(0, TimeScale.indexAtOrBefore(s.t, range.min));
            const b = Math.min(s.t.length - 1, TimeScale.indexAtOrBefore(s.t, range.max) + 1);

            for (let i = a; i <= b; i++) {
                const v = s.values[i]!;
                if (Number.isFinite(v)) {
                    min = Math.min(min, v);
                    max = Math.max(max, v);
                }
            }
        }

        if (!(min <= max)) {
            return {min: 0, max: 1};
        }

        return ChartScale.pad({min, max}, 0.1);
    }

    // ---- drawing ---------------------------------------------------------

    protected draw(ctx: CanvasRenderingContext2D, timeMs: number): boolean {
        if (this.anim !== null && this.anim.start === 0) {
            this.anim.start = timeMs;
        }

        const theme = this.theme;
        const view = this.currentView(timeMs);
        const targetY = this.visibleY(view);
        let moving = this.anim !== null;

        // ease the y range towards the visible data
        if (this.yShown === null) {
            this.yShown = targetY;
        } else {
            const y = this.yShown;
            const k = 0.25;
            const next = {min: y.min + (targetY.min - y.min) * k, max: y.max + (targetY.max - y.max) * k};
            const span = Math.max(1e-9, targetY.max - targetY.min);

            if (Math.abs(next.min - targetY.min) < span * 0.002 && Math.abs(next.max - targetY.max) < span * 0.002) {
                this.yShown = targetY;
            } else {
                this.yShown = next;
                moving = true;
            }
        }

        const yr = this.yShown;
        const yTicks = ChartScale.ticks(yr, Math.max(2, Math.floor(this.height / 55)));

        ctx.font = ChartSurface.FONT;

        const left = Math.ceil(Math.max(...yTicks.map((v) => ctx.measureText(this.format(v)).width))) + 14;
        const legend = this.series.filter((s) => s.name !== undefined).length > 1;
        const top = 10 + (this.title !== '' ? 22 : 0) + (legend ? 20 : 0);
        const bottom = 24 + (this.navigatorOn ? TimeSeriesChart.NAV_H + 14 : 0) + (this.presetBar !== null ? 26 : 0);
        const avail = Math.max(40, this.height - top - bottom);
        const volH = this.volume !== null ? Math.round(avail * 0.22) : 0;
        const w = Math.max(10, this.width - left - 14);

        this.plot = {x: left, y: top, w, h: avail - (volH > 0 ? volH + 8 : 0)};
        this.volRect = volH > 0 ? {x: left, y: this.plot.y + this.plot.h + 8, w, h: volH} : null;

        const lowest = this.volRect ?? this.plot;
        const axisY = lowest.y + lowest.h;

        this.navRect = this.navigatorOn ? {x: left, y: axisY + 24, w, h: TimeSeriesChart.NAV_H} : null;

        if (this.title !== '') {
            ctx.fillStyle = theme.title;
            ctx.font = '13px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(this.title, 4, 6);
        }
        if (legend) {
            this.drawLegend(ctx, left, top - 18);
        }

        this.drawGrid(ctx, view, yr, yTicks);

        ctx.save();
        ctx.beginPath();
        ctx.rect(this.plot.x, this.plot.y - 2, this.plot.w, this.plot.h + 4);
        ctx.clip();
        this.series.forEach((s, i) => this.drawLine(ctx, s, i, view, yr, this.plot));
        ctx.restore();

        if (this.volRect !== null) {
            this.drawVolume(ctx, view, this.volRect);
        }
        this.drawTimeAxis(ctx, view, {x: left, y: axisY, w, h: 0});
        if (this.navRect !== null) {
            this.drawNavigator(ctx, view, this.navRect);
        }
        this.drawHover(ctx, view, yr);

        return moving;
    }

    private color(s: TimeSeries, i: number): string {
        return s.color ?? (i === 0 ? this.theme.line : TimeSeriesChart.PALETTE[i % TimeSeriesChart.PALETTE.length]!);
    }

    private drawLegend(ctx: CanvasRenderingContext2D, x0: number, y: number): void {
        let x = x0;

        ctx.save();
        ctx.font = ChartSurface.FONT;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        this.series.forEach((s, i) => {
            if (s.name === undefined) {
                return;
            }
            ctx.fillStyle = this.color(s, i);
            ctx.fillRect(x, y + 4, 14, 3);
            ctx.fillStyle = this.theme.text;
            ctx.fillText(s.name, x + 19, y + 6);
            x += ctx.measureText(s.name).width + 36;
        });
        ctx.restore();
    }

    private drawGrid(ctx: CanvasRenderingContext2D, view: ChartRange, yr: ChartRange, yTicks: number[]): void {
        const p = this.plot;
        const step = TimeScale.step(view, Math.max(2, Math.floor(p.w / 95)));
        const ticks = TimeScale.ticks(view, step);
        const bottom = (this.volRect ?? p).y + (this.volRect ?? p).h;

        ctx.save();
        ctx.strokeStyle = this.theme.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const v of yTicks) {
            const y = Math.round(ChartScale.toPx(v, yr, p.y + p.h, p.y)) + 0.5;
            ctx.moveTo(p.x, y);
            ctx.lineTo(p.x + p.w, y);
        }
        for (const t of ticks) {
            const x = Math.round(ChartScale.toPx(t, view, p.x, p.x + p.w)) + 0.5;
            ctx.moveTo(x, p.y);
            ctx.lineTo(x, bottom);
        }
        ctx.stroke();
        ctx.strokeStyle = this.theme.axis;
        ctx.strokeRect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, Math.round(p.w), Math.round(p.h));
        ctx.fillStyle = this.theme.text;
        ctx.font = ChartSurface.FONT;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (const v of yTicks) {
            ctx.fillText(this.format(v), p.x - 8, ChartScale.toPx(v, yr, p.y + p.h, p.y));
        }
        ctx.restore();
    }

    private drawLine(ctx: CanvasRenderingContext2D, s: TimeSeries, i: number, view: ChartRange, yr: ChartRange, rect: ChartRect): void {
        if (s.t.length === 0) {
            return;
        }

        const from = Math.max(0, TimeScale.indexAtOrBefore(s.t, view.min));
        const to = Math.min(s.t.length - 1, TimeScale.indexAtOrBefore(s.t, view.max) + 1);
        const pts = TimeScale.decimate(s.t, s.values, from, to, view, Math.max(1, Math.round(rect.w)));
        const color = this.color(s, i);
        const line = new Path2D();
        let firstX = 0;
        let lastX = 0;

        pts.forEach(([t, v], k) => {
            const x = ChartScale.toPx(t, view, rect.x, rect.x + rect.w);
            const y = ChartScale.toPx(v, yr, rect.y + rect.h, rect.y);

            if (k === 0) {
                line.moveTo(x, y);
                firstX = x;
            } else {
                line.lineTo(x, y);
            }
            lastX = x;
        });

        if (s.fill !== undefined && s.fill !== false) {
            const area = new Path2D(line);
            const bottom = rect.y + rect.h;

            area.lineTo(lastX, bottom);
            area.lineTo(firstX, bottom);
            area.closePath();
            if (s.fill === true) {
                const g = ctx.createLinearGradient(0, rect.y, 0, bottom);
                g.addColorStop(0, Color.withAlpha(color, 0.35));
                g.addColorStop(1, Color.withAlpha(color, 0.02));
                ctx.fillStyle = g;
            } else {
                ctx.fillStyle = s.fill;
            }
            ctx.fill(area);
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = s.width ?? 1.6;
        ctx.lineJoin = 'round';
        ctx.stroke(line);
    }

    private drawVolume(ctx: CanvasRenderingContext2D, view: ChartRange, rect: ChartRect): void {
        const v = this.volume!;
        const from = Math.max(0, TimeScale.indexAtOrBefore(v.t, view.min));
        const to = Math.min(v.t.length - 1, TimeScale.indexAtOrBefore(v.t, view.max) + 1);
        let max = 0;

        for (let i = from; i <= to; i++) {
            max = Math.max(max, v.values[i] ?? 0);
        }

        const step = ChartScale.niceStep(max, 2);
        const top = Math.max(step, Math.ceil(max / step) * step);
        // bar width: the typical spacing on screen, at least 1 px
        const n = Math.max(1, to - from);
        const bw = Math.max(1, Math.min(14, rect.w / n * 0.7));

        ctx.save();
        ctx.strokeStyle = this.theme.axis;
        ctx.strokeRect(Math.round(rect.x) + 0.5, Math.round(rect.y) + 0.5, Math.round(rect.w), Math.round(rect.h));
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.clip();
        ctx.fillStyle = v.color ?? Color.withAlpha(this.theme.line, 0.55);
        for (let i = from; i <= to; i++) {
            const x = ChartScale.toPx(v.t[i]!, view, rect.x, rect.x + rect.w);
            const h = (v.values[i] ?? 0) / top * (rect.h - 2);
            ctx.fillRect(x - bw / 2, rect.y + rect.h - h, bw, h);
        }
        ctx.restore();
        ctx.fillStyle = this.theme.text;
        ctx.font = ChartSurface.FONT;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(this.volumeFormat(top), rect.x - 8, rect.y);
    }

    private drawTimeAxis(ctx: CanvasRenderingContext2D, view: ChartRange, at: ChartRect): void {
        const step = TimeScale.step(view, Math.max(2, Math.floor(at.w / 95)));

        ctx.save();
        ctx.fillStyle = this.theme.text;
        ctx.font = ChartSurface.FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const t of TimeScale.ticks(view, step)) {
            const x = ChartScale.toPx(t, view, at.x, at.x + at.w);
            const label = TimeScale.label(t, step, this.locale);
            const half = ctx.measureText(label).width / 2;

            ctx.fillText(label, Math.max(at.x + half - 6, Math.min(at.x + at.w - half + 6, x)), at.y + 7);
        }
        ctx.restore();
    }

    private drawNavigator(ctx: CanvasRenderingContext2D, view: ChartRange, rect: ChartRect): void {
        const s = this.series[0];
        const theme = this.theme;

        ctx.save();
        ctx.strokeStyle = theme.axis;
        ctx.strokeRect(Math.round(rect.x) + 0.5, Math.round(rect.y) + 0.5, Math.round(rect.w), Math.round(rect.h));
        if (s !== undefined && s.t.length > 0) {
            const all = ChartScale.extent(s.values);
            ctx.save();
            ctx.globalAlpha = 0.6;
            this.drawLine(ctx, {...s, width: 1, fill: true}, 0, this.full, ChartScale.pad(all, 0.1), {x: rect.x, y: rect.y + 2, w: rect.w, h: rect.h - 4});
            ctx.restore();
        }

        const a = ChartScale.toPx(view.min, this.full, rect.x, rect.x + rect.w);
        const b = ChartScale.toPx(view.max, this.full, rect.x, rect.x + rect.w);

        ctx.fillStyle = Color.withAlpha(theme.background, 0.6);
        ctx.fillRect(rect.x, rect.y, a - rect.x, rect.h);
        ctx.fillRect(b, rect.y, rect.x + rect.w - b, rect.h);
        ctx.fillStyle = theme.pill;
        ctx.fillRect(a, rect.y, b - a, rect.h);
        ctx.strokeStyle = theme.pillBorder;
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(a) + 0.5, rect.y + 0.5, Math.max(1, Math.round(b - a) - 1), rect.h - 1);
        // grips
        ctx.fillStyle = theme.pillBorder;
        for (const x of [a, b]) {
            ctx.fillRect(Math.round(x) - 2, rect.y + rect.h / 2 - 7, 4, 14);
        }
        ctx.restore();
    }

    private drawHover(ctx: CanvasRenderingContext2D, view: ChartRange, yr: ChartRange): void {
        const t = this.hoverT;
        const p = this.plot;

        if (t === null || t < view.min || t > view.max) {
            return;
        }

        const x = Math.round(ChartScale.toPx(t, view, p.x, p.x + p.w)) + 0.5;
        const bottom = (this.volRect ?? p).y + (this.volRect ?? p).h;
        const theme = this.theme;
        const rows: {label: string; color: string}[] = [];

        ctx.save();
        ctx.strokeStyle = Color.withAlpha(theme.select, 0.45);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, p.y);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        this.series.forEach((s, i) => {
            const k = TimeScale.nearest(s.t, t);

            if (k < 0 || Math.abs(s.t[k]! - t) > (view.max - view.min) / 50) {
                return;
            }

            const v = s.values[k]!;
            const y = ChartScale.toPx(v, yr, p.y + p.h, p.y);
            const color = this.color(s, i);

            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = theme.background;
            ctx.stroke();
            rows.push({label: `${s.name !== undefined ? `${s.name}: ` : ''}${this.format(v)}`, color});
        });

        const vol = this.volume;

        if (vol !== null) {
            const k = TimeScale.nearest(vol.t, t);

            if (k >= 0 && Math.abs(vol.t[k]! - t) <= (view.max - view.min) / 50) {
                rows.push({label: `${this.volumeFormat(vol.values[k] ?? 0)}${vol.name !== undefined ? ` ${vol.name}` : ''}`, color: theme.text});
            }
        }

        // tooltip
        const head = TimeScale.full(t, this.locale);

        ctx.font = `600 ${ChartSurface.FONT}`;

        const w = Math.max(ctx.measureText(head).width, ...rows.map((r) => ctx.measureText(r.label).width)) + 20;
        const h = 22 + rows.length * 16;
        const at = this.pointer;
        const tx = x + 14 + w > p.x + p.w ? x - 14 - w : x + 14;
        const ty = Math.max(p.y + 4, Math.min(p.y + p.h - h - 4, (at?.y ?? p.y) - h - 8));

        ctx.beginPath();
        ctx.roundRect(tx, ty, w, h, 4);
        ctx.fillStyle = Color.withAlpha(theme.background, 0.94);
        ctx.fill();
        ctx.strokeStyle = theme.axis;
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = theme.text;
        ctx.font = ChartSurface.FONT;
        ctx.fillText(head, tx + 10, ty + 12);
        ctx.font = `600 ${ChartSurface.FONT}`;
        rows.forEach((r, k) => {
            ctx.fillStyle = r.color === theme.text ? theme.title : r.color;
            ctx.fillText(r.label, tx + 10, ty + 28 + k * 16);
        });
        ctx.restore();
    }

    // ---- presets ---------------------------------------------------------

    private buildPresets(label: string): void {
        const bar = this.presetBar!;
        const lead = document.createElement('span');

        lead.textContent = label;
        lead.dataset['lead'] = '1';
        bar.appendChild(lead);
        for (const p of this.presets) {
            const b = document.createElement('button');

            b.type = 'button';
            b.textContent = p.label;
            b.style.cssText = 'border:0;background:transparent;padding:2px 0;font:inherit;cursor:pointer';
            b.addEventListener('click', () => {
                this.activePreset = p.label;
                this.syncPresets();
                this.go(this.presetRange(p), true);
            });
            bar.appendChild(b);
        }
        this.syncPresets();
    }

    private syncPresets(): void {
        const bar = this.presetBar;

        if (bar === null) {
            return;
        }
        for (const el of Array.from(bar.children) as HTMLElement[]) {
            if (el.dataset['lead'] === '1') {
                el.style.color = this.theme.text;
                continue;
            }

            const on = el.textContent === this.activePreset;

            el.style.color = on ? this.theme.select : this.theme.title;
            el.style.textDecoration = on ? 'underline' : 'none';
            el.style.textUnderlineOffset = '3px';
        }
    }

    // ---- interaction -----------------------------------------------------

    private inPlot(px: number, py: number): boolean {
        const p = this.plot;
        const bottom = (this.volRect ?? p).y + (this.volRect ?? p).h;

        return px >= p.x && px <= p.x + p.w && py >= p.y && py <= bottom;
    }

    private setView(range: ChartRange): void {
        this.anim = null;
        this.view = range.max - range.min >= this.full.max - this.full.min - 1 ? null : range;
        if (this.activePreset !== null) {
            this.activePreset = null;
            this.syncPresets();
        }
        this.events.emit('rangeChange', range);
        this.redraw();
    }

    private readonly onDown = (e: PointerEvent): void => {
        if (e.button !== 0 || !this.zoomOn) {
            return;
        }

        const p = this.local(e);
        const view = this.currentView(performance.now());
        const nav = this.navRect;

        if (nav !== null && p.y >= nav.y && p.y <= nav.y + nav.h && p.x >= nav.x && p.x <= nav.x + nav.w) {
            const a = ChartScale.toPx(view.min, this.full, nav.x, nav.x + nav.w);
            const b = ChartScale.toPx(view.max, this.full, nav.x, nav.x + nav.w);
            let mode: 'nav-move' | 'nav-min' | 'nav-max' = 'nav-move';
            let start = view;

            if (Math.abs(p.x - a) <= 6) {
                mode = 'nav-min';
            } else if (Math.abs(p.x - b) <= 6) {
                mode = 'nav-max';
            } else if (p.x < a || p.x > b) {
                // jump the window to the click, then drag it
                const c = ChartScale.fromPx(p.x, this.full, nav.x, nav.x + nav.w);
                const span = view.max - view.min;
                start = ChartScale.clamp({min: c - span / 2, max: c + span / 2}, this.full);
                this.setView(start);
            }
            this.press = {mode, x: p.x, view: start, moved: false};
            this.canvas.setPointerCapture(e.pointerId);
            return;
        }
        if (this.inPlot(p.x, p.y)) {
            this.press = {mode: 'pan', x: p.x, view, moved: false};
            this.canvas.setPointerCapture(e.pointerId);
        }
    };

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);
        const press = this.press;

        this.pointer = p;
        if (press !== null) {
            const dx = p.x - press.x;

            if (Math.abs(dx) > 2) {
                press.moved = true;
            }
            if (press.mode === 'pan') {
                const span = press.view.max - press.view.min;
                const delta = -dx / this.plot.w * span;
                this.setView(ChartScale.pan(press.view, delta, this.full));
            } else if (this.navRect !== null) {
                const unit = (this.full.max - this.full.min) / this.navRect.w;
                const d = dx * unit;

                if (press.mode === 'nav-move') {
                    this.setView(ChartScale.pan(press.view, d, this.full));
                } else if (press.mode === 'nav-min') {
                    this.setView({min: Math.max(this.full.min, Math.min(press.view.max - this.minSpan, press.view.min + d)), max: press.view.max});
                } else {
                    this.setView({min: press.view.min, max: Math.min(this.full.max, Math.max(press.view.min + this.minSpan, press.view.max + d))});
                }
            }
            this.hoverT = null;
            return;
        }

        const nav = this.navRect;

        this.canvas.style.cursor = nav !== null && p.y >= nav.y && p.y <= nav.y + nav.h ? 'ew-resize' : '';
        if (!this.inPlot(p.x, p.y) || this.series.length === 0) {
            if (this.hoverT !== null) {
                this.hoverT = null;
                this.events.emit('hover', null);
                this.redraw();
            }
            return;
        }

        const view = this.currentView(performance.now());
        const t = ChartScale.fromPx(p.x, view, this.plot.x, this.plot.x + this.plot.w);
        const first = this.series[0]!;
        const k = TimeScale.nearest(first.t, t);
        const snapped = k < 0 ? t : first.t[k]!;

        this.hoverT = snapped;
        this.events.emit('hover', {
            t: snapped,
            values: this.series.map((s) => {
                const i = TimeScale.nearest(s.t, snapped);
                return i < 0 || s.t[i] !== snapped ? null : s.values[i] ?? null;
            }),
            volume: (() => {
                const v = this.volume;
                const i = v === null ? -1 : TimeScale.nearest(v.t, snapped);
                return v === null || i < 0 || v.t[i] !== snapped ? null : v.values[i] ?? null;
            })()
        });
        this.redraw();
    };

    private readonly onUp = (e: PointerEvent): void => {
        if (this.canvas.hasPointerCapture(e.pointerId)) {
            this.canvas.releasePointerCapture(e.pointerId);
        }
        this.press = null;
    };

    private readonly onLeave = (): void => {
        this.pointer = null;
        if (this.hoverT !== null && this.press === null) {
            this.hoverT = null;
            this.events.emit('hover', null);
            this.redraw();
        }
    };

    private readonly onWheel = (e: WheelEvent): void => {
        if (!this.zoomOn) {
            return;
        }

        const p = this.local(e);

        if (!this.inPlot(p.x, p.y)) {
            return;
        }
        e.preventDefault();

        const view = this.currentView(performance.now());
        const at = ChartScale.fromPx(p.x, view, this.plot.x, this.plot.x + this.plot.w);

        this.setView(ChartScale.zoom(view, at, Math.exp(e.deltaY * 0.0015), this.full, this.minSpan));
    };

    private readonly onDblClick = (): void => {
        if (this.zoomOn) {
            this.resetView();
        }
    };

}
