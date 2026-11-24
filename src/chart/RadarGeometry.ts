import { ChartRange } from './ChartScale';

export interface RadarPoint {
    x: number;
    y: number;
}

/**
 * Pure geometry of the radar (spider) chart: axis angles (first axis at
 * the top, clockwise), value → point, label alignment and the nearest
 * vertex to the pointer. No DOM.
 */
export class RadarGeometry {

    /** Angle of axis `i` of `n` in radians, 0 = up, clockwise (canvas y grows down). */
    public static angle(i: number, n: number): number {
        return -Math.PI / 2 + (n > 0 ? i / n : 0) * Math.PI * 2;
    }

    /**
     * Fraction of the radius a value takes (clamped to [0, 1]). 'log': one
     * equal step per decade from the centre (0.1 or less) to `range.max`
     * (a power of ten), so 1, 10, 100 … sit on evenly spaced rings.
     */
    public static fraction(value: number, range: ChartRange, scale: 'linear' | 'log' = 'linear'): number {
        if (scale === 'log') {
            const top = Math.log10(Math.max(1, range.max)) + 1;
            return value <= 0 ? 0 : Math.max(0, Math.min(1, (Math.log10(value) + 1) / top));
        }
        const span = range.max - range.min;

        return span <= 0 ? 0 : Math.max(0, Math.min(1, (value - range.min) / span));
    }

    /** Log range top: the power of ten at or above the largest value (at least 10). */
    public static logMax(max: number): number {
        return Math.max(10, Math.pow(10, Math.ceil(Math.log10(Math.max(1, max)) - 1e-9)));
    }

    /** Rings of the log scale: 1, 10, 100 … up to `max`. */
    public static logTicks(max: number): number[] {
        const out: number[] = [];
        for (let v = 1; v <= max * 1.000001; v *= 10) {
            out.push(v);
        }
        return out;
    }

    /** Compact number: 950, 1.2K, 10K, 3.4M. */
    public static compact(v: number): string {
        const a = Math.abs(v);
        const [d, u] = a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
        const x = v / d;
        const t = Math.abs(x) >= 10 || u === '' ? String(Math.round(x * (u === '' ? 100 : 1)) / (u === '' ? 100 : 1)) : x.toFixed(1).replace(/\.0$/, '');

        return `${t}${u}`;
    }

    /** Where `value` on axis `i` of `n` lies, around `cx/cy` with outer radius `r`. */
    public static point(cx: number, cy: number, r: number, i: number, n: number, value: number, range: ChartRange,
        scale: 'linear' | 'log' = 'linear'): RadarPoint {
        const a = RadarGeometry.angle(i, n);
        const d = r * RadarGeometry.fraction(value, range, scale);

        return {x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d};
    }

    /** Text alignment for an axis label placed outside the ring on axis `i`. */
    public static labelAlign(i: number, n: number): {align: CanvasTextAlign; baseline: CanvasTextBaseline} {
        const a = RadarGeometry.angle(i, n);
        const cos = Math.cos(a);
        const sin = Math.sin(a);

        return {
            align: Math.abs(cos) < 0.2 ? 'center' : cos > 0 ? 'left' : 'right',
            baseline: Math.abs(sin) < 0.2 ? 'middle' : sin > 0 ? 'top' : 'bottom'
        };
    }

    /**
     * Nearest vertex within `radius` px: `points[s][i]` are the drawn
     * vertices of series `s`. Later series (drawn on top) win ties.
     */
    public static hit(points: ReadonlyArray<ReadonlyArray<RadarPoint> | null>, px: number, py: number, radius = 10): {series: number; axis: number} | null {
        let best: {series: number; axis: number} | null = null;
        let bestDist = radius;

        points.forEach((vertices, s) => {
            vertices?.forEach((p, i) => {
                const d = Math.hypot(p.x - px, p.y - py);

                if (d <= bestDist) {
                    bestDist = d;
                    best = {series: s, axis: i};
                }
            });
        });

        return best;
    }

}
