/** What the packing needs of an actor: its year and how far its label reaches left/right of its x (world units). */
export interface RootsPlaceInput {
    id: string;
    year: number;
    left: number;
    right: number;
}

export interface RootsPlaceOptions {
    from: number;
    to: number;
    x0: number;
    x1: number;
    /** y of the first row. */
    top: number;
    rowH: number;
    /** At least this many rows (default: enough for the labels' total width × 1.4). */
    minRows?: number;
    /** Free space between two labels in one row. */
    pad?: number;
}

export interface RootsPlaced {
    x: number;
    y: number;
    row: number;
}

export interface RootsBar {
    x: number;
    w: number;
    cx: number;
}

/** Two categories shared by `count` actors. */
export interface RootsLink {
    a: number;
    b: number;
    count: number;
    members: string[];
}

/**
 * Pure geometry of `RootsChart`: the time axis, packing actor labels into
 * rows without overlap, the category bars, the strands from an actor down to
 * a bar, the arcs between categories and the angles of the radial fans.
 */
export class RootsLayout {

    public static xOf(year: number, from: number, to: number, x0: number, x1: number): number {
        return x0 + (year - from) / ((to - from) || 1) * (x1 - x0);
    }

    /**
     * Rows for the actors so that no two labels overlap: in year order each
     * actor takes the free row nearest a row picked from its id (so the
     * picture scatters instead of filling from the top); a new row opens
     * when none is free.
     */
    public static place(actors: ReadonlyArray<RootsPlaceInput>, o: RootsPlaceOptions): {placed: Map<string, RootsPlaced>; rows: number} {
        const pad = o.pad ?? 8;
        const total = actors.reduce((s, a) => s + a.left + a.right + pad, 0);
        let rows = Math.max(1, o.minRows ?? 0, Math.ceil(1.4 * total / Math.max(1, o.x1 - o.x0)));
        const used: Array<Array<[number, number]>> = Array.from({length: rows}, () => []);
        const placed = new Map<string, RootsPlaced>();
        const sorted = [...actors].sort((a, b) => a.year - b.year || (a.id < b.id ? -1 : 1));

        for (const a of sorted) {
            const x = RootsLayout.xOf(a.year, o.from, o.to, o.x0, o.x1);
            const l = x - a.left - pad / 2, r = x + a.right + pad / 2;
            const pref = Math.floor(RootsLayout.hash(a.id) * rows);
            let row = -1;

            for (let k = 0; k < rows * 2 && row < 0; k++) {
                const cand = pref + (k % 2 === 0 ? k / 2 : -(k + 1) / 2);
                if (cand < 0 || cand >= rows) {
                    continue;
                }
                if (used[cand]!.every(([ul, ur]) => r <= ul || l >= ur)) {
                    row = cand;
                }
            }
            if (row < 0) {
                row = rows++;
                used.push([]);
            }
            used[row]!.push([l, r]);
            placed.set(a.id, {x, y: o.top + row * o.rowH, row});
        }

        return {placed, rows};
    }

    /** `n` bars side by side filling x0…x1. */
    public static bars(n: number, x0: number, x1: number): RootsBar[] {
        const w = (x1 - x0) / Math.max(1, n);

        return Array.from({length: n}, (_, i) => ({x: x0 + i * w, w, cx: x0 + (i + 0.5) * w}));
    }

    /** Actors per category. */
    public static counts(cats: ReadonlyArray<ReadonlyArray<number>>, n: number): number[] {
        const out = new Array<number>(n).fill(0);

        for (const c of cats) {
            for (const i of new Set(c)) {
                if (i >= 0 && i < n) {
                    out[i]!++;
                }
            }
        }

        return out;
    }

    /** Every pair of categories practised by the same actors, most shared first. */
    public static links(actors: ReadonlyArray<{id: string; categories: ReadonlyArray<number>}>, minCount = 1): RootsLink[] {
        const map = new Map<string, RootsLink>();

        for (const a of actors) {
            const c = [...new Set(a.categories)].sort((x, y) => x - y);
            for (let i = 0; i < c.length; i++) {
                for (let j = i + 1; j < c.length; j++) {
                    const key = `${c[i]}|${c[j]}`;
                    const l = map.get(key) ?? {a: c[i]!, b: c[j]!, count: 0, members: []};
                    l.count++;
                    l.members.push(a.id);
                    map.set(key, l);
                }
            }
        }

        return [...map.values()].filter((l) => l.count >= minCount)
            .sort((x, y) => y.count - x.count || x.a - y.a || x.b - y.b);
    }

    /** Cubic from an actor down to a bar top: leaves straight down, arrives straight down. Flat [x0,y0, c1, c2, x1,y1]. */
    public static strand(x0: number, y0: number, x1: number, y1: number): number[] {
        const h = y1 - y0;

        return [x0, y0, x0, y0 + h * 0.55, x1, y1 - h * 0.45, x1, y1];
    }

    /** Point on a cubic at t. */
    public static cubicAt(c: ReadonlyArray<number>, t: number): [number, number] {
        const u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;

        return [a * c[0]! + b * c[2]! + d * c[4]! + e * c[6]!, a * c[1]! + b * c[3]! + d * c[5]! + e * c[7]!];
    }

    /** A cubic sampled to a polyline (hit testing). */
    public static sample(c: ReadonlyArray<number>, steps = 16): number[] {
        const out: number[] = [];

        for (let i = 0; i <= steps; i++) {
            out.push(...RootsLayout.cubicAt(c, i / steps));
        }

        return out;
    }

    /** Control point of the arc hanging between two anchors: deeper the farther apart. Flat [x0,y0, cx,cy, x1,y1]. */
    public static arc(xa: number, ya: number, xb: number, yb: number, base = 24, depth = 0.32): number[] {
        return [xa, ya, (xa + xb) / 2, Math.max(ya, yb) + base + Math.abs(xb - xa) * depth, xb, yb];
    }

    public static quadAt(q: ReadonlyArray<number>, t: number): [number, number] {
        const u = 1 - t;

        return [u * u * q[0]! + 2 * u * t * q[2]! + t * t * q[4]!, u * u * q[1]! + 2 * u * t * q[3]! + t * t * q[5]!];
    }

    /**
     * Angle of a year on a fan (canvas radians): `from` just left of the top,
     * counter-clockwise down through the left to `split` at the bottom, on
     * through the right up to `to` just right of the top; `gap` (radians)
     * stays free at the top.
     */
    public static fanAngle(year: number, from: number, split: number, to: number, gap = 0.3): number {
        const top = -Math.PI / 2;
        const half = Math.PI - gap / 2;
        const y = Math.max(from, Math.min(to, year));
        const f = y <= split
            ? (y - from) / ((split - from) || 1) * half
            : half + (y - split) / ((to - split) || 1) * half;

        // counter-clockwise on screen = decreasing canvas angle
        return top - gap / 2 - f;
    }

    /** A round year step for about `maxTicks` labels. */
    public static yearStep(span: number, maxTicks = 6): number {
        for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500]) {
            if (span / s <= maxTicks) {
                return s;
            }
        }

        return 1000;
    }

    /** Shortest distance from a point to a polyline (flat list). */
    public static distanceToPath(x: number, y: number, path: ReadonlyArray<number>): number {
        let best = Infinity;

        for (let i = 0; i + 3 < path.length; i += 2) {
            const ax = path[i]!, ay = path[i + 1]!, bx = path[i + 2]!, by = path[i + 3]!;
            const dx = bx - ax, dy = by - ay;
            const l2 = dx * dx + dy * dy;
            const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
            best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
        }

        return best;
    }

    /** Greedy word wrap with a width function. */
    public static wrap(text: string, maxWidth: number, width: (s: string) => number): string[] {
        const lines: string[] = [];

        for (const para of text.split('\n')) {
            let line = '';
            for (const word of para.split(/\s+/).filter((w) => w !== '')) {
                const next = line === '' ? word : `${line} ${word}`;
                if (line !== '' && width(next) > maxWidth) {
                    lines.push(line);
                    line = word;
                } else {
                    line = next;
                }
            }
            lines.push(line);
        }

        return lines;
    }

    public static hash(s: string): number {
        let h = 2166136261;

        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }

        return ((h >>> 0) % 100000) / 100000;
    }

}
