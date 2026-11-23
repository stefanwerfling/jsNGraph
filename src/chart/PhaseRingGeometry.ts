/** How a ring lies on the screen: an ellipse seen from above at `tilt`, turned by `yaw`. */
export interface RingView {
    cx: number;
    cy: number;
    /** Horizontal half axis in px. */
    rx: number;
    /** Vertical half axis in px (rx · sin tilt). */
    ry: number;
    /** Px per unit of height (cos tilt already applied). */
    lift: number;
    /** Turn in radians. */
    yaw: number;
}

/** A point of a ring on the screen; `depth` 1 = nearest to the viewer, −1 = farthest. */
export interface RingPoint {
    x: number;
    y: number;
    depth: number;
}

/** One sample of a smoothed cyclic series. */
export interface RingSample {
    phase: number;
    value: number;
}

/**
 * Pure maths of `PhaseRing`: phase → point on a tilted ring, smooth cyclic
 * curves, the moon's terminator, a value colour scale and hit testing.
 * Phase runs 0 … 1 once around; phase 0 lies at the front.
 */
export class PhaseRingGeometry {

    /** Low → high, after the usual "less light / more light" spectral bar. */
    public static readonly SPECTRAL: ReadonlyArray<string> = ['#1f3cff', '#00b7ff', '#2bd94a', '#ffd400', '#ff7a00', '#ff1e1e'];

    /** Screen point of `phase` on the ring, `height` units above its plane. */
    public static point(view: RingView, phase: number, height = 0): RingPoint {
        const a = phase * Math.PI * 2 + view.yaw;

        return {
            x: view.cx + Math.sin(a) * view.rx,
            y: view.cy + Math.cos(a) * view.ry - height * view.lift,
            depth: Math.cos(a)
        };
    }

    /**
     * Cyclic Catmull–Rom through `values` (sample i at phase i/n), `steps`
     * samples per interval; the last sample closes the loop at phase 1.
     */
    public static smooth(values: ReadonlyArray<number>, steps = 8): RingSample[] {
        const n = values.length;
        const out: RingSample[] = [];

        if (n === 0) {
            return out;
        }

        const v = (i: number): number => values[((i % n) + n) % n]!;

        for (let i = 0; i < n; i++) {
            const p0 = v(i - 1), p1 = v(i), p2 = v(i + 1), p3 = v(i + 2);

            for (let s = 0; s < steps; s++) {
                const t = s / steps;
                const value = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                    + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

                out.push({phase: (i + t) / n, value});
            }
        }
        out.push({phase: 1, value: v(0)});

        return out;
    }

    /** Bin whose sample point is nearest to `phase` (bins at i/n). */
    public static binAt(phase: number, bins: number): number {
        return ((Math.round(phase * bins) % bins) + bins) % bins;
    }

    /**
     * Moon (or planet) phase as seen from the centre: 0 = new, 0.5 = full.
     * `lit` is the illuminated fraction, `waxing` puts the light on the right,
     * `mid` is the terminator's x at the equator in disc radii (−1 … 1).
     */
    public static terminator(phase: number): {lit: number; waxing: boolean; mid: number} {
        const p = ((phase % 1) + 1) % 1;
        const c = Math.cos(p * Math.PI * 2);
        const waxing = p < 0.5;

        return {lit: (1 - c) / 2, waxing, mid: waxing ? c : -c};
    }

    /** Common name of a moon phase (0 = new, 0.5 = full), in eighths. */
    public static moonName(phase: number): string {
        const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous',
            'Last quarter', 'Waning crescent'];
        const p = ((phase % 1) + 1) % 1;

        return names[Math.round(p * 8) % 8]!;
    }

    /** Colour at t (0 … 1) on a list of stops (hex or rgb()). */
    public static colorAt(stops: ReadonlyArray<string>, t: number): string {
        if (stops.length === 0) {
            return '#888888';
        }
        if (stops.length === 1) {
            return stops[0]!;
        }

        const u = Math.max(0, Math.min(1, t)) * (stops.length - 1);
        const i = Math.min(stops.length - 2, Math.floor(u));
        const a = PhaseRingGeometry.rgb(stops[i]!);
        const b = PhaseRingGeometry.rgb(stops[i + 1]!);
        const f = u - i;

        return `rgb(${a.map((x, k) => Math.round(x + (b[k]! - x) * f)).join(',')})`;
    }

    /** Index of the point nearest to (x, y) within `radius` px, or −1. */
    public static nearest(points: ReadonlyArray<{x: number; y: number}>, x: number, y: number, radius: number): number {
        let best = -1;
        let bd = radius;

        points.forEach((p, i) => {
            const d = Math.hypot(p.x - x, p.y - y);

            if (d <= bd) {
                bd = d;
                best = i;
            }
        });

        return best;
    }

    /** Mean, min and max of the values (0s for an empty list). */
    public static stats(values: ReadonlyArray<number>): {mean: number; min: number; max: number} {
        if (values.length === 0) {
            return {mean: 0, min: 0, max: 0};
        }

        let sum = 0, min = Infinity, max = -Infinity;

        for (const v of values) {
            sum += v;
            min = Math.min(min, v);
            max = Math.max(max, v);
        }

        return {mean: sum / values.length, min, max};
    }

    private static rgb(c: string): number[] {
        const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());

        if (hex !== null) {
            const n = parseInt(hex[1]!, 16);
            return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        }

        const m = /rgba?\(([^)]+)\)/i.exec(c);

        if (m !== null) {
            return m[1]!.split(',').slice(0, 3).map((x) => Number(x.trim()) || 0);
        }

        return [136, 136, 136];
    }

}
