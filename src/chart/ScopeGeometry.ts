/** A point in the scope plane: x east, y north (range units). */
export interface ScopePoint {
    x: number;
    y: number;
}

/**
 * Pure maths of `RadarScope`: bearing/range ↔ plane (0° = north/up,
 * clockwise), single-link clusters, convex hull, a rounded loop around a
 * cluster, deterministic echo shapes and the sweep age. No DOM.
 */
export class ScopeGeometry {

    /** Bearing in degrees (0 = up, clockwise) and range → plane point (y up). */
    public static toPlane(bearing: number, range: number): ScopePoint {
        const a = bearing * Math.PI / 180;

        return {x: Math.sin(a) * range, y: Math.cos(a) * range};
    }

    /** Plane point → bearing 0…360 and range. */
    public static fromPlane(p: ScopePoint): {bearing: number; range: number} {
        const b = Math.atan2(p.x, p.y) * 180 / Math.PI;

        return {bearing: (b + 360) % 360, range: Math.hypot(p.x, p.y)};
    }

    /** Degrees the sweep has travelled since it passed `bearing` (0 … < 360). */
    public static sweepAge(bearing: number, sweep: number): number {
        return (((sweep - bearing) % 360) + 360) % 360;
    }

    /**
     * Groups of points closer than `distance` to some other member (single
     * link, union–find); each group lists point indices, groups smaller than
     * `minSize` are dropped.
     */
    public static cluster(points: readonly ScopePoint[], distance: number, minSize = 2): number[][] {
        const parent = points.map((_, i) => i);
        const find = (i: number): number => {
            while (parent[i] !== i) {
                parent[i] = parent[parent[i]!]!;
                i = parent[i]!;
            }
            return i;
        };

        for (let i = 0; i < points.length; i++) {
            for (let j = i + 1; j < points.length; j++) {
                const a = points[i]!;
                const b = points[j]!;

                if (Math.hypot(a.x - b.x, a.y - b.y) <= distance) {
                    parent[find(i)] = find(j);
                }
            }
        }

        const groups = new Map<number, number[]>();

        points.forEach((_, i) => {
            const r = find(i);
            const g = groups.get(r);

            if (g === undefined) {
                groups.set(r, [i]);
            } else {
                g.push(i);
            }
        });

        return Array.from(groups.values()).filter((g) => g.length >= minSize);
    }

    /** Convex hull, counter-clockwise (monotone chain); collinear points dropped. */
    public static hull(points: readonly ScopePoint[]): ScopePoint[] {
        const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);

        if (p.length <= 2) {
            return p;
        }

        const cross = (o: ScopePoint, a: ScopePoint, b: ScopePoint): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
        const lower: ScopePoint[] = [];
        const upper: ScopePoint[] = [];

        for (const q of p) {
            while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) {
                lower.pop();
            }
            lower.push(q);
        }
        for (let i = p.length - 1; i >= 0; i--) {
            const q = p[i]!;
            while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) {
                upper.pop();
            }
            upper.push(q);
        }
        lower.pop();
        upper.pop();

        return lower.concat(upper);
    }

    /**
     * A closed loop `pad` away from the hull of the points: straight offsets
     * along the edges, round arcs at the corners (a circle for one point, a
     * stadium for two). Sampled every ~12°, counter-clockwise.
     */
    public static loop(points: readonly ScopePoint[], pad: number): ScopePoint[] {
        const h = ScopeGeometry.hull(points);
        const out: ScopePoint[] = [];

        if (h.length === 0) {
            return out;
        }
        if (h.length === 1) {
            for (let k = 0; k < 30; k++) {
                const a = k / 30 * Math.PI * 2;
                out.push({x: h[0]!.x + Math.cos(a) * pad, y: h[0]!.y + Math.sin(a) * pad});
            }
            return out;
        }

        const n = h.length;
        // outward normal angle of edge i → i+1 (counter-clockwise hull: outside is to the right)
        const normal = (i: number): number => {
            const a = h[i]!;
            const b = h[(i + 1) % n]!;
            return Math.atan2(-(b.x - a.x), b.y - a.y);
        };

        for (let i = 0; i < n; i++) {
            const v = h[i]!;
            let a0 = normal((i - 1 + n) % n);
            let a1 = normal(i);

            while (a1 < a0) {
                a1 += Math.PI * 2;
            }
            if (n === 2) {
                // two points: half circles at both ends
                a0 = normal(i);
                a1 = a0 + Math.PI;
            }

            const steps = Math.max(1, Math.ceil((a1 - a0) / (Math.PI / 15)));

            for (let k = 0; k <= steps; k++) {
                const a = a0 + (a1 - a0) * k / steps;
                out.push({x: v.x + Math.cos(a) * pad, y: v.y + Math.sin(a) * pad});
            }
        }

        return out;
    }

    /** A stable hash of a string (for per-target shapes). */
    public static hash(s: string): number {
        let h = 2166136261;

        for (let i = 0; i < s.length; i++) {
            h = Math.imul(h ^ s.charCodeAt(i), 16777619);
        }

        return h >>> 0;
    }

    /**
     * Radii factors (0.55 … 1) of an irregular echo outline with `n` corners,
     * the same for the same seed.
     */
    public static blob(seed: number, n = 12): number[] {
        let s = seed || 1;
        const rnd = (): number => {
            s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909);
            return ((s >>> 0) % 10000) / 10000;
        };
        const raw = Array.from({length: n}, () => 0.55 + rnd() * 0.45);

        // smooth once so it reads as a blob, not a star
        return raw.map((v, i) => (v * 2 + raw[(i + 1) % n]! + raw[(i - 1 + n) % n]!) / 4);
    }

}
