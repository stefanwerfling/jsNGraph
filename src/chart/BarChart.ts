import { Color } from '../util/Color';
import { BarLayout, BarPanel, PlacedBar, BarSeries } from './BarLayout';
import { ChartNote, ChartNotes, NoteAnchor } from './ChartNotes';
import { ChartRange, ChartRect, ChartScale } from './ChartScale';
import { ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';

export interface BarChartOptions {
    /** Category labels on the x axis, one per value. */
    categories?: string[];
    /** Small multiples side by side on one y scale … */
    panels?: BarPanel[];
    /** … or the series of a single panel. */
    series?: BarSeries[];
    /** Several series per category: side by side (default) or stacked. */
    mode?: 'grouped' | 'stacked';
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
    /** Fixed value range (default: 0 … nice max of all panels). */
    yRange?: ChartRange;
    /** Text of a y tick (default: thousands separated). */
    yFormat?: (value: number) => string;
    /** Value text in the tooltip and on the bars (default: yFormat). */
    format?: (value: number) => string;
    /** Value labels on the bars (default false). */
    valueLabels?: boolean;
    /** Share of a category band the bars fill (default 0.8). */
    barWidth?: number;
    /** Space between panels in px (default 28). */
    panelGap?: number;
    /** Legend above the plot (default: when more than one series has a name). */
    legend?: boolean;
    /** Rotate the category labels: 'auto' (default, when they do not fit), or an angle in degrees. */
    rotateLabels?: 'auto' | number;
    notes?: ChartNote[];
    /** Grow / morph bars on new data (default true). */
    animate?: boolean;
}

export interface BarChartEvents extends Record<string, unknown> {
    hover: {panel: number; series: number; category: number; value: number} | null;
    barClick: {panel: number; series: number; category: number; value: number};
}

/**
 * Bar chart: grouped or stacked bars over categories, optionally as small
 * multiples side by side on one value scale (newsroom style — horizontal grid,
 * zero line, rotated labels when crowded). Hover tooltip, value labels, notes
 * with pointers, bars grow and morph on new data. Canvas, zero dependencies.
 *
 *     new BarChart(el, {categories: ['0-19', '20-29'], panels: [{title: 'A', series: [{values: [3, 9]}]}]});
 */
export class BarChart extends ChartSurface<BarChartEvents> {

    private static readonly PALETTE = ['#1380a1', '#990000', '#fab418', '#588300', '#6a3d9a', '#e8743b'];
    private static readonly MORPH_MS = 650;

    private categories: string[];
    private panels: BarPanel[] = [];
    private from: BarPanel[] = [];
    private morphStart = -1;
    private mode: 'grouped' | 'stacked';
    private fixedY: ChartRange | null;
    private readonly yFormat: (v: number) => string;
    private readonly format: (v: number) => string;
    private valueLabels: boolean;
    private readonly fraction: number;
    private readonly panelGap: number;
    private readonly legendOpt: boolean | undefined;
    private readonly rotate: 'auto' | number;
    private readonly animate: boolean;
    private readonly notes: ChartNotes;
    private bars: PlacedBar[] = [];
    private rects: ChartRect[] = [];
    private range: ChartRange = {min: 0, max: 1};
    private hovered: PlacedBar | null = null;
    private pointer: {x: number; y: number} | null = null;

    public constructor(container: HTMLElement, options: BarChartOptions = {}) {
        super(container, options.theme);
        this.categories = (options.categories ?? []).slice();
        this.mode = options.mode ?? 'grouped';
        this.fixedY = options.yRange === undefined ? null : {...options.yRange};
        this.yFormat = options.yFormat ?? ((v) => v.toLocaleString('en-US', {maximumFractionDigits: 2}));
        this.format = options.format ?? this.yFormat;
        this.valueLabels = options.valueLabels ?? false;
        this.fraction = options.barWidth ?? 0.8;
        this.panelGap = options.panelGap ?? 28;
        this.legendOpt = options.legend;
        this.rotate = options.rotateLabels ?? 'auto';
        this.animate = options.animate ?? true;
        this.notes = new ChartNotes(this.root, this.theme);
        this.notes.set(options.notes ?? []);
        this.root.addEventListener('pointermove', this.onMove);
        this.root.addEventListener('pointerleave', this.onLeave);
        this.root.addEventListener('click', this.onClick);
        this.setData(options.panels ?? [{series: options.series ?? []}], options.categories);
    }

    /** New panels (and categories); bars morph from the old values. */
    public setData(panels: BarPanel[], categories?: string[], animate = this.animate): void {
        this.from = animate ? this.shown(performance.now()) : [];
        this.panels = BarChart.copyPanels(panels);
        if (categories !== undefined) {
            this.categories = categories.slice();
        }
        this.morphStart = animate ? 0 : -1;
        this.hovered = null;
        this.redraw();
    }

    /** Replace the series of one panel; a panel index at or past the end appends a panel. */
    public setSeries(series: BarSeries[], panel = 0, animate = this.animate): void {
        const next = this.panels.slice();
        // Never leave holes: draw and hit-test iterate every panel.
        const at = Math.min(Math.max(0, Math.floor(panel)), next.length);

        next[at] = {...(next[at] ?? {}), series};
        this.setData(next, undefined, animate);
    }

    /** A copy of the categories and panels. */
    public getData(): {categories: string[]; panels: BarPanel[]} {
        return {categories: this.categories.slice(), panels: BarChart.copyPanels(this.panels)};
    }

    public setMode(mode: 'grouped' | 'stacked'): void {
        this.mode = mode;
        this.setData(this.panels, undefined);
    }

    public setValueLabels(on: boolean): void {
        this.valueLabels = on;
        this.redraw();
    }

    public setYRange(range: ChartRange | null): void {
        this.fixedY = range === null ? null : {...range};
        this.redraw();
    }

    public setNotes(notes: ChartNote[]): void {
        this.notes.set(notes);
        this.redraw();
    }

    /** Play the grow-in again. */
    public replay(): void {
        this.from = [];
        this.morphStart = 0;
        this.redraw();
    }

    public override destroy(): void {
        this.root.removeEventListener('pointermove', this.onMove);
        this.root.removeEventListener('pointerleave', this.onLeave);
        this.root.removeEventListener('click', this.onClick);
        this.notes.destroy();
        super.destroy();
    }

    private static copyPanels(panels: readonly BarPanel[]): BarPanel[] {
        return panels.map((p) => ({...p, series: p.series.map((s) => ({...s, values: s.values.slice()}))}));
    }

    protected override themeChanged(): void {
        this.notes.setTheme(this.theme);
    }

    /** The panels as drawn at `now` (mid-morph values). */
    private shown(now: number): BarPanel[] {
        const t = this.morphStart < 0 ? 1 : this.morphStart === 0 ? 0 : Math.min(1, (now - this.morphStart) / BarChart.MORPH_MS);

        if (t >= 1) {
            return this.panels;
        }

        const k = 1 - ((1 - t) ** 3);

        return this.panels.map((p, pi) => ({
            ...p,
            series: p.series.map((s, si) => ({
                ...s,
                values: s.values.map((v, c) => {
                    const a = this.from[pi]?.series[si]?.values[c] ?? 0;
                    return a + (v - a) * k;
                })
            }))
        }));
    }

    private color(series: BarSeries, i: number): string {
        return series.color ?? BarChart.PALETTE[i % BarChart.PALETTE.length]!;
    }

    private legendItems(): {name: string; color: string}[] {
        const seen = new Map<string, string>();

        for (const p of this.panels) {
            p.series.forEach((s, i) => {
                if (s.name !== undefined && !seen.has(s.name)) {
                    seen.set(s.name, this.color(s, i));
                }
            });
        }

        return Array.from(seen, ([name, color]) => ({name, color}));
    }

    protected draw(ctx: CanvasRenderingContext2D, timeMs: number): boolean {
        if (this.morphStart === 0) {
            this.morphStart = timeMs;
        }

        const panels = this.shown(timeMs);
        const n = this.categories.length || Math.max(0, ...this.panels.flatMap((p) => p.series.map((s) => s.values.length)));
        const range = this.fixedY ?? BarLayout.range(this.panels, this.mode, n);
        const legend = this.legendItems();
        const showLegend = this.legendOpt ?? legend.length > 1;
        const titled = this.panels.some((p) => p.title !== undefined);
        const theme = this.theme;

        ctx.font = ChartSurface.FONT;

        const ticks = ChartScale.ticks(range, Math.max(2, Math.floor((this.height - 60) / 40)));
        const left = Math.ceil(Math.max(...ticks.map((v) => ctx.measureText(this.yFormat(v)).width))) + 12;
        const top = 8 + (showLegend ? 24 : 0) + (titled ? 26 : 0);
        const count = Math.max(1, this.panels.length);
        const pw = (this.width - left - 10 - this.panelGap * (count - 1)) / count;
        const band = pw / Math.max(1, n);
        const labelW = Math.max(0, ...this.categories.map((c) => ctx.measureText(c).width));
        const angle = this.rotate === 'auto' ? (labelW > band - 6 ? 45 : 0) : this.rotate;
        const rad = angle * Math.PI / 180;
        const bottom = angle === 0 ? 24 : Math.ceil(labelW * Math.sin(rad) + 11 * Math.cos(rad)) + 14;
        const ph = Math.max(20, this.height - top - bottom);

        this.range = range;
        this.rects = this.panels.map((_, i) => ({x: left + i * (pw + this.panelGap), y: top, w: Math.max(10, pw), h: ph}));
        this.bars = [];

        if (showLegend) {
            this.drawLegend(ctx, legend, left);
        }

        this.rects.forEach((rect, pi) => {
            const panel = panels[pi]!;

            if (panel.title !== undefined) {
                ctx.fillStyle = theme.title;
                ctx.font = '600 15px system-ui, -apple-system, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                ctx.fillText(panel.title, rect.x, rect.y - 12);
            }
            this.drawGrid(ctx, rect, range, ticks, pi === 0);
            this.bars.push(...BarLayout.bars(panel, pi, n, rect, range, this.mode, this.fraction));
            this.drawCategories(ctx, rect, n, angle);
        });

        const hv = this.hovered;

        for (const b of this.bars) {
            const s = panels[b.panel]!.series[b.series]!;
            const focus = hv !== null && hv.panel === b.panel && hv.series === b.series && hv.category === b.category;

            ctx.fillStyle = this.color(s, b.series);
            ctx.globalAlpha = hv !== null && !focus ? 0.75 : 1;
            ctx.fillRect(b.x, b.y, b.w, b.h);
            ctx.globalAlpha = 1;
            if (focus) {
                ctx.strokeStyle = theme.select;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(b.x - 0.75, b.y - 0.75, b.w + 1.5, b.h + 1.5);
            }
        }

        // zero line over the bars
        this.rects.forEach((rect) => {
            const y = Math.round(ChartScale.toPx(0, range, rect.y + rect.h, rect.y)) + 0.5;

            ctx.strokeStyle = theme.title;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(rect.x, y);
            ctx.lineTo(rect.x + rect.w, y);
            ctx.stroke();
        });

        if (this.valueLabels) {
            this.drawValueLabels(ctx);
        }
        this.drawTooltip(ctx, panels);
        this.notes.setDimmed(this.hovered !== null);
        this.notes.place((note) => this.anchor(note), {width: this.width, top: 2, bottom: top + ph});

        return this.morphStart > 0 && timeMs - this.morphStart < BarChart.MORPH_MS;
    }

    private drawGrid(ctx: CanvasRenderingContext2D, rect: ChartRect, range: ChartRange, ticks: number[], labels: boolean): void {
        ctx.save();
        ctx.strokeStyle = this.theme.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const v of ticks) {
            const y = Math.round(ChartScale.toPx(v, range, rect.y + rect.h, rect.y)) + 0.5;
            ctx.moveTo(rect.x, y);
            ctx.lineTo(rect.x + rect.w, y);
        }
        ctx.stroke();
        if (labels) {
            ctx.fillStyle = this.theme.text;
            ctx.font = ChartSurface.FONT;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            for (const v of ticks) {
                ctx.fillText(this.yFormat(v), rect.x - 8, ChartScale.toPx(v, range, rect.y + rect.h, rect.y));
            }
        }
        ctx.restore();
    }

    private drawCategories(ctx: CanvasRenderingContext2D, rect: ChartRect, n: number, angle: number): void {
        const y = rect.y + rect.h + 7;

        ctx.save();
        ctx.fillStyle = this.theme.text;
        ctx.font = ChartSurface.FONT;
        for (let c = 0; c < n; c++) {
            const label = this.categories[c] ?? String(c);
            const band = BarLayout.band(rect, n, c);
            const x = band.x + band.w / 2;

            if (angle === 0) {
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(label, x, y);
            } else {
                ctx.save();
                ctx.translate(x, y + 2);
                ctx.rotate(-angle * Math.PI / 180);
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, 0, 0);
                ctx.restore();
            }
        }
        ctx.restore();
    }

    private drawLegend(ctx: CanvasRenderingContext2D, items: {name: string; color: string}[], left: number): void {
        let x = left;

        ctx.save();
        ctx.font = ChartSurface.FONT;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        for (const item of items) {
            ctx.fillStyle = item.color;
            ctx.fillRect(x, 8, 12, 12);
            ctx.fillStyle = this.theme.text;
            ctx.fillText(item.name, x + 17, 14.5);
            x += ctx.measureText(item.name).width + 34;
        }
        ctx.restore();
    }

    private drawValueLabels(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.font = ChartSurface.FONT;
        ctx.textAlign = 'center';
        for (const b of this.bars) {
            const text = this.format(this.panels[b.panel]?.series[b.series]?.values[b.category] ?? b.value);

            if (ctx.measureText(text).width > b.w + 6) {
                continue;
            }
            if (this.mode === 'stacked') {
                if (b.h < 14) {
                    continue;
                }
                ctx.fillStyle = '#ffffff';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, b.x + b.w / 2, b.y + b.h / 2);
            } else {
                ctx.fillStyle = this.theme.title;
                ctx.textBaseline = b.value >= 0 ? 'bottom' : 'top';
                ctx.fillText(text, b.x + b.w / 2, b.value >= 0 ? b.y - 3 : b.y + b.h + 3);
            }
        }
        ctx.restore();
    }

    private drawTooltip(ctx: CanvasRenderingContext2D, panels: BarPanel[]): void {
        const b = this.hovered;
        const at = this.pointer;

        if (b === null || at === null) {
            return;
        }

        const s = panels[b.panel]?.series[b.series];
        const value = this.panels[b.panel]?.series[b.series]?.values[b.category];

        if (s === undefined || value === undefined) {
            return;
        }

        const parts = [this.categories[b.category] ?? String(b.category), s.name, this.panels[b.panel]?.title]
            .filter((t, i, all): t is string => t !== undefined && all.indexOf(t) === i);
        const text = `${parts.join(' · ')}: ${this.format(value)}`;

        ctx.save();
        ctx.font = `600 ${ChartSurface.FONT}`;

        const w = ctx.measureText(text).width + 22;
        const x = Math.max(4, Math.min(this.width - w - 4, at.x + 12));
        const y = Math.max(4, at.y - 30);
        const color = this.color(s, b.series);

        ctx.beginPath();
        ctx.roundRect(x, y, w, 22, 5);
        ctx.fillStyle = Color.withAlpha(this.theme.background, 0.95);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillRect(x + 7, y + 7, 8, 8);
        ctx.fillStyle = this.theme.title;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 19, y + 11.5);
        ctx.restore();
    }

    private categoryIndex(x: number | string): number {
        return typeof x === 'number' ? x : this.categories.indexOf(x);
    }

    private anchor(note: ChartNote): NoteAnchor {
        const pi = note.panel === undefined ? 0 : typeof note.panel === 'number' ? note.panel : this.panels.findIndex((p) => p.id === note.panel);
        const rect = this.rects[pi];
        const c = this.categoryIndex(note.x);
        const n = this.categories.length;

        if (rect === undefined || c < 0 || c >= n) {
            return null;
        }

        const band = BarLayout.band(rect, n, c);
        let y: number;

        if (note.y !== undefined) {
            y = ChartScale.toPx(note.y, this.range, rect.y + rect.h, rect.y);
        } else {
            const bars = this.bars.filter((b) => b.panel === pi && b.category === c);
            y = bars.length > 0 ? Math.min(...bars.map((b) => b.y)) - 3 : rect.y + rect.h;
        }

        return {x: band.x + band.w / 2, y};
    }

    private payload(b: PlacedBar): {panel: number; series: number; category: number; value: number} {
        return {
            panel: b.panel, series: b.series, category: b.category,
            value: this.panels[b.panel]?.series[b.series]?.values[b.category] ?? b.value
        };
    }

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);
        const hit = BarLayout.hit(this.bars, p.x, p.y);
        const before = this.hovered;

        this.pointer = p;
        this.hovered = hit;
        this.root.style.cursor = hit !== null && this.events.has('barClick') ? 'pointer' : '';
        if (hit !== null || before !== null) {
            this.redraw();
        }
        if ((hit === null) !== (before === null) || (hit !== null && before !== null
            && (hit.panel !== before.panel || hit.series !== before.series || hit.category !== before.category))) {
            this.events.emit('hover', hit === null ? null : this.payload(hit));
        }
    };

    private readonly onLeave = (): void => {
        if (this.hovered !== null) {
            this.hovered = null;
            this.events.emit('hover', null);
            this.redraw();
        }
        this.pointer = null;
    };

    private readonly onClick = (e: MouseEvent): void => {
        const p = this.local(e);
        const hit = BarLayout.hit(this.bars, p.x, p.y);

        if (hit !== null) {
            this.events.emit('barClick', this.payload(hit));
        }
    };

}
