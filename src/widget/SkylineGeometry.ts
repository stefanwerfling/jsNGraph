import { Color } from '../util/Color';

/** One day of data. */
export interface SkylineDay {
    /** 'YYYY-MM-DD'. */
    date: string;
    value: number;
    /** For `colorMode: 'category'`, e.g. the kind of work that led that day. */
    category?: string;
    /** Extra tooltip text. */
    title?: string;
}

/** A day placed on the calendar grid (every date in the range, value 0 when missing). */
export interface SkylineCell {
    date: string;
    /** Days since 1970-01-01 (UTC). */
    day: number;
    /** Week column, 0 = the first week. */
    col: number;
    /** Weekday row, 0 = `weekStart`. */
    row: number;
    value: number;
    category?: string;
    title?: string;
}

export interface SkylineGrid {
    cells: SkylineCell[];
    cols: number;
    rows: number;
    /** Column where each month starts (its 1st, or the range start). */
    months: Array<{year: number; month: number; col: number}>;
}

export type SkylineScale = 'linear' | 'sqrt' | 'log';
/** Which corner the calendar is seen from: 0 = first week far left, then turning by 90°. */
export type SkylineView = 0 | 1 | 2 | 3;

/** A box in screen units: three faces as flat point lists [x, y, …]. */
export interface SkylineBox {
    top: number[];
    left: number[];
    right: number[];
}

const DAY_MS = 86400000;
/** Season anchors (day of year in the northern hemisphere → colour): mid-winter, -spring, -summer, -autumn. */
const SEASONS: ReadonlyArray<[number, string]> = [[15, '#9aa1ad'], [105, '#d278b6'], [196, '#5fae4c'], [288, '#e8b400']];

/**
 * Pure geometry of the calendar skyline: dates → week columns and weekday
 * rows, the grid turned for one of four views, the 2:1 isometric projection
 * of a day's box (x = (a − b)·S, y = (a + b)·S/2 − h), drawing order, height
 * scales and day colours (season, level).
 */
export class SkylineGeometry {

    /** Days since 1970-01-01 of a 'YYYY-MM-DD' (UTC, so no daylight-saving gaps). */
    public static dayOf(date: string): number {
        const [y, m, d] = date.split('-').map(Number);

        return Math.round(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / DAY_MS);
    }

    public static dateOf(day: number): string {
        return new Date(day * DAY_MS).toISOString().slice(0, 10);
    }

    /** 0 = Sunday … 6 = Saturday. */
    public static weekday(day: number): number {
        // 1970-01-01 was a Thursday
        return ((day % 7) + 11) % 7;
    }

    /**
     * Every date from `from` to `to` (default: the 52 weeks + days up to the
     * last data day) on a grid of week columns × 7 weekday rows.
     */
    public static grid(days: ReadonlyArray<SkylineDay>, options: {from?: string; to?: string; weekStart?: number} = {}): SkylineGrid {
        const byDay = new Map<number, SkylineDay>();
        for (const d of days) {
            byDay.set(SkylineGeometry.dayOf(d.date), d);
        }
        const known = [...byDay.keys()];
        const last = options.to !== undefined ? SkylineGeometry.dayOf(options.to)
            : known.length > 0 ? Math.max(...known) : Math.floor(Date.now() / DAY_MS);
        const first = options.from !== undefined ? SkylineGeometry.dayOf(options.from) : last - 364;
        const ws = options.weekStart ?? 0;
        const offset = (SkylineGeometry.weekday(first) - ws + 7) % 7;
        const cells: SkylineCell[] = [];
        const months: SkylineGrid['months'] = [];

        for (let day = first; day <= last; day++) {
            const i = day - first + offset;
            const src = byDay.get(day);
            const date = SkylineGeometry.dateOf(day);
            const cell: SkylineCell = {date, day, col: Math.floor(i / 7), row: i % 7, value: Math.max(0, src?.value ?? 0)};
            if (src?.category !== undefined) {
                cell.category = src.category;
            }
            if (src?.title !== undefined) {
                cell.title = src.title;
            }
            cells.push(cell);
            if (day === first || date.endsWith('-01')) {
                months.push({year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) - 1, col: cell.col});
            }
        }

        return {cells, cols: cells.length === 0 ? 0 : cells[cells.length - 1]!.col + 1, rows: 7, months};
    }

    /** Floor position (a, b) of a grid cell seen from `view`: the rectangle turned by 90° steps. */
    public static place(col: number, row: number, cols: number, rows: number, view: SkylineView = 0): {a: number; b: number} {
        switch (view) {
            case 1:
                return {a: rows - 1 - row, b: col};
            case 2:
                return {a: cols - 1 - col, b: rows - 1 - row};
            case 3:
                return {a: row, b: cols - 1 - col};
            default:
                return {a: col, b: row};
        }
    }

    /** Size of the turned floor in cells. */
    public static extent(cols: number, rows: number, view: SkylineView = 0): {na: number; nb: number} {
        return view % 2 === 0 ? {na: cols, nb: rows} : {na: rows, nb: cols};
    }

    /** Back to front: farther cells (smaller a + b) first. */
    public static order<T extends {a: number; b: number}>(cells: ReadonlyArray<T>): T[] {
        return [...cells].sort((p, q) => (p.a + p.b) - (q.a + q.b) || (p.a - p.b) - (q.a - q.b));
    }

    /** Screen point of floor point (a, b) lifted by h, for cell size S. */
    public static project(a: number, b: number, h: number, S: number): [number, number] {
        return [(a - b) * S, (a + b) * S / 2 - h];
    }

    /**
     * The visible faces of a box on cell (a, b) from height h0 to h1, inset by
     * `gap` (cells) on each side: top, left (facing +b) and right (facing +a).
     */
    public static box(a: number, b: number, h0: number, h1: number, S: number, gap = 0.08): SkylineBox {
        const a0 = a + gap, a1 = a + 1 - gap, b0 = b + gap, b1 = b + 1 - gap;
        const P = (u: number, v: number, h: number): number[] => SkylineGeometry.project(u, v, h, S);

        return {
            top: [...P(a0, b0, h1), ...P(a1, b0, h1), ...P(a1, b1, h1), ...P(a0, b1, h1)],
            left: [...P(a0, b1, h0), ...P(a1, b1, h0), ...P(a1, b1, h1), ...P(a0, b1, h1)],
            right: [...P(a1, b1, h0), ...P(a1, b0, h0), ...P(a1, b0, h1), ...P(a1, b1, h1)]
        };
    }

    /** Screen box of the whole floor (heights up to `maxH`). */
    public static bounds(na: number, nb: number, maxH: number, S: number): {minX: number; minY: number; maxX: number; maxY: number} {
        return {minX: -nb * S, maxX: na * S, minY: -maxH, maxY: (na + nb) * S / 2};
    }

    /**
     * Height of a value as 0…1: `linear`, `sqrt` or `log` (log(1 + v)), against
     * the `cap` quantile of the non-zero values (default 0.98), so a single
     * spike does not flatten every other day; values above it reach 1.
     */
    public static heightScale(values: ReadonlyArray<number>, scale: SkylineScale = 'linear', cap = 0.98): (v: number) => number {
        const top = Math.max(1e-9, SkylineGeometry.quantile(values.filter((v) => v > 0), cap));
        const f = scale === 'sqrt' ? Math.sqrt : scale === 'log' ? (v: number): number => Math.log1p(v) : (v: number): number => v;
        const m = f(top);

        return (v: number): number => v <= 0 ? 0 : Math.min(1, f(v) / m);
    }

    /** Quantile (0…1) of a list, linear between neighbours; 0 for an empty list. */
    public static quantile(values: ReadonlyArray<number>, q: number): number {
        if (values.length === 0) {
            return 0;
        }
        const s = [...values].sort((x, y) => x - y);
        const pos = Math.max(0, Math.min(1, q)) * (s.length - 1);
        const lo = Math.floor(pos);

        return s[lo]! + (s[Math.min(s.length - 1, lo + 1)]! - s[lo]!) * (pos - lo);
    }

    /** Level 0…4 of a value: 0 = none, 1…4 = quartiles of the non-zero values. */
    public static levels(values: ReadonlyArray<number>): (v: number) => number {
        const nz = values.filter((v) => v > 0);
        const q = [0.25, 0.5, 0.75].map((p) => SkylineGeometry.quantile(nz, p));

        return (v: number): number => v <= 0 ? 0 : 1 + q.filter((t) => v > t).length;
    }

    /** Day of the year (0 = 1 January). */
    public static dayOfYear(date: string): number {
        return SkylineGeometry.dayOf(date) - SkylineGeometry.dayOf(`${date.slice(0, 4)}-01-01`);
    }

    /** Season colour of a date, blended between the four mid-season anchors; the south has its seasons shifted by half a year. */
    public static seasonColor(date: string, hemisphere: 'north' | 'south' = 'north'): string {
        let d = SkylineGeometry.dayOfYear(date);
        if (hemisphere === 'south') {
            d = (d + 182) % 365;
        }
        for (let i = 0; i < SEASONS.length; i++) {
            const [d0, c0] = SEASONS[i]!;
            const [d1raw, c1] = SEASONS[(i + 1) % SEASONS.length]!;
            const d1 = d1raw <= d0 ? d1raw + 365 : d1raw;
            const x = d < d0 ? d + 365 : d;
            if (x >= d0 && x < d1) {
                // hold the season's colour for most of it, blend only near the edges
                const t = (x - d0) / (d1 - d0);
                return Color.lerp(c0, c1, Math.max(0, Math.min(1, (t - 0.35) / 0.3)));
            }
        }

        return SEASONS[0]![1];
    }

    /** A day's colour by its level: pale for level 1, the full colour for level 4. */
    public static byLevel(color: string, level: number): string {
        return Color.lerp(color, '#ffffff', [0.75, 0.62, 0.4, 0.18, 0][Math.max(0, Math.min(4, level))] ?? 0);
    }

    /** Face shades of a box colour: top light, left as is, right dark. */
    public static shades(color: string): {top: string; left: string; right: string} {
        return {top: Color.lerp(color, '#ffffff', 0.28), left: color, right: Color.lerp(color, '#000000', 0.2)};
    }

}
