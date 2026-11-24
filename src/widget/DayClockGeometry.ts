/** State of an item on the day clock relative to "now". */
export type DayClockState = 'past' | 'running' | 'upcoming';

/** One item (appointment, shift, booking …) on the day clock. */
export interface DayClockItem {
    start: Date;
    end: Date;
    label: string;
    /** Passed back in events; not drawn. */
    id?: string;
    /** Own colour (any CSS colour) instead of the state colour. */
    color?: string;
}

/** An item placed on the dial (see {@link DayClockGeometry.place}). */
export interface DayClockPlaced {
    item: DayClockItem;
    /** 0 = outermost ring. */
    lane: number;
    /** Minutes since the day's midnight, clamped to the day. */
    from: number;
    to: number;
    state: DayClockState;
}

/**
 * Pure geometry of the 24 h day clock: angles (00:00 top, clockwise), points,
 * SVG arc paths and the ring (lane) layout of overlapping items. No DOM.
 */
export class DayClockGeometry {

    /** Minutes in a day — the dial's full turn. */
    public static readonly DAY_MINUTES = 1440;

    /** Round to 0.01 for compact paths. */
    private static f(n: number): string {
        return String(Math.round(n * 100) / 100);
    }

    /** State of an item at a point in time. */
    public static state(item: DayClockItem, now: Date): DayClockState {
        if (item.end.getTime() <= now.getTime()) {
            return 'past';
        }

        return item.start.getTime() <= now.getTime() ? 'running' : 'upcoming';
    }

    /** Local midnight at the start of `date`'s day. */
    public static dayStart(date: Date): Date {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    /** Minutes from `dayStart` to `date`, clamped to the day. */
    public static minutes(date: Date, dayStart: Date): number {
        return Math.min(DayClockGeometry.DAY_MINUTES, Math.max(0, (date.getTime() - dayStart.getTime()) / 60000));
    }

    /** Angle in radians, 0 at the top, clockwise. */
    public static angle(minutes: number): number {
        return (minutes / DayClockGeometry.DAY_MINUTES) * Math.PI * 2;
    }

    /** Point on a circle of radius `r` around (`c`, `c`). */
    public static point(minutes: number, r: number, c: number): [number, number] {
        const a = DayClockGeometry.angle(minutes);

        return [c + (r * Math.sin(a)), c - (r * Math.cos(a))];
    }

    /**
     * SVG path of a circular arc (an open stroke) from `from` to `to` minutes.
     * A full day is drawn as two halves, since one SVG arc cannot close a circle.
     */
    public static arcPath(from: number, to: number, r: number, c: number): string {
        const f = DayClockGeometry.f;
        const span = Math.max(0, Math.min(DayClockGeometry.DAY_MINUTES, to - from));

        if (span >= DayClockGeometry.DAY_MINUTES - 0.01) {
            const [x0, y0] = DayClockGeometry.point(from, r, c);
            const [x1, y1] = DayClockGeometry.point(from + (DayClockGeometry.DAY_MINUTES / 2), r, c);

            return `M${f(x0)} ${f(y0)}A${f(r)} ${f(r)} 0 1 1 ${f(x1)} ${f(y1)}A${f(r)} ${f(r)} 0 1 1 ${f(x0)} ${f(y0)}`;
        }

        const [x0, y0] = DayClockGeometry.point(from, r, c);
        const [x1, y1] = DayClockGeometry.point(from + span, r, c);
        const large = span > DayClockGeometry.DAY_MINUTES / 2 ? 1 : 0;

        return `M${f(x0)} ${f(y0)}A${f(r)} ${f(r)} 0 ${large} 1 ${f(x1)} ${f(y1)}`;
    }

    /** SVG path of a filled pie wedge from 00:00 to `to` minutes (the elapsed part of the day). */
    public static wedgePath(to: number, r: number, c: number): string {
        const f = DayClockGeometry.f;
        if (to <= 0) {
            return '';
        }
        if (to >= DayClockGeometry.DAY_MINUTES - 0.01) {
            return `M${f(c)} ${f(c - r)}A${f(r)} ${f(r)} 0 1 1 ${f(c)} ${f(c + r)}A${f(r)} ${f(r)} 0 1 1 ${f(c)} ${f(c - r)}Z`;
        }

        const [x, y] = DayClockGeometry.point(to, r, c);

        return `M${f(c)} ${f(c)}L${f(c)} ${f(c - r)}A${f(r)} ${f(r)} 0 ${to > DayClockGeometry.DAY_MINUTES / 2 ? 1 : 0} 1 ${f(x)} ${f(y)}Z`;
    }

    /**
     * Place the items of `now`'s day on rings: each item takes the first ring
     * whose last item has ended by its start; with every ring busy it shares
     * the innermost one. Items outside the day are left out; items crossing
     * midnight are cut at the day's edge. A very short item gets `minSpan`
     * minutes so it stays visible.
     */
    public static place(items: readonly DayClockItem[], now: Date, maxRings: number, minSpan = 4): DayClockPlaced[] {
        const day = DayClockGeometry.dayStart(now);
        const dayEnd = day.getTime() + (DayClockGeometry.DAY_MINUTES * 60000);
        const sorted = items
            .filter((i) => i.end.getTime() > day.getTime() && i.start.getTime() < dayEnd && i.end.getTime() >= i.start.getTime())
            .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
        const laneEnds: number[] = [];
        const rings = Math.max(1, maxRings);

        return sorted.map((item) => {
            let lane = laneEnds.findIndex((end) => end <= item.start.getTime());

            if (lane === -1) {
                lane = Math.min(laneEnds.length, rings - 1);
            }
            laneEnds[lane] = Math.max(laneEnds[lane] ?? 0, item.end.getTime());

            const from = DayClockGeometry.minutes(item.start, day);

            return {
                item,
                lane,
                from,
                to: Math.min(DayClockGeometry.DAY_MINUTES, Math.max(from + minSpan, DayClockGeometry.minutes(item.end, day))),
                state: DayClockGeometry.state(item, now)
            };
        });
    }

}

/** @deprecated use `DayClockGeometry.DAY_MINUTES`. */
export const DAY_MINUTES = DayClockGeometry.DAY_MINUTES;
