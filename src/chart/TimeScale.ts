import { ChartRange } from './ChartScale';

/** A calendar step of the time axis. */
export interface TimeStep {
    unit: 'minute' | 'hour' | 'day' | 'month' | 'year';
    count: number;
    /** Approximate length in ms (for choosing). */
    ms: number;
}

/**
 * Pure time-axis maths (local time, ms since epoch): a calendar step that
 * gives about `maxTicks` ticks, ticks on round calendar positions (whole
 * hours, days, the 1st of a month, January …), and labels whose detail
 * follows the step. No DOM.
 */
export class TimeScale {

    public static readonly MINUTE = 60_000;
    public static readonly HOUR = 60 * TimeScale.MINUTE;
    public static readonly DAY = 24 * TimeScale.HOUR;

    private static readonly STEPS: ReadonlyArray<TimeStep> = [
        {unit: 'minute', count: 1, ms: TimeScale.MINUTE},
        {unit: 'minute', count: 5, ms: 5 * TimeScale.MINUTE},
        {unit: 'minute', count: 15, ms: 15 * TimeScale.MINUTE},
        {unit: 'minute', count: 30, ms: 30 * TimeScale.MINUTE},
        {unit: 'hour', count: 1, ms: TimeScale.HOUR},
        {unit: 'hour', count: 3, ms: 3 * TimeScale.HOUR},
        {unit: 'hour', count: 6, ms: 6 * TimeScale.HOUR},
        {unit: 'hour', count: 12, ms: 12 * TimeScale.HOUR},
        {unit: 'day', count: 1, ms: TimeScale.DAY},
        {unit: 'day', count: 2, ms: 2 * TimeScale.DAY},
        {unit: 'day', count: 5, ms: 5 * TimeScale.DAY},
        {unit: 'day', count: 7, ms: 7 * TimeScale.DAY},
        {unit: 'day', count: 14, ms: 14 * TimeScale.DAY},
        {unit: 'month', count: 1, ms: 30.4 * TimeScale.DAY},
        {unit: 'month', count: 2, ms: 61 * TimeScale.DAY},
        {unit: 'month', count: 3, ms: 91 * TimeScale.DAY},
        {unit: 'month', count: 6, ms: 182 * TimeScale.DAY},
        {unit: 'year', count: 1, ms: 365 * TimeScale.DAY},
        {unit: 'year', count: 2, ms: 730 * TimeScale.DAY},
        {unit: 'year', count: 5, ms: 1826 * TimeScale.DAY},
        {unit: 'year', count: 10, ms: 3652 * TimeScale.DAY},
        {unit: 'year', count: 25, ms: 9131 * TimeScale.DAY},
        {unit: 'year', count: 50, ms: 18262 * TimeScale.DAY},
        {unit: 'year', count: 100, ms: 36524 * TimeScale.DAY}
    ];

    /** The smallest step that keeps the ticks at or below `maxTicks`. */
    public static step(range: ChartRange, maxTicks = 6): TimeStep {
        const span = Math.max(1, range.max - range.min);

        return TimeScale.STEPS.find((s) => span / s.ms <= maxTicks) ?? TimeScale.STEPS[TimeScale.STEPS.length - 1]!;
    }

    /** Tick times inside the range on round positions of the step. */
    public static ticks(range: ChartRange, step: TimeStep): number[] {
        const out: number[] = [];
        let t = TimeScale.floor(range.min, step);
        let guard = 0;

        while (t < range.min - 1) {
            t = TimeScale.next(t, step);
        }
        while (t <= range.max + 1 && guard++ < 1000) {
            out.push(t);
            t = TimeScale.next(t, step);
        }

        return out;
    }

    /** Start of the step's slot containing `t`. */
    public static floor(t: number, step: TimeStep): number {
        const d = new Date(t);

        switch (step.unit) {
            case 'minute':
                return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(),
                    Math.floor(d.getMinutes() / step.count) * step.count).getTime();
            case 'hour':
                return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(d.getHours() / step.count) * step.count).getTime();
            case 'day': {
                // multi-day steps restart on the 1st of each month (1, 6, 11 … for 5 days), weeks on Mondays
                if (step.count === 7 || step.count === 14) {
                    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
                    return monday.getTime();
                }
                return new Date(d.getFullYear(), d.getMonth(), 1 + Math.floor((d.getDate() - 1) / step.count) * step.count).getTime();
            }
            case 'month':
                return new Date(d.getFullYear(), Math.floor(d.getMonth() / step.count) * step.count, 1).getTime();
            case 'year':
                return new Date(Math.floor(d.getFullYear() / step.count) * step.count, 0, 1).getTime();
        }
    }

    /** The next tick after `t` (which is on a slot start). */
    public static next(t: number, step: TimeStep): number {
        const d = new Date(t);

        switch (step.unit) {
            case 'minute':
                return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes() + step.count).getTime();
            case 'hour':
                return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + step.count).getTime();
            case 'day': {
                if (step.count === 7 || step.count === 14) {
                    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + step.count).getTime();
                }

                const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + step.count);

                // a slot that would run past the month end restarts on the 1st (no "31, 1")
                if (step.count > 1 && (n.getMonth() !== d.getMonth() || new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - n.getDate() < step.count / 2)) {
                    return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
                }
                return n.getTime();
            }
            case 'month':
                return new Date(d.getFullYear(), d.getMonth() + step.count, 1).getTime();
            case 'year':
                return new Date(d.getFullYear() + step.count, 0, 1).getTime();
        }
    }

    /**
     * Tick label: times for sub-day steps (the date at midnight), day + month
     * for days (the year on 1 January), month names (the year in January),
     * years.
     */
    public static label(t: number, step: TimeStep, locale?: string): string {
        const d = new Date(t);
        const midnight = d.getHours() === 0 && d.getMinutes() === 0;

        if (step.unit === 'minute' || step.unit === 'hour') {
            return midnight
                ? d.toLocaleDateString(locale, {month: 'short', day: 'numeric'})
                : d.toLocaleTimeString(locale, {hour: '2-digit', minute: '2-digit'});
        }
        if (step.unit === 'day') {
            return d.getMonth() === 0 && d.getDate() === 1
                ? String(d.getFullYear())
                : d.toLocaleDateString(locale, {month: 'short', day: 'numeric'});
        }
        if (step.unit === 'month') {
            return d.getMonth() === 0 ? String(d.getFullYear()) : d.toLocaleDateString(locale, {month: 'short'});
        }

        return String(d.getFullYear());
    }

    /** Full timestamp for tooltips; the time only when it is not midnight. */
    public static full(t: number, locale?: string): string {
        const d = new Date(t);
        const date = d.toLocaleDateString(locale, {year: 'numeric', month: 'short', day: 'numeric'});

        return d.getHours() === 0 && d.getMinutes() === 0
            ? date
            : `${date} ${d.toLocaleTimeString(locale, {hour: '2-digit', minute: '2-digit'})}`;
    }

    /** Index of the last time ≤ t in a sorted list (binary search); -1 when t is before all. */
    public static indexAtOrBefore(times: ArrayLike<number>, t: number): number {
        let lo = 0;
        let hi = times.length - 1;
        let best = -1;

        while (lo <= hi) {
            const mid = (lo + hi) >> 1;

            if (times[mid]! <= t) {
                best = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        return best;
    }

    /** Index of the time nearest to t in a sorted list; -1 for an empty list. */
    public static nearest(times: ArrayLike<number>, t: number): number {
        if (times.length === 0) {
            return -1;
        }

        const i = TimeScale.indexAtOrBefore(times, t);

        if (i < 0) {
            return 0;
        }
        if (i >= times.length - 1) {
            return times.length - 1;
        }

        return t - times[i]! <= times[i + 1]! - t ? i : i + 1;
    }

    /**
     * Min/max per pixel column for a sorted series between indices — keeps
     * spikes when there are more points than pixels. Returns [t, v] pairs
     * (two per bucket, in time order of min/max).
     */
    public static decimate(times: ArrayLike<number>, values: ArrayLike<number>, from: number, to: number,
        range: ChartRange, buckets: number): [number, number][] {
        const out: [number, number][] = [];

        if (to - from + 1 <= buckets * 2) {
            for (let i = from; i <= to; i++) {
                out.push([times[i]!, values[i]!]);
            }
            return out;
        }

        const width = (range.max - range.min) / Math.max(1, buckets);
        let i = from;

        while (i <= to) {
            const b = Math.floor((times[i]! - range.min) / width);
            let lo = i;
            let hi = i;

            while (i <= to && Math.floor((times[i]! - range.min) / width) === b) {
                if (values[i]! < values[lo]!) {
                    lo = i;
                }
                if (values[i]! > values[hi]!) {
                    hi = i;
                }
                i++;
            }

            const [a, c] = lo <= hi ? [lo, hi] : [hi, lo];

            out.push([times[a]!, values[a]!]);
            if (c !== a) {
                out.push([times[c]!, values[c]!]);
            }
        }

        return out;
    }

}
