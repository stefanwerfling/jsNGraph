import { SkylineBox, SkylineCell, SkylineDay, SkylineGeometry as G, SkylineGrid, SkylineScale, SkylineView } from './SkylineGeometry';
import { Tween, Widget, WidgetDom, WidgetOptions } from './WidgetBase';

export type SkylineColorMode = 'season' | 'level' | 'category' | ((day: SkylineCell, level: number) => string);

export interface CalendarSkylineOptions extends WidgetOptions {
    days?: SkylineDay[];
    /** First / last date shown ('YYYY-MM-DD'); default the year up to the last data day. */
    from?: string;
    to?: string;
    /** 0 = weeks start on Sunday (default), 1 = Monday. */
    weekStart?: number;
    /** Height scale (default 'linear'). */
    scale?: SkylineScale;
    /** Quantile of the non-zero values that reaches full height (default 0.98). */
    cap?: number;
    /** Height of the tallest box in cells (default 4). */
    maxHeight?: number;
    /** 'season' (default), 'level', 'category' or a function (cell, level 0…4) → colour. */
    colorMode?: SkylineColorMode;
    /** Base colour of 'level' (default a green). */
    levelColor?: string;
    /** Colours of 'category' by category name; others take a built-in palette. */
    categoryColors?: Record<string, string>;
    hemisphere?: 'north' | 'south';
    view?: SkylineView;
    /** Month labels along the front edge, weekday labels at the side (default both). */
    labels?: {months?: boolean; weekdays?: boolean};
    /** Locale for month and weekday names (default the browser's). */
    locale?: string;
    /** Tooltip value line (default: the value); '\n' breaks lines. */
    format?: (day: SkylineCell) => string;
    /** Hover tooltip (default true). */
    tooltip?: boolean;
    /** Drag across days to pick a range (default true). */
    brush?: boolean;
}

export interface SkylineRange {
    from: string;
    to: string;
    cells: SkylineCell[];
    /** Sum of the values in the range. */
    total: number;
    /** False while the pointer is still dragging. */
    final: boolean;
}

export interface CalendarSkylineEvents extends Record<string, unknown> {
    dayHover: SkylineCell | null;
    dayClick: {day: SkylineCell; originalEvent: MouseEvent};
    /** The selected day (click; again or on the background = null). */
    daySelect: SkylineCell | null;
    /** The brushed range, live while dragging; null when cleared. */
    rangeChange: SkylineRange | null;
}

interface Placed extends SkylineCell {
    a: number;
    b: number;
}

/**
 * A year of daily counts as an isometric skyline: one column per day on a
 * contribution-calendar grid (week columns × weekday rows), height = value,
 * colour by season, level or category, faces shaded from it. Days without
 * activity stay flat floor tiles. SVG; boxes grow in, `setDays` morphs.
 */
export class CalendarSkyline extends Widget<CalendarSkylineEvents> {

    private static readonly S = 10;
    private static readonly TILE = 1.2;
    private static readonly PALETTE = ['#5b8def', '#e0664f', '#2fb3a5', '#e8b400', '#8b7cf6', '#d062a8', '#7fb07a', '#8d97ad'];

    private readonly svg: SVGSVGElement;
    private readonly layer: SVGGElement;
    private readonly labelLayer: SVGGElement;
    private readonly tween: Tween;
    private days: SkylineDay[] = [];
    private grid: SkylineGrid = {cells: [], cols: 0, rows: 7, months: []};
    private placed: Placed[] = [];
    private boxes: SVGPolygonElement[][] = [];
    private colors: string[] = [];
    private targets: number[] = [];
    private from: string | undefined;
    private to: string | undefined;
    private readonly weekStart: number;
    private scale: SkylineScale;
    private readonly cap: number;
    private maxHeight: number;
    private colorMode: SkylineColorMode;
    private readonly levelColor: string;
    private readonly categoryColors: Record<string, string>;
    private hemisphere: 'north' | 'south';
    private view: SkylineView;
    private readonly showMonths: boolean;
    private readonly showWeekdays: boolean;
    private readonly locale: string | undefined;
    private builtKey = '';
    private readonly tip: HTMLDivElement;
    private readonly format: ((day: SkylineCell) => string) | undefined;
    private readonly showTip: boolean;
    private readonly brushOn: boolean;
    private groups: SVGGElement[] = [];
    private indexOf = new Map<string, number>();
    private hoverDate: string | null = null;
    private selected: string | null = null;
    private range: {from: number; to: number} | null = null;
    private external: Set<string> | null = null;
    private brush: {anchor: number; moved: boolean} | null = null;

    public constructor(container: HTMLElement, options: CalendarSkylineOptions = {}) {
        super(container, 'wg-sky', options);
        this.from = options.from;
        this.to = options.to;
        this.weekStart = options.weekStart ?? 0;
        this.scale = options.scale ?? 'linear';
        this.cap = options.cap ?? 0.98;
        this.maxHeight = options.maxHeight ?? 4;
        this.colorMode = options.colorMode ?? 'season';
        this.levelColor = options.levelColor ?? '#2f9e57';
        this.categoryColors = options.categoryColors ?? {};
        this.hemisphere = options.hemisphere ?? 'north';
        this.view = options.view ?? 0;
        this.showMonths = options.labels?.months ?? true;
        this.showWeekdays = options.labels?.weekdays ?? true;
        this.locale = options.locale;

        this.svg = WidgetDom.svg('svg', {class: 'wg-svg wg-sky-svg', role: 'img'});
        this.labelLayer = WidgetDom.svg('g', {class: 'wg-sky-labels'});
        this.layer = WidgetDom.svg('g');
        this.svg.append(this.labelLayer, this.layer);
        this.format = options.format;
        this.showTip = options.tooltip ?? true;
        this.brushOn = options.brush ?? true;
        this.tip = document.createElement('div');
        this.tip.className = 'wg-sky-tip';
        this.root.append(this.svg, this.tip);
        this.tween = new Tween((h) => this.paint(h), this.duration * 1.6);

        this.svg.addEventListener('pointerdown', this.onDown);
        this.svg.addEventListener('pointermove', this.onMove);
        this.svg.addEventListener('pointerleave', this.onLeave);
        window.addEventListener('pointerup', this.onUp);
        this.setDays(options.days ?? []);
    }

    /** New data; boxes ease to their new heights (and grow in the first time). */
    public setDays(days: SkylineDay[], range: {from?: string; to?: string} = {}): void {
        this.days = days.map((d) => ({...d}));
        if (range.from !== undefined) {
            this.from = range.from;
        }
        if (range.to !== undefined) {
            this.to = range.to;
        }
        const grid = G.grid(this.days, {from: this.from, to: this.to, weekStart: this.weekStart});
        const key = `${grid.cells[0]?.day}|${grid.cells.length}|${this.view}`;

        this.grid = grid;
        if (key !== this.builtKey) {
            this.build();
            this.builtKey = key;
            this.tween.set(this.placed.map(() => 0), false);
        } else {
            // same cells: carry the values over to the placed list
            const byDay = new Map(grid.cells.map((c) => [c.day, c]));
            this.placed = this.placed.map((p) => ({...p, ...byDay.get(p.day)!, a: p.a, b: p.b}));
        }
        this.recolor();
        this.tween.set(this.targets, this.animate);
    }

    public getCells(): ReadonlyArray<Readonly<SkylineCell>> {
        return this.grid.cells.map((c) => ({...c}));
    }

    public setScale(scale: SkylineScale): void {
        this.scale = scale;
        this.recolor();
        this.tween.set(this.targets, this.animate);
    }

    public setMaxHeight(cells: number): void {
        this.maxHeight = cells;
        this.builtKey = '';
        this.setDays(this.days);
    }

    public setColorMode(mode: SkylineColorMode): void {
        this.colorMode = mode;
        this.recolor();
        this.paint(this.tween.values);
    }

    public setHemisphere(h: 'north' | 'south'): void {
        this.hemisphere = h;
        this.setColorMode(this.colorMode);
    }

    /** Look from another corner (0…3, turning by 90°); the boxes grow in again. */
    public setView(view: SkylineView): void {
        if (view === this.view) {
            return;
        }
        this.view = view;
        this.builtKey = '';
        this.setDays(this.days);
    }

    /** Grow the boxes in again from the floor. */
    public replay(): void {
        this.tween.set(this.placed.map(() => 0), false);
        this.tween.set(this.targets, this.animate);
    }

    /** Select a day (outlined) or clear; fires no event. */
    public select(date: string | null): void {
        this.selected = date;
        this.applyState();
    }

    public getSelected(): SkylineCell | null {
        return this.selected === null ? null : this.cellAt(this.selected);
    }

    /** Pick a range of dates like a brush would (null clears); fires no event. */
    public setRange(from: string | null, to?: string): void {
        if (from === null) {
            this.range = null;
        } else {
            const a = G.dayOf(from), b = G.dayOf(to ?? from);
            this.range = {from: Math.min(a, b), to: Math.max(a, b)};
        }
        this.applyState();
    }

    public getRange(): SkylineRange | null {
        return this.range === null ? null : this.rangeInfo(true);
    }

    /** Keep these dates bright and dim the rest (null clears); a brushed range wins. */
    public highlight(dates: Iterable<string> | null): void {
        this.external = dates === null ? null : new Set(dates);
        this.applyState();
    }

    public override destroy(): void {
        this.tween.stop();
        this.svg.removeEventListener('pointerdown', this.onDown);
        this.svg.removeEventListener('pointermove', this.onMove);
        this.svg.removeEventListener('pointerleave', this.onLeave);
        window.removeEventListener('pointerup', this.onUp);
        super.destroy();
    }

    // ---- building ---------------------------------------------------------------------------------------------

    private build(): void {
        const {cols, rows} = this.grid;
        const {na, nb} = G.extent(cols, rows, this.view);

        this.placed = G.order(this.grid.cells.map((c) => ({...c, ...G.place(c.col, c.row, cols, rows, this.view)})));
        this.boxes = [];
        this.groups = [];
        this.indexOf = new Map(this.placed.map((p, i) => [p.date, i]));
        this.layer.replaceChildren();
        for (const p of this.placed) {
            const g = WidgetDom.svg('g', {class: 'wg-sky-day'});
            g.dataset['day'] = p.date;
            const tile = G.box(p.a, p.b, 0, CalendarSkyline.TILE, CalendarSkyline.S, 0.06);
            g.append(
                WidgetDom.svg('polygon', {class: 'wg-sky-tile-l', points: tile.left.join(' ')}),
                WidgetDom.svg('polygon', {class: 'wg-sky-tile-r', points: tile.right.join(' ')}),
                WidgetDom.svg('polygon', {class: 'wg-sky-tile-t', points: tile.top.join(' ')})
            );
            const faces = [WidgetDom.svg('polygon', {class: 'wg-sky-l'}), WidgetDom.svg('polygon', {class: 'wg-sky-r'}), WidgetDom.svg('polygon', {class: 'wg-sky-t'})];
            g.append(...faces);
            this.layer.appendChild(g);
            this.boxes.push(faces);
            this.groups.push(g);
        }
        this.applyState();

        const top = this.maxHeight * CalendarSkyline.S;
        const b = G.bounds(na, nb, top + CalendarSkyline.TILE, CalendarSkyline.S);
        const pad = 26;
        this.svg.setAttribute('viewBox', `${b.minX - pad} ${b.minY - 4} ${b.maxX - b.minX + pad * 2} ${b.maxY - b.minY + pad + 8}`);
        this.buildLabels();
    }

    private recolor(): void {
        const values = this.placed.map((p) => p.value);
        const height = G.heightScale(values, this.scale, this.cap);
        const level = G.levels(values);
        const cats = [...new Set(this.placed.map((p) => p.category).filter((c): c is string => c !== undefined))];

        this.targets = this.placed.map((p) => height(p.value) * this.maxHeight * CalendarSkyline.S);
        this.colors = this.placed.map((p) => {
            const lv = level(p.value);
            const mode = this.colorMode;
            if (typeof mode === 'function') {
                return mode(p, lv);
            }
            if (mode === 'level') {
                return G.byLevel(this.levelColor, lv);
            }
            if (mode === 'category') {
                const c = p.category;
                const base = c === undefined ? '#8d97ad' : this.categoryColors[c] ?? CalendarSkyline.PALETTE[cats.indexOf(c) % CalendarSkyline.PALETTE.length]!;
                return G.byLevel(base, Math.max(2, lv));
            }
            return G.byLevel(G.seasonColor(p.date, this.hemisphere), lv);
        });
    }

    /** Write box geometry for heights `h` (one per placed cell). */
    private paint(h: readonly number[]): void {
        this.placed.forEach((p, i) => {
            const faces = this.boxes[i];
            if (faces === undefined) {
                return;
            }
            const hi = h[i] ?? 0;
            const visible = hi > 0.05;
            const box: SkylineBox | null = visible ? G.box(p.a, p.b, CalendarSkyline.TILE, CalendarSkyline.TILE + hi, CalendarSkyline.S, 0.12) : null;
            const sh = G.shades(this.colors[i] ?? '#888888');
            const [l, r, t] = faces as [SVGPolygonElement, SVGPolygonElement, SVGPolygonElement];
            for (const [el, pts, fill] of [[l, box?.left, sh.left], [r, box?.right, sh.right], [t, box?.top, sh.top]] as const) {
                if (pts === undefined) {
                    el.setAttribute('points', '');
                } else {
                    el.setAttribute('points', pts.map((n) => Math.round(n * 100) / 100).join(' '));
                    el.setAttribute('fill', fill);
                }
            }
        });
    }

    /** Month names lying on the floor along the front edge, weekday names along the side. */
    private buildLabels(): void {
        this.labelLayer.replaceChildren();
        const {cols, rows} = this.grid;
        if (cols === 0) {
            return;
        }
        // centre of a (possibly outside) cell on the floor
        const C = (col: number, row: number): {a: number; b: number} => {
            const p = G.place(col, row, cols, rows, this.view);
            return {a: p.a + 0.5, b: p.b + 0.5};
        };
        const screenX = (p: {a: number; b: number}): number => p.a - p.b;
        const depth = (p: {a: number; b: number}): number => p.a + p.b;
        /** Unit screen vector of a floor step (da, db), turned to point right (or down when vertical). */
        const axis = (da: number, db: number): [number, number] => {
            let x = (da - db), y = (da + db) / 2;
            if (x < 0 || (x === 0 && y < 0)) {
                x = -x;
                y = -y;
            }
            const n = Math.hypot(x, y);
            return [x / n, y / n];
        };
        const colStep = {a: C(1, 0).a - C(0, 0).a, b: C(1, 0).b - C(0, 0).b};
        const rowStep = {a: C(0, 1).a - C(0, 0).a, b: C(0, 1).b - C(0, 0).b};
        const floorText = (text: string, p: {a: number; b: number}, along: {a: number; b: number}, across: {a: number; b: number},
            anchor: string, size: number): void => {
            const [xx, xy] = axis(along.a, along.b);
            let [yx, yy] = axis(across.a, across.b);
            if (yy < 0) {
                yx = -yx;
                yy = -yy;
            }
            const [x, y] = G.project(p.a, p.b, 0, CalendarSkyline.S);
            const el = WidgetDom.svg('text', {
                class: 'wg-muted wg-sky-label', 'font-size': size, 'text-anchor': anchor, 'dominant-baseline': 'middle',
                transform: `matrix(${xx.toFixed(4)} ${xy.toFixed(4)} ${yx.toFixed(4)} ${yy.toFixed(4)} ${x.toFixed(2)} ${y.toFixed(2)})`
            });
            el.textContent = text;
            this.labelLayer.appendChild(el);
        };

        if (this.showMonths) {
            const row = depth(C(cols / 2, -2)) > depth(C(cols / 2, rows + 1)) ? -2 : rows + 1;
            // columns running to the left on screen: the label ends at the month's first column instead
            const reversed = screenX(C(1, 0)) < screenX(C(0, 0)) || (screenX(C(1, 0)) === screenX(C(0, 0)) && depth(C(1, 0)) < depth(C(0, 0)));
            const fmt = new Intl.DateTimeFormat(this.locale, {month: 'short', timeZone: 'UTC'});
            this.grid.months.forEach((m, i) => {
                const next = this.grid.months[i + 1];
                if (next !== undefined && next.col - m.col < 2) {
                    return;
                }
                const name = fmt.format(new Date(Date.UTC(m.year, m.month, 1)));
                floorText(m.month === 0 || i === 0 ? `${name} ${m.year}` : name, C(m.col, row), colStep, rowStep,
                    reversed ? 'end' : 'start', 6.5);
            });
        }
        if (this.showWeekdays) {
            const col = depth(C(-2, 3)) > depth(C(cols + 1, 3)) ? -2 : cols + 1;
            const fmt = new Intl.DateTimeFormat(this.locale, {weekday: 'short', timeZone: 'UTC'});
            for (const r of [1, 3, 5]) {
                // 1970-01-04 was a Sunday
                const name = fmt.format(new Date(Date.UTC(1970, 0, 4 + this.weekStart + r)));
                floorText(name, C(col, r), colStep, rowStep, 'middle', 5.5);
            }
        }
    }

    // ---- state + events ----------------------------------------------------------------------------------------

    private cellAt(date: string): Placed | null {
        const i = this.indexOf.get(date);

        return i === undefined ? null : this.placed[i] ?? null;
    }

    /** Hover / selection / range / highlight as classes on the day groups. */
    private applyState(): void {
        const r = this.range;
        const ext = this.external;
        const active = r !== null || ext !== null;

        this.root.classList.toggle('wg-sky-dim', active);
        this.placed.forEach((p, i) => {
            const g = this.groups[i];
            if (g === undefined) {
                return;
            }
            const on = r !== null ? p.day >= r.from && p.day <= r.to : ext !== null && ext.has(p.date);
            g.classList.toggle('wg-sky-on', active && on);
            g.classList.toggle('wg-sky-hover', p.date === this.hoverDate);
            g.classList.toggle('wg-sky-sel', p.date === this.selected);
        });
    }

    private rangeInfo(final: boolean): SkylineRange {
        const r = this.range!;
        const cells = this.grid.cells.filter((c) => c.day >= r.from && c.day <= r.to);

        return {from: G.dateOf(r.from), to: G.dateOf(r.to), cells, total: cells.reduce((a, c) => a + c.value, 0), final};
    }

    private cellOf(target: EventTarget | null): Placed | null {
        const g = target instanceof Element ? target.closest<SVGGElement>('.wg-sky-day') : null;
        const date = g?.dataset['day'];

        return date === undefined ? null : this.cellAt(date);
    }

    private showTooltip(c: Placed | null, e: PointerEvent): void {
        if (!this.showTip || c === null) {
            this.tip.style.display = 'none';
            return;
        }
        const date = new Intl.DateTimeFormat(this.locale, {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'})
            .format(new Date(c.day * 86400000));
        const lines = (this.format !== undefined ? this.format(c) : String(c.value)).split('\n');
        if (this.format === undefined && c.category !== undefined) {
            lines.push(c.category);
        }
        if (this.format === undefined && c.title !== undefined) {
            lines.push(c.title);
        }
        const head = document.createElement('b');
        head.textContent = date;
        this.tip.replaceChildren(head, ...lines.map((t) => {
            const d = document.createElement('div');
            d.textContent = t;
            return d;
        }));
        this.tip.style.display = 'block';
        const box = this.root.getBoundingClientRect();
        const w = this.tip.offsetWidth, h = this.tip.offsetHeight;
        let x = e.clientX - box.left + 14, y = e.clientY - box.top - h - 10;
        if (x + w > box.width - 4) {
            x = e.clientX - box.left - w - 14;
        }
        if (y < 0) {
            y = e.clientY - box.top + 16;
        }
        this.tip.style.left = `${Math.max(0, x)}px`;
        this.tip.style.top = `${y}px`;
    }

    private readonly onDown = (e: PointerEvent): void => {
        if (e.button !== 0) {
            return;
        }
        const c = this.cellOf(e.target);
        if (c === null) {
            // background: clear the selection and the range
            this.brush = null;
            const had = this.range !== null || this.selected !== null;
            if (this.range !== null) {
                this.range = null;
                this.events.emit('rangeChange', null);
            }
            if (this.selected !== null) {
                this.selected = null;
                this.events.emit('daySelect', null);
            }
            if (had) {
                this.applyState();
            }
            return;
        }
        e.preventDefault();
        this.brush = {anchor: c.day, moved: false};
    };

    private readonly onMove = (e: PointerEvent): void => {
        const c = this.cellOf(e.target);
        const date = c?.date ?? null;

        if (date !== this.hoverDate) {
            this.hoverDate = date;
            this.events.emit('dayHover', c);
            this.applyState();
        }
        this.showTooltip(c, e);
        const b = this.brush;
        if (b !== null && this.brushOn && c !== null && (b.moved || c.day !== b.anchor)) {
            const from = Math.min(b.anchor, c.day), to = Math.max(b.anchor, c.day);
            if (!b.moved || this.range === null || this.range.from !== from || this.range.to !== to) {
                b.moved = true;
                this.range = {from, to};
                this.applyState();
                this.events.emit('rangeChange', this.rangeInfo(false));
            }
        }
    };

    private readonly onLeave = (): void => {
        this.tip.style.display = 'none';
        if (this.hoverDate !== null) {
            this.hoverDate = null;
            this.events.emit('dayHover', null);
            this.applyState();
        }
    };

    private readonly onUp = (e: PointerEvent): void => {
        const b = this.brush;
        this.brush = null;
        if (b === null) {
            return;
        }
        if (b.moved && this.range !== null) {
            this.events.emit('rangeChange', this.rangeInfo(true));
            return;
        }
        // a click on a day: select it (again = deselect), a brushed range goes away
        const c = this.cellAt(G.dateOf(b.anchor));
        if (c === null) {
            return;
        }
        if (this.range !== null) {
            this.range = null;
            this.events.emit('rangeChange', null);
        }
        this.selected = this.selected === c.date ? null : c.date;
        this.applyState();
        this.events.emit('dayClick', {day: c, originalEvent: e});
        this.events.emit('daySelect', this.selected === null ? null : c);
    };

}
