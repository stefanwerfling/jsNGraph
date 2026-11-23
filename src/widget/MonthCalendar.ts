import { CalendarCell, CalendarGeometry } from './CalendarGeometry';
import { svgEl, Widget, WidgetOptions } from './WidgetBase';

/** A marked day (a dot under its number). */
export interface CalendarMark {
    date: Date;
    color?: string;
    label?: string;
}

export interface MonthCalendarOptions extends WidgetOptions {
    /** Shown month (default: the current one); month is 0-based. */
    year?: number;
    month?: number;
    /** 0 = Sunday, 1 = Monday (default 1). */
    weekStart?: number;
    /** Locale(s) for the weekday and month names (default: the browser's). */
    locale?: string | string[];
    /** Highlighted range (a pill), e.g. a booking or a sprint. */
    range?: {start: Date; end: Date} | null;
    marks?: CalendarMark[];
    /** Ring around today (default: the real today; null hides it). */
    today?: Date | null;
    /** Days drawn in the accent colour: 'sunday' (default), 'weekend' or 'none'. */
    weekend?: 'sunday' | 'weekend' | 'none';
    /** Show the neighbouring months' days, dimmed (default false). */
    outside?: boolean;
    /** Month title with ‹ › buttons (default true). */
    header?: boolean;
    /** What a click selects: 'range' (default: first click starts, second ends), 'day' or 'none'. */
    select?: 'range' | 'day' | 'none';
}

export interface MonthCalendarEvents extends Record<string, unknown> {
    dayClick: {date: Date; originalEvent: MouseEvent};
    rangeChange: {start: Date; end: Date} | null;
    monthChange: {year: number; month: number};
}

const CELL_W = 40;
const CELL_H = 30;
const HEAD = 24;
const TITLE = 30;
const W = CELL_W * 7;

/**
 * A month as a grid of days with a highlighted range (one pill per week row),
 * marked days, today and coloured weekend days. Built-in range / day
 * selection and month navigation. SVG, zero dependencies.
 */
export class MonthCalendar extends Widget<MonthCalendarEvents> {

    private year: number;
    private month: number;
    private readonly weekStart: number;
    private readonly locale: string | string[] | undefined;
    private range: {start: Date; end: Date} | null;
    private marks: CalendarMark[];
    private today: Date | null;
    private readonly weekend: 'sunday' | 'weekend' | 'none';
    private readonly outside: boolean;
    private readonly header: boolean;
    private readonly select: 'range' | 'day' | 'none';
    /** First click of a range selection, waiting for the second. */
    private anchor: Date | null = null;
    private cells: CalendarCell[] = [];

    public constructor(container: HTMLElement, options: MonthCalendarOptions = {}) {
        super(container, 'wg-calendar', options);

        const now = new Date();

        this.year = options.year ?? now.getFullYear();
        this.month = options.month ?? now.getMonth();
        this.weekStart = ((options.weekStart ?? 1) % 7 + 7) % 7;
        this.locale = options.locale;
        this.range = options.range ?? null;
        this.marks = options.marks ?? [];
        this.today = options.today === undefined ? now : options.today;
        this.weekend = options.weekend ?? 'sunday';
        this.outside = options.outside ?? false;
        this.header = options.header ?? true;
        this.select = options.select ?? 'range';
        if (this.select !== 'none') {
            this.root.classList.add('wg-cal-select');
        }
        this.root.addEventListener('click', this.onClick);
        this.render();
    }

    public getMonth(): {year: number; month: number} {
        return {year: this.year, month: this.month};
    }

    public setMonth(year: number, month: number): void {
        const m = CalendarGeometry.shift(year, month, 0);

        this.year = m.year;
        this.month = m.month;
        this.render();
        this.events.emit('monthChange', {...m});
    }

    /** Move by `delta` months (‹ = -1, › = +1). */
    public shiftMonth(delta: number): void {
        const m = CalendarGeometry.shift(this.year, this.month, delta);
        this.setMonth(m.year, m.month);
    }

    public getRange(): {start: Date; end: Date} | null {
        return this.range === null ? null : {...this.range};
    }

    /** Set (or clear) the highlighted range; does not emit `rangeChange`. */
    public setRange(range: {start: Date; end: Date} | null): void {
        this.range = range === null ? null : MonthCalendar.ordered(range.start, range.end);
        this.anchor = null;
        this.render();
    }

    public setMarks(marks: readonly CalendarMark[]): void {
        this.marks = [...marks];
        this.render();
    }

    public setToday(today: Date | null): void {
        this.today = today;
        this.render();
    }

    public override destroy(): void {
        this.root.removeEventListener('click', this.onClick);
        super.destroy();
    }

    /** Draw again (setters call it). */
    public render(): void {
        const top = this.header ? TITLE : 0;

        this.cells = CalendarGeometry.grid(this.year, this.month, this.weekStart);

        const rows = this.cells.length / 7;
        const h = top + HEAD + (rows * CELL_H);
        const svg = svgEl('svg', {viewBox: `0 0 ${W} ${h}`, class: 'wg-svg', role: 'grid'});
        const monthName = new Date(this.year, this.month, 1).toLocaleDateString(this.locale, {month: 'long', year: 'numeric'});

        svg.setAttribute('aria-label', monthName);

        if (this.header) {
            const title = svgEl('text', {x: W / 2, y: 18, class: 'wg-cal-title', 'text-anchor': 'middle'});
            title.textContent = monthName;
            const prev = svgEl('text', {x: 14, y: 14, class: 'wg-cal-nav', 'data-wg-nav': -1, role: 'button'});
            const next = svgEl('text', {x: W - 14, y: 14, class: 'wg-cal-nav', 'data-wg-nav': 1, role: 'button'});
            prev.textContent = '‹';
            next.textContent = '›';
            svg.append(title, prev, next);
        }

        // weekday heads
        CalendarGeometry.weekdays(this.weekStart).forEach((wd, col) => {
            const name = new Date(2023, 0, 1 + wd).toLocaleDateString(this.locale, {weekday: 'short'}).replace('.', '').slice(0, 2);
            const t = svgEl('text', {x: (col + 0.5) * CELL_W, y: top + 14, class: `wg-cal-head${this.isAccent(wd) ? ' wg-cal-weekend' : ''}`});
            t.textContent = name;
            svg.appendChild(t);
        });

        const y0 = top + HEAD;
        const shown = this.range ?? (this.anchor !== null ? {start: this.anchor, end: this.anchor} : null);
        const inRange = new Set<number>();

        // range pills
        if (shown !== null) {
            const visible = this.cells.filter((c) => c.inMonth || this.outside);

            for (const run of CalendarGeometry.runs(visible, shown.start, shown.end)) {
                const pad = 3;
                const x = (run.from * CELL_W) + (run.startCap ? pad : 0);
                const w = ((run.to - run.from + 1) * CELL_W) - (run.startCap ? pad : 0) - (run.endCap ? pad : 0);
                const y = y0 + (run.row * CELL_H) + 3;
                const hh = CELL_H - 6;

                svg.appendChild(svgEl('path', {d: MonthCalendar.pill(x, y, w, hh, run.startCap, run.endCap), class: 'wg-cal-range'}));
                for (let c = run.from; c <= run.to; c++) {
                    inRange.add((run.row * 7) + c);
                }
            }
        }

        this.cells.forEach((cell, i) => {
            if (!cell.inMonth && !this.outside) {
                return;
            }

            const cx = (cell.col + 0.5) * CELL_W;
            const cy = y0 + ((cell.row + 0.5) * CELL_H);
            const g = svgEl('g', {'data-wg-day': i, role: 'gridcell'});
            const classes = ['wg-cal-day'];

            if (!cell.inMonth) {
                classes.push('wg-cal-out');
            }
            if (inRange.has(i)) {
                classes.push('wg-cal-in');
            } else if (this.isAccent(cell.weekday)) {
                classes.push('wg-cal-weekend');
            }

            g.appendChild(svgEl('rect', {x: cx - 15, y: cy - 12, width: 30, height: 24, rx: 12, class: 'wg-cal-cell'}));
            if (this.today !== null && CalendarGeometry.sameDay(cell.date, this.today)) {
                g.appendChild(svgEl('circle', {cx, cy, r: 12, class: 'wg-cal-today'}));
            }

            const t = svgEl('text', {x: cx, y: cy, class: classes.join(' ')});
            t.textContent = String(cell.date.getDate()).padStart(2, '0');
            g.appendChild(t);

            const marks = this.marks.filter((m) => CalendarGeometry.sameDay(m.date, cell.date));
            marks.slice(0, 3).forEach((m, k) => {
                const dot = svgEl('circle', {cx: cx + ((k - ((Math.min(3, marks.length) - 1) / 2)) * 5), cy: cy + 10, r: 1.8});
                dot.style.fill = m.color ?? 'var(--wg-c1)';
                g.appendChild(dot);
            });

            const title = svgEl('title');
            title.textContent = cell.date.toLocaleDateString(this.locale, {weekday: 'long', day: 'numeric', month: 'long'}) +
                marks.filter((m) => m.label !== undefined).map((m) => ` · ${m.label}`).join('');
            g.appendChild(title);
            svg.appendChild(g);
        });

        this.root.replaceChildren(svg);
    }

    private isAccent(weekday: number): boolean {
        return this.weekend === 'weekend' ? weekday === 0 || weekday === 6 : this.weekend === 'sunday' && weekday === 0;
    }

    private static ordered(a: Date, b: Date): {start: Date; end: Date} {
        const x = CalendarGeometry.day(a);
        const y = CalendarGeometry.day(b);

        return CalendarGeometry.daysBetween(x, y) >= 0 ? {start: x, end: y} : {start: y, end: x};
    }

    /** Rectangle with round left and/or right ends. */
    private static pill(x: number, y: number, w: number, h: number, left: boolean, right: boolean): string {
        const r = h / 2;
        const parts = [`M${x + (left ? r : 0)} ${y}`, `H${x + w - (right ? r : 0)}`];

        parts.push(right ? `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` : `V${y + h}`);
        parts.push(`H${x + (left ? r : 0)}`);
        parts.push(left ? `A${r} ${r} 0 0 1 ${x + r} ${y}` : `V${y}`);

        return `${parts.join('')}Z`;
    }

    private readonly onClick = (e: MouseEvent): void => {
        const target = e.target instanceof Element ? e.target : null;
        const nav = target?.closest('[data-wg-nav]');

        if (nav) {
            this.shiftMonth(Number(nav.getAttribute('data-wg-nav')));
            return;
        }

        const g = target?.closest('[data-wg-day]');
        const cell = g ? this.cells[Number(g.getAttribute('data-wg-day'))] : undefined;

        if (cell === undefined) {
            return;
        }

        this.events.emit('dayClick', {date: cell.date, originalEvent: e});

        if (this.select === 'day') {
            this.range = {start: cell.date, end: cell.date};
            this.render();
            this.events.emit('rangeChange', this.getRange());
        } else if (this.select === 'range') {
            if (this.anchor === null) {
                this.anchor = cell.date;
                this.range = null;
                this.render();
            } else {
                this.range = MonthCalendar.ordered(this.anchor, cell.date);
                this.anchor = null;
                this.render();
                this.events.emit('rangeChange', this.getRange());
            }
        }
    };

}
