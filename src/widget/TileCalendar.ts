import { CalendarGeometry } from './CalendarGeometry';
import { paletteColor, svgEl, Widget, WidgetOptions } from './WidgetBase';

/** A kind of day (working day, holiday …) with its tile colour. */
export interface TileCategory {
    id: string;
    label: string;
    /** Any CSS colour (default: the palette). */
    color?: string;
}

export interface TileCalendarOptions extends WidgetOptions {
    /** First month shown (default: the current one). */
    start?: {year: number; month: number} | Date;
    /** Number of months (default 3). */
    months?: number;
    /** Months per row (default: all in one row). */
    columns?: number;
    /** 1 = Monday (default), 0 = Sunday. */
    weekStart?: number;
    categories?: TileCategory[];
    /** Category of a day: a function, or a map 'YYYY-MM-DD' → category id. */
    days?: ((date: Date) => string | null | undefined) | Record<string, string>;
    /** Text beside a tile, by 'YYYY-MM-DD' (e.g. a deadline). */
    labels?: Record<string, string>;
    /** Days before / after are left out (e.g. only the days still to come). */
    from?: Date;
    to?: Date;
    /** Days without a category: a grey tile (default) or left out. */
    empty?: 'track' | 'hide';
    /** Legend over the months, optionally with day counts (default true, counts false). */
    legend?: boolean;
    counts?: boolean;
    /** BCP 47 locale for month and weekday names (default the browser's). */
    locale?: string;
}

export interface TileCalendarEvents extends Record<string, unknown> {
    dayClick: {date: Date; category: string | null; originalEvent: MouseEvent};
    dayHover: {date: Date; category: string | null} | null;
}

const CELL = 22;
const GAP = 2;
const MONTH_GAP = 18;
const TITLE = 24;
const FOOT = 18;

/**
 * Tile calendar: months side by side, every day a square tile coloured by its
 * category (working day, weekend, holiday …), weekday letters under each
 * month, optional text beside a tile, a legend with day counts. Built for
 * "how many X days are left" pictures. SVG, zero dependencies.
 */
export class TileCalendar extends Widget<TileCalendarEvents> {

    private start: {year: number; month: number};
    private months: number;
    private readonly columns: number | undefined;
    private readonly weekStart: number;
    private categories: TileCategory[];
    private days: TileCalendarOptions['days'];
    private labels: Record<string, string>;
    private from: Date | null;
    private to: Date | null;
    private readonly empty: 'track' | 'hide';
    private readonly counts: boolean;
    private readonly locale: string | undefined;
    private readonly legendBox: HTMLDivElement | null;
    private readonly svg: SVGSVGElement;
    private readonly cells = new Map<string, {date: Date; category: string | null}>();

    public constructor(container: HTMLElement, options: TileCalendarOptions = {}) {
        super(container, 'wg-tiles', options);

        const s = options.start ?? new Date();

        this.start = s instanceof Date ? {year: s.getFullYear(), month: s.getMonth()} : s;
        this.months = options.months ?? 3;
        this.columns = options.columns;
        this.weekStart = options.weekStart ?? 1;
        this.categories = options.categories ?? [];
        this.days = options.days;
        this.labels = options.labels ?? {};
        this.from = options.from ?? null;
        this.to = options.to ?? null;
        this.empty = options.empty ?? 'track';
        this.counts = options.counts ?? false;
        this.locale = options.locale;

        if (options.legend ?? true) {
            this.legendBox = document.createElement('div');
            this.legendBox.className = 'wg-tiles-legend';
            this.root.appendChild(this.legendBox);
        } else {
            this.legendBox = null;
        }
        this.svg = svgEl('svg', {class: 'wg-svg', role: 'img'});
        this.root.appendChild(this.svg);
        this.svg.addEventListener('click', this.onClick);
        this.svg.addEventListener('pointerover', this.onOver);
        this.svg.addEventListener('pointerleave', this.onLeave);
        this.render();
    }

    /** 'YYYY-MM-DD' of a local date. */
    public static key(d: Date): string {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    public setDays(days: TileCalendarOptions['days'], labels = this.labels): void {
        this.days = days;
        this.labels = labels;
        this.render();
    }

    public setCategories(categories: TileCategory[]): void {
        this.categories = categories;
        this.render();
    }

    public setRange(from: Date | null, to: Date | null): void {
        this.from = from;
        this.to = to;
        this.render();
    }

    public setMonths(start: {year: number; month: number}, months = this.months): void {
        this.start = start;
        this.months = months;
        this.render();
    }

    /** Days per category id among the shown days. */
    public count(): Map<string, number> {
        const out = new Map<string, number>();

        for (const c of this.cells.values()) {
            if (c.category !== null) {
                out.set(c.category, (out.get(c.category) ?? 0) + 1);
            }
        }

        return out;
    }

    public override destroy(): void {
        this.svg.removeEventListener('click', this.onClick);
        this.svg.removeEventListener('pointerover', this.onOver);
        this.svg.removeEventListener('pointerleave', this.onLeave);
        super.destroy();
    }

    private categoryOf(date: Date): string | null {
        const d = this.days;

        if (d === undefined) {
            return null;
        }

        const v = typeof d === 'function' ? d(date) : d[TileCalendar.key(date)];

        return v ?? null;
    }

    private color(id: string | null): string | null {
        if (id === null) {
            return null;
        }

        const i = this.categories.findIndex((c) => c.id === id);

        return i < 0 ? null : this.categories[i]!.color ?? paletteColor(i);
    }

    private render(): void {
        const cols = Math.max(1, Math.min(this.months, this.columns ?? this.months));
        const monthW = 7 * CELL + 6 * GAP;
        const grids = Array.from({length: this.months}, (_, i) => {
            const m = CalendarGeometry.shift(this.start.year, this.start.month, i);
            return {...m, cells: CalendarGeometry.grid(m.year, m.month, this.weekStart)};
        });
        const rowsPer = Math.max(...grids.map((g) => g.cells[g.cells.length - 1]!.row + 1));
        const monthH = TITLE + rowsPer * (CELL + GAP) + FOOT;
        const lines = Math.ceil(this.months / cols);
        const width = cols * monthW + (cols - 1) * MONTH_GAP;
        const height = lines * monthH + (lines - 1) * 10;
        const monthName = new Intl.DateTimeFormat(this.locale, {month: 'long'});
        const dayName = new Intl.DateTimeFormat(this.locale, {weekday: 'narrow'});
        const from = this.from === null ? null : CalendarGeometry.day(this.from);
        const to = this.to === null ? null : CalendarGeometry.day(this.to);
        const labelled: {x: number; y: number; text: string}[] = [];

        this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        this.svg.replaceChildren();
        this.cells.clear();

        grids.forEach((g, gi) => {
            const ox = (gi % cols) * (monthW + MONTH_GAP);
            const oy = Math.floor(gi / cols) * (monthH + 10);
            const title = svgEl('text', {class: 'wg-tiles-month', x: ox, y: oy + 15});

            title.textContent = monthName.format(new Date(g.year, g.month, 1));
            this.svg.appendChild(title);

            for (const cell of g.cells) {
                if (!cell.inMonth) {
                    continue;
                }
                if ((from !== null && CalendarGeometry.daysBetween(from, cell.date) < 0)
                    || (to !== null && CalendarGeometry.daysBetween(cell.date, to) < 0)) {
                    continue;
                }

                const category = this.categoryOf(cell.date);
                const color = this.color(category);

                if (color === null && this.empty === 'hide') {
                    continue;
                }

                const key = TileCalendar.key(cell.date);
                const x = ox + cell.col * (CELL + GAP);
                const y = oy + TITLE + cell.row * (CELL + GAP);
                const rect = svgEl('rect', {class: 'wg-tile', x, y, width: CELL, height: CELL, rx: 1.5});
                const tip = svgEl('title');
                const name = this.categories.find((c) => c.id === category)?.label;

                rect.style.fill = color ?? 'var(--wg-track)';
                rect.dataset['day'] = key;
                tip.textContent = cell.date.toLocaleDateString(this.locale, {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'})
                    + (name !== undefined ? ` — ${name}` : '');
                rect.appendChild(tip);
                this.svg.appendChild(rect);
                this.cells.set(key, {date: cell.date, category});

                const text = this.labels[key];

                if (text !== undefined) {
                    labelled.push({x: x + CELL + 5, y: y + CELL / 2, text});
                }
            }

            CalendarGeometry.weekdays(this.weekStart).forEach((wd, col) => {
                const t = svgEl('text', {
                    class: 'wg-tiles-weekday', x: ox + col * (CELL + GAP) + CELL / 2, y: oy + monthH - 4
                });

                // 2027-02-07 is a Sunday: +wd gives that weekday
                t.textContent = dayName.format(new Date(2027, 1, 7 + wd));
                this.svg.appendChild(t);
            });
        });

        // labels last, over neighbouring tiles
        for (const l of labelled) {
            const t = svgEl('text', {class: 'wg-tiles-label', x: l.x, y: l.y});

            t.textContent = l.text;
            this.svg.appendChild(t);
        }
        this.buildLegend();
    }

    private buildLegend(): void {
        const box = this.legendBox;

        if (box === null) {
            return;
        }

        const counts = this.count();

        box.replaceChildren();
        this.categories.forEach((c, i) => {
            const item = document.createElement('span');
            const sw = document.createElement('span');

            item.className = 'wg-tiles-item';
            sw.className = 'wg-tiles-swatch';
            sw.style.background = c.color ?? paletteColor(i);
            item.append(sw, document.createTextNode(this.counts ? `${c.label} (${counts.get(c.id) ?? 0})` : c.label));
            box.appendChild(item);
        });
    }

    private dayAt(target: EventTarget | null): {date: Date; category: string | null} | null {
        const el = target instanceof Element ? target.closest<SVGRectElement>('.wg-tile') : null;
        const key = el?.dataset['day'];

        return key === undefined ? null : this.cells.get(key) ?? null;
    }

    private readonly onClick = (e: MouseEvent): void => {
        const d = this.dayAt(e.target);

        if (d !== null) {
            this.events.emit('dayClick', {...d, originalEvent: e});
        }
    };

    private readonly onOver = (e: PointerEvent): void => {
        this.events.emit('dayHover', this.dayAt(e.target));
    };

    private readonly onLeave = (): void => {
        this.events.emit('dayHover', null);
    };

}
