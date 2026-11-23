/** One encounter: when, and which known individuals were in it. */
export interface AssociationEncounter {
    t: number;
    ids: ReadonlyArray<string>;
}

/** A pair of individuals with how often they were seen together and their half-weight index. */
export interface AssociationPair {
    a: string;
    b: string;
    /** Encounters with both. */
    together: number;
    /** Encounters with a but not b, and b but not a. */
    onlyA: number;
    onlyB: number;
    /** Half-weight index 0 … 1. */
    hwi: number;
}

/** What is known about one individual up to a time. */
export interface AssociationTally {
    sightings: number;
    first: number;
    last: number;
}

const key = (a: string, b: string): string => (a < b ? a + '\u0000' + b : b + '\u0000' + a);

/**
 * Pure part of `AssociationSky`: who was seen with whom. Tallies sightings
 * and co-sightings up to a time, the half-weight association index
 * HWI = x / (x + ½(ya + yb)), social units as connected groups above a
 * threshold, a deterministic force layout by association strength, and
 * convex hulls for drawing units.
 */
export class AssociationIndex {

    /** Half-weight index for x encounters together and ya / yb apart. */
    public static hwi(together: number, onlyA: number, onlyB: number): number {
        const d = together + 0.5 * (onlyA + onlyB);

        return d > 0 ? together / d : 0;
    }

    /** Sightings per individual and co-sightings per pair, counting encounters with t ≤ `until`. */
    public static tally(encounters: ReadonlyArray<AssociationEncounter>, until = Infinity): {
        seen: Map<string, AssociationTally>;
        together: Map<string, number>;
    } {
        const seen = new Map<string, AssociationTally>();
        const together = new Map<string, number>();

        for (const e of encounters) {
            if (e.t > until) {
                continue;
            }

            const ids = [...new Set(e.ids)];

            for (const id of ids) {
                const s = seen.get(id);
                if (s === undefined) {
                    seen.set(id, {sightings: 1, first: e.t, last: e.t});
                } else {
                    s.sightings++;
                    s.first = Math.min(s.first, e.t);
                    s.last = Math.max(s.last, e.t);
                }
            }
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const k = key(ids[i]!, ids[j]!);
                    together.set(k, (together.get(k) ?? 0) + 1);
                }
            }
        }

        return {seen, together};
    }

    /** Every pair seen together at least once, with its HWI. */
    public static pairs(tally: ReturnType<typeof AssociationIndex.tally>): AssociationPair[] {
        const out: AssociationPair[] = [];

        for (const [k, x] of tally.together) {
            const [a, b] = k.split('\u0000') as [string, string];
            const na = tally.seen.get(a)?.sightings ?? x;
            const nb = tally.seen.get(b)?.sightings ?? x;
            const onlyA = na - x, onlyB = nb - x;

            out.push({a, b, together: x, onlyA, onlyB, hwi: AssociationIndex.hwi(x, onlyA, onlyB)});
        }

        return out.sort((p, q) => q.hwi - p.hwi || (p.a + p.b < q.a + q.b ? -1 : 1));
    }

    /**
     * Social units: individuals joined by pairs with HWI ≥ threshold (and at
     * least `minTogether` co-sightings), as connected groups of two or more,
     * largest first; members sorted.
     */
    public static units(pairs: ReadonlyArray<AssociationPair>, threshold: number, minTogether = 2): string[][] {
        const parent = new Map<string, string>();
        const find = (x: string): string => {
            let r = x;
            while (parent.get(r) !== r) {
                r = parent.get(r)!;
            }
            parent.set(x, r);
            return r;
        };

        for (const p of pairs) {
            if (p.hwi < threshold || p.together < minTogether) {
                continue;
            }
            for (const id of [p.a, p.b]) {
                if (!parent.has(id)) {
                    parent.set(id, id);
                }
            }
            const ra = find(p.a), rb = find(p.b);
            if (ra !== rb) {
                parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
            }
        }

        const groups = new Map<string, string[]>();

        for (const id of parent.keys()) {
            const r = find(id);
            const g = groups.get(r) ?? [];
            g.push(id);
            groups.set(r, g);
        }

        return [...groups.values()]
            .filter((g) => g.length > 1)
            .map((g) => g.sort())
            .sort((a, b) => b.length - a.length || (a[0]! < b[0]! ? -1 : 1));
    }

    /**
     * Deterministic force layout: pairs attract with their HWI, everybody
     * repels, a weak pull to the centre keeps loners in. Returns positions in
     * roughly −1 … 1.
     */
    public static layout(ids: ReadonlyArray<string>, pairs: ReadonlyArray<AssociationPair>, options: {seed?: number; iterations?: number} = {}): Map<string, {x: number; y: number}> {
        let s = (options.seed ?? 1) % 2147483647 || 1;
        const rnd = (): number => {
            s = (s * 16807) % 2147483647;
            return (s - 1) / 2147483646;
        };
        const n = ids.length;
        const index = new Map(ids.map((id, i) => [id, i]));
        const x = new Float64Array(n), y = new Float64Array(n);

        for (let i = 0; i < n; i++) {
            const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
            x[i] = Math.cos(a) * r;
            y[i] = Math.sin(a) * r;
        }

        const links = pairs
            .map((p) => ({i: index.get(p.a), j: index.get(p.b), w: p.hwi}))
            .filter((l): l is {i: number; j: number; w: number} => l.i !== undefined && l.j !== undefined && l.w > 0);
        const iterations = options.iterations ?? 400;
        const rest = 1.4 / Math.sqrt(Math.max(1, n));

        for (let it = 0; it < iterations; it++) {
            const cool = 1 - it / iterations;
            const fx = new Float64Array(n), fy = new Float64Array(n);

            for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                    let dx = x[i]! - x[j]!, dy = y[i]! - y[j]!;
                    let d2 = dx * dx + dy * dy;
                    if (d2 < 1e-9) {
                        dx = (rnd() - 0.5) * 1e-3;
                        dy = (rnd() - 0.5) * 1e-3;
                        d2 = dx * dx + dy * dy;
                    }
                    const f = rest * rest * 0.6 / Math.max(d2, rest * rest * 0.05);
                    const d = Math.sqrt(d2);
                    fx[i] = fx[i]! + dx / d * f;
                    fy[i] = fy[i]! + dy / d * f;
                    fx[j] = fx[j]! - dx / d * f;
                    fy[j] = fy[j]! - dy / d * f;
                }
            }
            for (const l of links) {
                const dx = x[l.j]! - x[l.i]!, dy = y[l.j]! - y[l.i]!;
                const d = Math.hypot(dx, dy) || 1e-9;
                const f = (d - rest * 0.7) * l.w * l.w * 0.5;
                fx[l.i] = fx[l.i]! + dx / d * f;
                fy[l.i] = fy[l.i]! + dy / d * f;
                fx[l.j] = fx[l.j]! - dx / d * f;
                fy[l.j] = fy[l.j]! - dy / d * f;
            }
            for (let i = 0; i < n; i++) {
                fx[i] = fx[i]! - x[i]! * 0.04;
                fy[i] = fy[i]! - y[i]! * 0.04;
                const len = Math.hypot(fx[i]!, fy[i]!);
                const cap = 0.05 * cool + 0.002;
                const k = len > cap ? cap / len : 1;
                x[i] = x[i]! + fx[i]! * k;
                y[i] = y[i]! + fy[i]! * k;
            }
        }

        // centre and scale into −1 … 1
        let cx = 0, cy = 0, m = 1e-9;

        for (let i = 0; i < n; i++) {
            cx += x[i]! / n;
            cy += y[i]! / n;
        }
        for (let i = 0; i < n; i++) {
            m = Math.max(m, Math.abs(x[i]! - cx), Math.abs(y[i]! - cy));
        }

        const out = new Map<string, {x: number; y: number}>();

        ids.forEach((id, i) => out.set(id, {x: (x[i]! - cx) / m, y: (y[i]! - cy) / m}));

        return out;
    }

    /** Convex hull (counter-clockwise, no repeated first point). */
    public static hull(points: ReadonlyArray<{x: number; y: number}>): {x: number; y: number}[] {
        const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);

        if (p.length < 3) {
            return p;
        }

        const cross = (o: {x: number; y: number}, a: {x: number; y: number}, b: {x: number; y: number}): number =>
            (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
        const lower: {x: number; y: number}[] = [];
        const upper: {x: number; y: number}[] = [];

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

}
