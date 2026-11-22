/** A closed numeric interval. */
export interface ChartRange {
    min: number;
    max: number;
}

/** An axis-aligned rectangle in CSS pixels. */
export interface ChartRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Pure numeric helpers of the chart part: "nice" tick steps (1/2/2.5/5 × 10ⁿ),
 * value ↔ pixel mapping, and zoom/pan of a range kept inside limits.
 * No DOM, so it is unit-testable.
 */
export class ChartScale {

    /** A round step so that `span` holds about `maxTicks` of them. */
    public static niceStep(span: number, maxTicks = 6): number {
        if (!(span > 0)) {
            return 1;
        }

        const raw = span / Math.max(1, maxTicks);
        const mag = 10 ** Math.floor(Math.log10(raw));
        const norm = raw / mag;
        const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;

        return nice * mag;
    }

    /** Tick values inside the range, on multiples of the nice step. */
    public static ticks(range: ChartRange, maxTicks = 6): number[] {
        const span = range.max - range.min;

        if (!(span > 0)) {
            return [range.min];
        }

        const step = ChartScale.niceStep(span, maxTicks);
        const digits = ChartScale.decimals(step) + 2;
        const out: number[] = [];

        for (let v = Math.ceil(range.min / step - 1e-9) * step; v <= range.max + step * 1e-9; v += step) {
            out.push(Number(v.toFixed(digits)));
        }

        return out;
    }

    /** Decimals a label needs to show every tick of `step` distinctly (at least one, like "0.0"). */
    public static decimals(step: number): number {
        if (!(step > 0)) {
            return 1;
        }

        const exp = Math.floor(Math.log10(step) + 1e-9);
        const extra = Math.abs(step / 10 ** exp - 2.5) < 1e-9 ? 1 : 0;

        return Math.max(1, -exp + extra);
    }

    public static format(value: number, step: number): string {
        const text = value.toFixed(ChartScale.decimals(step));

        return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
    }

    /** Value → pixel: `range.min` maps to `a`, `range.max` to `b`. */
    public static toPx(value: number, range: ChartRange, a: number, b: number): number {
        const span = range.max - range.min;

        return span === 0 ? (a + b) / 2 : a + (value - range.min) / span * (b - a);
    }

    public static fromPx(px: number, range: ChartRange, a: number, b: number): number {
        return b === a ? range.min : range.min + (px - a) / (b - a) * (range.max - range.min);
    }

    /** Min/max of the values (non-finite skipped); [0, 1] when there are none. */
    public static extent(values: Iterable<number>): ChartRange {
        let min = Infinity;
        let max = -Infinity;

        for (const v of values) {
            if (Number.isFinite(v)) {
                min = Math.min(min, v);
                max = Math.max(max, v);
            }
        }

        return min <= max ? {min, max} : {min: 0, max: 1};
    }

    /** Widen a range by a fraction of its span on both sides (a flat range by ±1). */
    public static pad(range: ChartRange, fraction: number): ChartRange {
        const span = range.max - range.min;
        const d = span > 0 ? span * fraction : 1;

        return {min: range.min - d, max: range.max + d};
    }

    /**
     * Zoom around `at`: factor < 1 zooms in. The result stays inside
     * `limits` (when given) and never gets narrower than `minSpan`.
     */
    public static zoom(range: ChartRange, at: number, factor: number, limits?: ChartRange, minSpan = 0): ChartRange {
        let min = at - (at - range.min) * factor;
        let max = at + (range.max - at) * factor;

        if (max - min < minSpan) {
            const t = range.max === range.min ? 0.5 : (at - range.min) / (range.max - range.min);
            min = at - minSpan * t;
            max = min + minSpan;
        }

        return limits === undefined ? {min, max} : ChartScale.clamp({min, max}, limits);
    }

    /** Shift by `delta` (data units), kept inside `limits`. */
    public static pan(range: ChartRange, delta: number, limits?: ChartRange): ChartRange {
        const moved = {min: range.min + delta, max: range.max + delta};

        return limits === undefined ? moved : ChartScale.clamp(moved, limits);
    }

    /** Fit a range inside limits: shrink to them when wider, else slide in. */
    public static clamp(range: ChartRange, limits: ChartRange): ChartRange {
        const span = Math.min(range.max - range.min, limits.max - limits.min);
        let min = Math.max(range.min, limits.min);

        if (min + span > limits.max) {
            min = limits.max - span;
        }

        return {min, max: min + span};
    }

}
