/** What a strand's length shows. */
export type BurstLength = 'count' | 'probability' | 'lift';
/** How the strands of one side are ordered, from the right (most) counter-clockwise. */
export type BurstOrder = 'probability' | 'count' | 'lift' | 'group';
/** One run of strands per side, or one sector per group inside each side. */
export type BurstMode = 'overview' | 'group';

/** The fields of an item the layout needs. */
export interface BurstSlotInput {
    id: string;
    group: string;
    count: number;
    /** Probability of the positive outcome, 0…1. */
    probability: number;
    lift: number;
}

/** Where one item's strand points (canvas angle: 0 = right, clockwise positive, so the top half is negative). */
export interface BurstSlot {
    id: string;
    angle: number;
    /** 0 = positive outcome is the majority (top half), 1 = negative (bottom half). */
    side: 0 | 1;
    /** Angular room of the strand (radians). */
    width: number;
}

/** The angular extent of one group on one side (group mode). */
export interface BurstGroupSpan {
    group: string;
    side: 0 | 1;
    from: number;
    to: number;
    count: number;
}

/** A length metric mapped onto 0…1 of the radius. */
export interface BurstScale {
    kind: BurstLength;
    log: boolean;
    min: number;
    max: number;
    /** Rings worth drawing (values inside min…max). */
    ticks: number[];
}

/**
 * Pure geometry of `OutcomeBurst`: which way each strand points, how long it
 * is, the curved centre line and the tapered ribbon around it. No DOM.
 *
 * Angles: the positive majority (p ≥ 0.5) fills the top half from the right
 * (strongest) counter-clockwise to the left, the negative majority the bottom
 * half from the right to the left — so read counter-clockwise from the right
 * the probability of the positive outcome falls all the way round.
 */
export class OutcomeBurstLayout {

    /** 0 when the positive outcome is the majority. */
    public static side(probability: number): 0 | 1 {
        return probability >= 0.5 ? 0 : 1;
    }

    /** Probability of the majority outcome, 0.5…1. */
    public static confidence(probability: number): number {
        return Math.max(probability, 1 - probability);
    }

    /** The value the strand length shows (probability = confidence of the majority). */
    public static metric(item: BurstSlotInput, kind: BurstLength): number {
        if (kind === 'count') {
            return item.count;
        }

        return kind === 'probability' ? OutcomeBurstLayout.confidence(item.probability) : item.lift;
    }

    /**
     * Angles of every item. `edge` keeps the strands off the horizontal axis,
     * `gap` separates groups in group mode (shrunk when there are many).
     */
    public static slots(items: ReadonlyArray<BurstSlotInput>, order: BurstOrder, mode: BurstMode,
        edge = 0.035, gap = 0.06): {slots: BurstSlot[]; groups: BurstGroupSpan[]} {
        const groupIndex = new Map<string, number>();

        for (const it of items) {
            if (!groupIndex.has(it.group)) {
                groupIndex.set(it.group, groupIndex.size);
            }
        }

        const key = (it: BurstSlotInput): number => order === 'count' ? it.count
            : order === 'lift' ? it.lift : OutcomeBurstLayout.confidence(it.probability);
        const cmp = (a: BurstSlotInput, b: BurstSlotInput): number => {
            if (order === 'group' || mode === 'group') {
                const g = groupIndex.get(a.group)! - groupIndex.get(b.group)!;
                if (g !== 0) {
                    return g;
                }
            }
            const byKey = (order === 'group' ? OutcomeBurstLayout.confidence(b.probability) - OutcomeBurstLayout.confidence(a.probability)
                : key(b) - key(a));

            return byKey !== 0 ? byKey : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        };

        const slots: BurstSlot[] = [];
        const groups: BurstGroupSpan[] = [];
        const span = Math.PI - 2 * edge;

        for (const side of [0, 1] as const) {
            const list = items.filter((it) => OutcomeBurstLayout.side(it.probability) === side).sort(cmp);

            if (list.length === 0) {
                continue;
            }

            // group breaks: only in group mode
            const breaks = mode === 'group' ? new Set(list.map((it) => it.group)).size - 1 : 0;
            const g = breaks > 0 ? Math.min(gap, span * 0.3 / breaks) : 0;
            const slot = (span - g * breaks) / list.length;
            let pos = edge;
            let current: BurstGroupSpan | null = null;

            list.forEach((it, i) => {
                if (mode === 'group' && i > 0 && it.group !== list[i - 1]!.group) {
                    pos += g;
                }
                // distance from the right along the half, turned into a canvas angle
                const along = pos + slot / 2;
                const angle = side === 0 ? -along : along;

                slots.push({id: it.id, angle, side, width: slot});
                if (mode === 'group') {
                    if (current === null || current.group !== it.group) {
                        current = {group: it.group, side, from: side === 0 ? -pos : pos, to: 0, count: 0};
                        groups.push(current);
                    }
                    current.to = side === 0 ? -(pos + slot) : pos + slot;
                    current.count++;
                }
                pos += slot;
            });
        }

        return {slots, groups};
    }

    /** A length scale over all values (log for counts: round start, ends at the largest), with a few rings. */
    public static scale(values: ReadonlyArray<number>, kind: BurstLength): BurstScale {
        const finite = values.filter((v) => Number.isFinite(v));

        if (kind === 'probability') {
            return {kind, log: false, min: 0.5, max: 1, ticks: [0.6, 0.7, 0.8, 0.9]};
        }
        if (kind === 'count') {
            const positive = finite.filter((v) => v > 0);
            const lo = positive.length > 0 ? Math.max(1, Math.min(...positive)) : 1;
            const hi = Math.max(lo * 10, ...positive);
            // round start, but end at the largest count so the longest strand reaches the rim
            const min = OutcomeBurstLayout.niceLog(lo, false);
            const max = hi;
            const ticks: number[] = [];

            for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
                for (const m of [1, 2, 5]) {
                    const v = m * 10 ** e;
                    if (v > min * 1.0001 && v < max * 0.9999) {
                        ticks.push(v);
                    }
                }
            }
            // keep at most 3 rings, the 1×10ⁿ ones first
            const decades = ticks.filter((v) => Math.abs(Math.log10(v) % 1) < 1e-9);

            return {kind, log: true, min, max, ticks: (decades.length >= 2 ? decades : ticks).slice(-3)};
        }

        const hi = Math.max(1e-9, ...finite);
        const step = OutcomeBurstLayout.niceStep(hi / 4);
        const max = Math.ceil(hi / step - 1e-9) * step;
        const ticks: number[] = [];

        for (let v = step; v < max - 1e-9; v += step) {
            ticks.push(Number(v.toFixed(6)));
        }

        return {kind, log: false, min: 0, max, ticks};
    }

    /** 0…1 position of a value on the scale (clamped). */
    public static frac(scale: BurstScale, value: number): number {
        if (!Number.isFinite(value)) {
            return 0;
        }
        const f = scale.log
            ? (Math.log(Math.max(value, scale.min)) - Math.log(scale.min)) / (Math.log(scale.max) - Math.log(scale.min) || 1)
            : (value - scale.min) / (scale.max - scale.min || 1);

        return Math.max(0, Math.min(1, f));
    }

    /**
     * Centre line of a strand from radius `r0` to `r1` along `angle`, bent
     * sideways: a swirl shared by every strand (`swirl`) plus a wave of its
     * own (`wave`, `phase`), both × the length. Flat [x, y, …] list.
     */
    public static strand(cx: number, cy: number, angle: number, r0: number, r1: number,
        swirl: number, wave: number, phase: number, steps = 20): number[] {
        const out: number[] = [];
        const ux = Math.cos(angle), uy = Math.sin(angle);
        const L = r1 - r0;

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const r = r0 + t * L;
            const off = L * (swirl * Math.sin(Math.PI * t) * (1 - 0.35 * t) + wave * Math.sin(Math.PI * 2 * t + phase) * Math.sin(Math.PI * t));
            out.push(cx + ux * r - uy * off, cy + uy * r + ux * off);
        }

        return out;
    }

    /** Width profile: thin at the centre, widest a little past the middle, a point at the tip. */
    public static taper(t: number): number {
        return 0.18 + 0.82 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.9);
    }

    /** Closed outline of a tapered ribbon around a centre line (flat list, left side out, right side back). */
    public static ribbon(line: ReadonlyArray<number>, width: number): number[] {
        const n = line.length / 2;
        const left: number[] = [];
        const right: number[] = [];

        for (let i = 0; i < n; i++) {
            const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
            let dx = line[b * 2]! - line[a * 2]!, dy = line[b * 2 + 1]! - line[a * 2 + 1]!;
            const len = Math.hypot(dx, dy) || 1;
            dx /= len;
            dy /= len;
            const w = width * OutcomeBurstLayout.taper(n > 1 ? i / (n - 1) : 0) / 2;
            const x = line[i * 2]!, y = line[i * 2 + 1]!;
            left.push(x - dy * w, y + dx * w);
            right.push(x + dy * w, y - dx * w);
        }

        const out = left;
        for (let i = n - 1; i >= 0; i--) {
            out.push(right[i * 2]!, right[i * 2 + 1]!);
        }

        return out;
    }

    /** Gradient stops along a strand: positive colour up to `probability`, then the negative one, blended over `blend`. */
    public static stops(probability: number, blend = 0.08): Array<{at: number; positive: boolean}> {
        const p = Math.max(0, Math.min(1, probability));
        const a = Math.max(0, p - blend / 2), b = Math.min(1, p + blend / 2);

        return [{at: 0, positive: p > 0}, {at: a, positive: p > 0}, {at: b, positive: p >= 1}, {at: 1, positive: p >= 1}];
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

    /** A stable 0…1 number per string (strand shape). */
    public static hash(s: string): number {
        let h = 2166136261;

        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }

        return ((h >>> 0) % 100000) / 100000;
    }

    /** Short count label: 950, 1.2k, 15k. */
    public static formatCount(v: number): string {
        if (v >= 10000) {
            return `${Math.round(v / 1000)}k`;
        }
        if (v >= 1000) {
            return `${Number((v / 1000).toFixed(1))}k`;
        }

        return String(Math.round(v));
    }

    private static niceLog(v: number, up: boolean): number {
        const e = Math.floor(Math.log10(v));
        const steps = [1, 2, 5, 10];

        if (up) {
            for (const m of steps) {
                if (m * 10 ** e >= v * 0.9999) {
                    return m * 10 ** e;
                }
            }
        }
        for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i]! * 10 ** e <= v * 1.0001) {
                return steps[i]! * 10 ** e;
            }
        }

        return 10 ** e;
    }

    private static niceStep(raw: number): number {
        const mag = 10 ** Math.floor(Math.log10(raw));
        const n = raw / mag;

        return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    }

}
