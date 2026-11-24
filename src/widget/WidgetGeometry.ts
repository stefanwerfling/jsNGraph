/**
 * Pure geometry of the dashboard widgets (no DOM). Angles are in degrees,
 * 0 at the top, growing clockwise — the way a gauge is read.
 */
export class WidgetGeometry {

    /** Point at `deg` on a circle around (cx, cy). */
    public static polar(cx: number, cy: number, r: number, deg: number): [number, number] {
        const a = (deg - 90) * Math.PI / 180;

        return [cx + (r * Math.cos(a)), cy + (r * Math.sin(a))];
    }

    /**
     * SVG path of an arc from `from` to `to` degrees (clockwise). A sweep of
     * 360° or more is drawn as two half arcs (one arc command cannot close a circle);
     * an empty sweep gives ''.
     */
    public static arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
        const sweep = to - from;

        if (sweep <= 0.001 || r <= 0) {
            return '';
        }
        if (sweep >= 359.999) {
            const [ax, ay] = WidgetGeometry.polar(cx, cy, r, from);
            const [bx, by] = WidgetGeometry.polar(cx, cy, r, from + 180);

            return `M${f(ax)} ${f(ay)}A${f(r)} ${f(r)} 0 1 1 ${f(bx)} ${f(by)}A${f(r)} ${f(r)} 0 1 1 ${f(ax)} ${f(ay)}`;
        }

        const [ax, ay] = WidgetGeometry.polar(cx, cy, r, from);
        const [bx, by] = WidgetGeometry.polar(cx, cy, r, to);

        return `M${f(ax)} ${f(ay)}A${f(r)} ${f(r)} 0 ${sweep > 180 ? 1 : 0} 1 ${f(bx)} ${f(by)}`;
    }

    /**
     * Slices of a donut: each value's share of 360° from `start` (degrees,
     * clockwise from the top), with `pad` degrees of gap after every visible
     * slice (shrunk when slices are too thin for it). Values ≤ 0 get an empty
     * span at their place, so a slice can grow from nothing.
     */
    public static donut(values: readonly number[], pad = 0, start = 0): Array<{from: number; to: number; share: number}> {
        const vals = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
        const total = vals.reduce((a, v) => a + v, 0);
        const shown = vals.filter((v) => v > 0).length;
        const gap = shown < 2 ? 0 : Math.min(pad, 360 / shown / 3);
        const room = 360 - gap * shown;
        let at = start;

        return vals.map((v) => {
            const share = total > 0 ? v / total : 0;
            const sweep = share * room;
            const out = {from: at, to: at + sweep, share};
            at += sweep + (v > 0 ? gap : 0);
            return out;
        });
    }

    /** Share of `max` covered by `value`, clamped to 0…1 (0 for max ≤ 0). */
    public static fraction(value: number, max: number, min = 0): number {
        if (!(max > min) || !Number.isFinite(value)) {
            return 0;
        }

        return Math.max(0, Math.min(1, (value - min) / (max - min)));
    }

    /** How many of `segments` cells a value lights (rounded to the nearest cell). */
    public static litCount(value: number, max: number, segments: number): number {
        return Math.round(WidgetGeometry.fraction(value, max) * segments);
    }

    /**
     * Which stacked value lights each of `segments` cells: index into `values`,
     * or -1 for an unlit cell. Values stack in order; a cell belongs to the value
     * its centre falls into.
     */
    public static segmentOwners(values: readonly number[], max: number, segments: number): number[] {
        const owners: number[] = [];
        const bounds: number[] = [];
        let sum = 0;

        for (const v of values) {
            sum += Math.max(0, v);
            bounds.push(sum);
        }

        for (let k = 0; k < segments; k++) {
            const at = ((k + 0.5) / segments) * max;
            const owner = bounds.findIndex((b) => at < b);

            owners.push(max > 0 ? owner : -1);
        }

        return owners;
    }

    /** "Nice" tick values covering min…max (1, 2, 2.5 or 5 × 10ⁿ steps, about `count` of them). */
    public static ticks(min: number, max: number, count = 5): number[] {
        if (!(max > min)) {
            return [min];
        }

        const raw = (max - min) / Math.max(1, count);
        const mag = 10 ** Math.floor(Math.log10(raw));
        const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
        const out: number[] = [];

        for (let v = Math.ceil(min / step) * step; v <= max + (step * 1e-9); v += step) {
            out.push(Math.round(v / step) * step);
        }

        return out;
    }

    /** Value at a horizontal position `x` between `x0` and `x1`, clamped and snapped to `step` (0 = no snap). */
    public static valueAt(x: number, x0: number, x1: number, min: number, max: number, step = 0): number {
        const t = x1 > x0 ? Math.max(0, Math.min(1, (x - x0) / (x1 - x0))) : 0;
        const v = min + (t * (max - min));

        return step > 0 ? Math.round(v / step) * step : v;
    }

}

function f(n: number): string {
    return String(Math.round(n * 100) / 100);
}
