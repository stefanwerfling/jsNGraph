import { Color } from '../util/Color';
import { ChartNote, ChartNotes, NoteAnchor } from './ChartNotes';
import { ChartRange, ChartRect, ChartScale } from './ChartScale';
import { CHART_FONT, ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { Unit, UnitCategory, UnitCell, UnitLayout, UnitPanel, UnitResult } from './UnitLayout';

/** A dashed vertical guide through all panels, labelled under the axis. */
export interface UnitMark {
    x: number;
    /** `\n` breaks. */
    label?: string;
}

export interface UnitHistogramOptions {
    units?: Unit[];
    /** Stack order bottom → top (default one category 'unit'). */
    categories?: UnitCategory[];
    /** Panels top → bottom (default one). */
    panels?: UnitPanel[];
    /** Bin width in x units (default 1). */
    binWidth?: number;
    /** A bin edge (default 0). */
    origin?: number;
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
    /** Shown x range (default: the bins with units, one bin of room each side). */
    xRange?: ChartRange;
    /** x tick text (e.g. v => (v > 0 ? '+' : '') + v + '%'). */
    xFormat?: (x: number) => string;
    /** Tooltip value text (default xFormat). */
    format?: (value: number) => string;
    marks?: UnitMark[];
    notes?: ChartNote[];
    /** Space between panels in px (default 22). */
    panelGap?: number;
    /** Gap between units in px (default 1). */
    gap?: number;
    /** Legend over the panels (default true when there is more than one category). */
    legend?: boolean;
    /** Units drop in on new data (default true). */
    animate?: boolean;
}

export interface UnitHistogramEvents extends Record<string, unknown> {
    hover: {unit: Unit; index: number} | null;
    unitClick: {unit: Unit; index: number};
}

const PALETTE = ['#1380a1', '#8ec3dd', '#990000', '#f19b9b', '#588300', '#fab418'];
const DROP_MS = 320;
const MAX_DELAY = 750;

interface PanelBox extends ChartRect {
    label?: string;
}

/**
 * Unit histogram: every item is one small block in its value bin, stacked by
 * category (e.g. "won" under "lost") — a histogram you can point at. Several
 * panels share the x axis and the count scale; dashed guide marks, notes with
 * curved pointers, a legend with each panel's tone per category. Units drop
 * in on load. Canvas, zero dependencies.
 */
export class UnitHistogram extends ChartSurface<UnitHistogramEvents> {

    private units: Unit[] = [];
    private categories: UnitCategory[];
    private panels: UnitPanel[];
    private binWidth: number;
    private origin: number;
    private fixedX: ChartRange | null;
    private readonly xFormat: (x: number) => string;
    private readonly format: (v: number) => string;
    private marks: UnitMark[];
    private readonly panelGap: number;
    private readonly gap: number;
    private readonly legendOpt: boolean | undefined;
    private readonly animate: boolean;
    private readonly notes: ChartNotes;
    private result: UnitResult = {cells: [], maxStack: 0, minBin: 0, maxBin: 0};
    private byPos = new Map<string, UnitCell>();
    private boxes: PanelBox[] = [];
    private xRange: ChartRange = {min: 0, max: 1};
    private yMax = 1;
    private dropStart = -1;
    private hovered: UnitCell | null = null;
    private pointer: {x: number; y: number} | null = null;

    public constructor(container: HTMLElement, options: UnitHistogramOptions = {}) {
        super(container, options.theme);
        this.categories = options.categories ?? [{id: 'unit', label: 'Unit'}];
        this.panels = options.panels ?? [{id: 'main'}];
        this.binWidth = options.binWidth ?? 1;
        this.origin = options.origin ?? 0;
        this.fixedX = options.xRange ?? null;
        this.xFormat = options.xFormat ?? ((x) => String(Math.round(x * 100) / 100));
        this.format = options.format ?? this.xFormat;
        this.marks = options.marks ?? [];
        this.panelGap = options.panelGap ?? 22;
        this.gap = options.gap ?? 1;
        this.legendOpt = options.legend;
        this.animate = options.animate ?? true;
        this.notes = new ChartNotes(this.root, this.theme);
        this.notes.set(options.notes ?? []);
        this.root.addEventListener('pointermove', this.onMove);
        this.root.addEventListener('pointerleave', this.onLeave);
        this.root.addEventListener('click', this.onClick);
        this.setUnits(options.units ?? []);
    }

    public setUnits(units: Unit[], animate = this.animate): void {
        this.units = units.slice();
        this.result = UnitLayout.place(this.units, {
            binWidth: this.binWidth, origin: this.origin, categories: this.categories, panels: this.panels
        });
        this.byPos = new Map(this.result.cells.map((c) => [`${c.panel}:${c.bin}:${c.stack}`, c]));
        this.dropStart = animate ? 0 : -1;
        this.hovered = null;
        this.redraw();
    }

    public getUnits(): ReadonlyArray<Unit> {
        return this.units;
    }

    /** Change the bins (width, edge) and re-stack. */
    public setBins(binWidth: number, origin = this.origin): void {
        this.binWidth = binWidth;
        this.origin = origin;
        this.setUnits(this.units, false);
    }

    public setMarks(marks: UnitMark[]): void {
        this.marks = marks;
        this.redraw();
    }

    public setNotes(notes: ChartNote[]): void {
        this.notes.set(notes);
        this.redraw();
    }

    public setXRange(range: ChartRange | null): void {
        this.fixedX = range;
        this.redraw();
    }

    /** Drop the units in again. */
    public replay(): void {
        this.dropStart = 0;
        this.redraw();
    }

    public override destroy(): void {
        this.root.removeEventListener('pointermove', this.onMove);
        this.root.removeEventListener('pointerleave', this.onLeave);
        this.root.removeEventListener('click', this.onClick);
        this.notes.destroy();
        super.destroy();
    }

    protected override themeChanged(): void {
        this.notes.setTheme(this.theme);
    }

    private color(panel: number, category: number): string {
        const cat = this.categories[category];
        const own = cat === undefined ? undefined : this.panels[panel]?.colors?.[cat.id];

        return own ?? cat?.color ?? PALETTE[category % PALETTE.length]!;
    }

    private sx(x: number): number {
        const b = this.boxes[0];

        return b === undefined ? 0 : ChartScale.toPx(x, this.xRange, b.x, b.x + b.w);
    }

    private cellRect(c: UnitCell): ChartRect {
        const box = this.boxes[c.panel]!;
        const x0 = this.sx(this.origin + c.bin * this.binWidth);
        const x1 = this.sx(this.origin + (c.bin + 1) * this.binWidth);
        const uh = box.h / this.yMax;
        const g = Math.min(this.gap, (x1 - x0) / 4, uh / 3);

        return {x: x0 + g / 2, y: box.y + box.h - (c.stack + 1) * uh + g / 2, w: x1 - x0 - g, h: uh - g};
    }

    protected draw(ctx: CanvasRenderingContext2D, timeMs: number): boolean {
        if (this.dropStart === 0) {
            this.dropStart = timeMs;
        }

        const theme = this.theme;
        const r = this.result;
        const legend = this.legendOpt ?? this.categories.length > 1;
        const labelled = this.panels.some((p) => p.label !== undefined);
        const counts = ChartScale.ticks({min: 0, max: Math.max(1, r.maxStack)}, 4).filter((v) => Number.isInteger(v));
        const step = counts.length > 1 ? counts[1]! - counts[0]! : 1;

        this.yMax = Math.max(r.maxStack, Math.ceil(Math.max(1, r.maxStack) / step) * step);
        while (counts[counts.length - 1]! < this.yMax) {
            counts.push(counts[counts.length - 1]! + step);
        }

        ctx.font = CHART_FONT;

        const left = Math.ceil(Math.max(...counts.map((v) => ctx.measureText(String(v)).width))) + 12;
        const markLines = Math.max(0, ...this.marks.map((m) => m.label === undefined ? 0 : m.label.split('\n').length));
        const bottom = 24 + markLines * 13;
        const top = 6 + (legend ? 26 : 0);
        const labelH = labelled ? 20 : 0;
        const n = Math.max(1, this.panels.length);
        const ph = Math.max(20, (this.height - top - bottom - (n - 1) * this.panelGap - n * labelH) / n);
        const w = Math.max(10, this.width - left - 12);

        this.boxes = this.panels.map((p, i) => ({
            x: left, y: top + i * (ph + labelH + this.panelGap) + labelH, w, h: ph, label: p.label
        }));
        this.xRange = this.fixedX ?? {
            min: this.origin + (r.minBin - 1) * this.binWidth,
            max: this.origin + (r.maxBin + 2) * this.binWidth
        };

        if (legend) {
            this.drawLegend(ctx, left);
        }

        // panels: label, grid, count axis, baseline
        this.boxes.forEach((box) => {
            if (box.label !== undefined) {
                ctx.fillStyle = theme.title;
                ctx.font = '700 13px system-ui, -apple-system, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                ctx.fillText(box.label, box.x, box.y - 6);
            }
            ctx.strokeStyle = theme.grid;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (const v of counts) {
                const y = Math.round(box.y + box.h - v / this.yMax * box.h) + 0.5;
                ctx.moveTo(box.x, y);
                ctx.lineTo(box.x + box.w, y);
            }
            ctx.stroke();
            ctx.fillStyle = theme.text;
            ctx.font = CHART_FONT;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            for (const v of counts) {
                ctx.fillText(String(v), box.x - 8, box.y + box.h - v / this.yMax * box.h);
            }
        });

        // units
        let busy = false;
        const t = this.dropStart > 0 ? timeMs - this.dropStart : Infinity;
        const hv = this.hovered;

        for (const c of r.cells) {
            const rect = this.cellRect(c);
            const delay = Math.min(MAX_DELAY, c.stack * 16 + (c.bin - r.minBin) * 9);
            const p = Math.max(0, Math.min(1, (t - delay) / DROP_MS));

            if (p < 1) {
                busy = true;
            }
            if (p <= 0) {
                continue;
            }

            const k = 1 - ((1 - p) ** 3);

            ctx.globalAlpha = k;
            ctx.fillStyle = this.color(c.panel, c.category);
            ctx.fillRect(rect.x, rect.y - (1 - k) * 24, rect.w, rect.h);
        }
        ctx.globalAlpha = 1;

        if (hv !== null) {
            const rect = this.cellRect(hv);

            ctx.strokeStyle = theme.select;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2);
        }

        // baselines, marks, x axis
        this.boxes.forEach((box) => {
            ctx.strokeStyle = theme.title;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(box.x, Math.round(box.y + box.h) + 0.5);
            ctx.lineTo(box.x + box.w, Math.round(box.y + box.h) + 0.5);
            ctx.stroke();
        });
        this.drawMarks(ctx);
        this.drawXAxisLabels(ctx);
        this.drawTooltip(ctx);
        this.notes.setDimmed(this.hovered !== null);
        this.notes.place((note) => this.anchor(note), {width: this.width, top: 2, bottom: this.height - bottom});

        return busy;
    }

    private drawLegend(ctx: CanvasRenderingContext2D, left: number): void {
        let x = left;

        ctx.save();
        ctx.font = CHART_FONT;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        this.categories.forEach((cat, ci) => {
            // one swatch split into each panel's tone
            const n = Math.max(1, this.panels.length);

            for (let p = 0; p < n; p++) {
                ctx.fillStyle = this.color(p, ci);
                ctx.fillRect(x, 8 + p * 12 / n, 14, 12 / n);
            }
            ctx.fillStyle = this.theme.text;
            ctx.fillText(cat.label, x + 19, 14.5);
            x += ctx.measureText(cat.label).width + 36;
        });
        ctx.restore();
    }

    private drawMarks(ctx: CanvasRenderingContext2D): void {
        const first = this.boxes[0];
        const last = this.boxes[this.boxes.length - 1];

        if (first === undefined || last === undefined) {
            return;
        }

        ctx.save();
        for (const m of this.marks) {
            if (m.x < this.xRange.min || m.x > this.xRange.max) {
                continue;
            }

            const x = Math.round(this.sx(m.x)) + 0.5;

            ctx.strokeStyle = this.theme.title;
            ctx.lineWidth = 1.2;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            for (const box of this.boxes) {
                ctx.moveTo(x, box.y - 4);
                ctx.lineTo(x, box.y + box.h);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            if (m.label !== undefined) {
                ctx.fillStyle = this.theme.title;
                ctx.font = CHART_FONT;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                m.label.split('\n').forEach((line, i) => {
                    ctx.fillText(line, x, last.y + last.h + 7 + i * 13);
                });
            }
        }
        ctx.restore();
    }

    private drawXAxisLabels(ctx: CanvasRenderingContext2D): void {
        const last = this.boxes[this.boxes.length - 1];

        if (last === undefined) {
            return;
        }

        const ticks = ChartScale.ticks(this.xRange, Math.max(2, Math.floor(last.w / 80)));
        const taken = this.marks.filter((m) => m.label !== undefined).map((m) => this.sx(m.x));
        const y = last.y + last.h;

        ctx.save();
        ctx.fillStyle = this.theme.text;
        ctx.strokeStyle = this.theme.axis;
        ctx.font = CHART_FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const v of ticks) {
            const x = this.sx(v);

            if (taken.some((m) => Math.abs(m - x) < 46)) {
                continue;
            }
            ctx.fillText(this.xFormat(v), x, y + 7);
        }
        ctx.restore();
    }

    private drawTooltip(ctx: CanvasRenderingContext2D): void {
        const c = this.hovered;
        const at = this.pointer;
        const u = c === null ? undefined : this.units[c.unit];

        if (c === null || at === null || u === undefined) {
            return;
        }

        const cat = this.categories[c.category];
        const text = [u.label, this.format(u.value), cat?.label].filter((s) => s !== undefined && s !== '').join(' · ');

        ctx.save();
        ctx.font = `600 ${CHART_FONT}`;

        const w = ctx.measureText(text).width + 22;
        const x = Math.max(4, Math.min(this.width - w - 4, at.x + 12));
        const y = Math.max(4, at.y - 30);
        const color = this.color(c.panel, c.category);

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

    private anchor(note: ChartNote): NoteAnchor {
        const pi = note.panel === undefined ? 0 : typeof note.panel === 'number' ? note.panel : this.panels.findIndex((p) => p.id === note.panel);
        const box = this.boxes[pi];
        const x = typeof note.x === 'number' ? note.x : Number(note.x);

        if (box === undefined || !Number.isFinite(x) || x < this.xRange.min || x > this.xRange.max) {
            return null;
        }

        let count = note.y;

        if (count === undefined) {
            const bin = UnitLayout.binOf(x, this.binWidth, this.origin);
            count = this.result.cells.filter((c) => c.panel === pi && c.bin === bin).length;
        }

        return {
            x: this.sx(this.origin + (UnitLayout.binOf(x, this.binWidth, this.origin) + 0.5) * this.binWidth),
            y: box.y + box.h - count / this.yMax * box.h - 2
        };
    }

    private hitAt(px: number, py: number): UnitCell | null {
        const pi = this.boxes.findIndex((b) => py >= b.y && py <= b.y + b.h && px >= b.x && px <= b.x + b.w);
        const box = this.boxes[pi];

        if (box === undefined) {
            return null;
        }

        const x = ChartScale.fromPx(px, this.xRange, box.x, box.x + box.w);
        const bin = UnitLayout.binOf(x, this.binWidth, this.origin);
        const stack = Math.floor((box.y + box.h - py) / (box.h / this.yMax));

        return this.byPos.get(`${pi}:${bin}:${stack}`) ?? null;
    }

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);
        const hit = this.hitAt(p.x, p.y);
        const before = this.hovered;

        this.pointer = p;
        this.hovered = hit;
        this.root.style.cursor = hit !== null && this.events.has('unitClick') ? 'pointer' : '';
        if (hit !== null || before !== null) {
            this.redraw();
        }
        if (hit !== before) {
            this.events.emit('hover', hit === null ? null : {unit: this.units[hit.unit]!, index: hit.unit});
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
        const hit = this.hitAt(p.x, p.y);

        if (hit !== null) {
            this.events.emit('unitClick', {unit: this.units[hit.unit]!, index: hit.unit});
        }
    };

}
