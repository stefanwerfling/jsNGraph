/** Something that happens at one time: a meeting, a release, a chapter, a film. */
export interface StoryEvent {
    id: string;
    label: string;
    /** Sort key on the time axis; events with the same time share a column. */
    time: number;
    /** Axis label of its column (e.g. a year); a label is printed where it changes. */
    period?: string;
    /** A series the event belongs to (filtering by series). */
    series?: string;
}

/** Someone (or something) whose line runs through the events it takes part in. */
export interface StoryEntity {
    id: string;
    label: string;
    /** Band colour (any CSS colour); default from the chart palette. */
    color?: string;
    /** One or two characters shown in the entry marker and the legend chip. */
    icon?: string;
}

/** Entity takes part in event; `weight` (default 1) sets the band width there. */
export interface StoryAppearance {
    entity: string;
    event: string;
    weight?: number;
}

export interface StorylineData {
    events: StoryEvent[];
    entities: StoryEntity[];
    appearances: StoryAppearance[];
}

export interface StorylineLayoutOptions {
    /** Horizontal distance between columns, world px. Default 110. */
    columnGap?: number;
    /** Width of an event bar, world px. Default 18. */
    barWidth?: number;
    /** Band widths for the smallest / largest weight, world px. Defaults 3 / 14. */
    minWidth?: number;
    maxWidth?: number;
    /** Space between bands inside an event. Default 1. */
    laneGap?: number;
    /** Space between an event and anything next to it. Default 26. */
    groupGap?: number;
    /** Space between two idle (passing) bands. Default 6. */
    idleGap?: number;
    /** Padding above/below the bands inside an event bar. Default 6. */
    eventPad?: number;
    /** Minimum height of an event bar (room for its title). Default 60. */
    minEventHeight?: number;
    /** Ordering sweeps (alternating direction). Default 10. */
    sweeps?: number;
    /** Straightening passes over all columns. Default 24. */
    relax?: number;
}

export interface StoryColumn {
    index: number;
    x: number;
    time: number;
    /** Period label of the column (only set where it changes from the previous column). */
    period: string | null;
}

export interface PlacedEvent {
    id: string;
    label: string;
    series: string | null;
    period: string | null;
    column: number;
    x: number;
    /** Bar top / bottom, world px. */
    y0: number;
    y1: number;
    /** Member entity ids, top to bottom. */
    members: string[];
}

export interface EntityPoint {
    column: number;
    x: number;
    /** Band centre. */
    y: number;
    width: number;
    /** The event it is in at this column, or null while passing. */
    event: string | null;
}

export interface PlacedEntity {
    id: string;
    points: EntityPoint[];
}

export interface StorylineResult {
    columns: StoryColumn[];
    events: Map<string, PlacedEvent>;
    entities: Map<string, PlacedEntity>;
    bounds: {minX: number; minY: number; maxX: number; maxY: number};
    /** Band crossings between neighbouring columns (the ordering's quality). */
    crossings: number;
}

interface Group {
    /** Event id, or null for one idle entity. */
    event: string | null;
    members: string[];
}

const DEFAULTS: Required<StorylineLayoutOptions> = {
    columnGap: 110,
    barWidth: 18,
    minWidth: 3,
    maxWidth: 14,
    laneGap: 1,
    groupGap: 26,
    idleGap: 6,
    eventPad: 6,
    minEventHeight: 60,
    sweeps: 10,
    relax: 24
};

/**
 * Storyline layout (the "who was where, when" chart): one column per time,
 * every entity a band from its first to its last appearance, packed
 * together inside the events it takes part in and passing freely in
 * between. Ordering is a barycentre sweep across the columns (best of all
 * sweeps by crossings); vertical placement straightens the bands by moving
 * every group towards where its members are in the neighbouring columns,
 * keeping order and gaps — an exact isotonic (PAVA) solve per column.
 * Pure and deterministic.
 */
export class StorylineLayout {

    private readonly o: Required<StorylineLayoutOptions>;

    public constructor(options: StorylineLayoutOptions = {}) {
        this.o = {...DEFAULTS, ...options};
    }

    public layout(data: StorylineData): StorylineResult {
        const o = this.o;
        const eventById = new Map(data.events.map((e) => [e.id, e]));
        const entityIndex = new Map(data.entities.map((e, i) => [e.id, i]));
        const times = [...new Set(data.events.map((e) => e.time))].sort((a, b) => a - b);
        const columnOf = new Map(times.map((t, i) => [t, i]));
        const nCols = times.length;

        // Membership: column → entity → event; and event → members (input order).
        const membership: Map<string, string>[] = times.map(() => new Map());
        const weightAt: Map<string, number>[] = times.map(() => new Map());
        const eventMembers = new Map<string, string[]>(data.events.map((e) => [e.id, []]));
        const weights: number[] = [];

        for (const a of data.appearances) {
            const ev = eventById.get(a.event);

            if (ev === undefined || !entityIndex.has(a.entity)) {
                continue;
            }

            const c = columnOf.get(ev.time)!;

            if (membership[c]!.has(a.entity)) {
                continue;   // one event per entity and column
            }

            membership[c]!.set(a.entity, ev.id);
            weightAt[c]!.set(a.entity, a.weight ?? 1);
            eventMembers.get(ev.id)!.push(a.entity);
            weights.push(a.weight ?? 1);
        }

        const wMin = Math.min(...weights, 1);
        const wMax = Math.max(...weights, 1);
        const widthOf = (w: number): number => wMax === wMin
            ? (o.minWidth + o.maxWidth) / 2
            : o.minWidth + (w - wMin) / (wMax - wMin) * (o.maxWidth - o.minWidth);

        // Lifetimes and per-column widths (idle bands keep their last width).
        const span = new Map<string, {first: number; last: number}>();

        for (let c = 0; c < nCols; c++) {
            for (const id of membership[c]!.keys()) {
                const s = span.get(id);

                if (s === undefined) {
                    span.set(id, {first: c, last: c});
                } else {
                    s.last = c;
                }
            }
        }

        const width: Map<string, number>[] = times.map(() => new Map());

        for (const [id, s] of span) {
            let w = widthOf(weightAt[s.first]!.get(id) ?? 1);

            for (let c = s.first; c <= s.last; c++) {
                const here = weightAt[c]!.get(id);

                if (here !== undefined) {
                    w = widthOf(here);
                }
                width[c]!.set(id, w);
            }
        }

        // Groups per column: the events (input order), then one per idle entity.
        const groups: Group[][] = times.map((_, c) => {
            const list: Group[] = data.events
                .filter((e) => columnOf.get(e.time) === c && (eventMembers.get(e.id)?.length ?? 0) > 0)
                .map((e) => ({event: e.id, members: eventMembers.get(e.id)!.slice()}));

            for (const [id, s] of span) {
                if (c > s.first && c < s.last && !membership[c]!.has(id)) {
                    list.push({event: null, members: [id]});
                }
            }

            return list;
        });

        const fallback = (id: string): number => (entityIndex.get(id) ?? 0) / Math.max(1, data.entities.length - 1);
        const best = this.order(groups, fallback);
        const crossings = StorylineLayout.crossings(best);

        // Vertical placement.
        const heightOf = (g: Group, c: number): number => {
            if (g.event === null) {
                return width[c]!.get(g.members[0]!) ?? o.minWidth;
            }

            const bands = g.members.reduce((sum, id) => sum + (width[c]!.get(id) ?? 0), 0) + o.laneGap * (g.members.length - 1);

            return Math.max(o.minEventHeight, bands + 2 * o.eventPad);
        };
        const gapBetween = (a: Group, b: Group): number => (a.event === null && b.event === null ? o.idleGap : o.groupGap);
        // Offset of a member's band centre from its group's top.
        const memberOffset = (g: Group, c: number): Map<string, number> => {
            const out = new Map<string, number>();

            if (g.event === null) {
                out.set(g.members[0]!, heightOf(g, c) / 2);
                return out;
            }

            const bands = g.members.reduce((sum, id) => sum + (width[c]!.get(id) ?? 0), 0) + o.laneGap * (g.members.length - 1);
            let y = (heightOf(g, c) - bands) / 2;

            for (const id of g.members) {
                const w = width[c]!.get(id) ?? 0;
                out.set(id, y + w / 2);
                y += w + o.laneGap;
            }

            return out;
        };

        const offsets = best.map((col, c) => col.map((g) => memberOffset(g, c)));
        const tops: number[][] = best.map((col, c) => {
            let y = 0;

            return col.map((g, i) => {
                if (i > 0) {
                    y += gapBetween(col[i - 1]!, g);
                }
                const top = y;
                y += heightOf(g, c);
                return top;
            });
        });
        const centre = (c: number): Map<string, number> => {
            const out = new Map<string, number>();

            best[c]!.forEach((g, i) => {
                for (const [id, off] of offsets[c]![i]!) {
                    out.set(id, tops[c]![i]! + off);
                }
            });

            return out;
        };

        let centres = best.map((_, c) => centre(c));

        for (let pass = 0; pass < o.relax; pass++) {
            const forward = pass % 2 === 0;

            for (let k = 0; k < nCols; k++) {
                const c = forward ? k : nCols - 1 - k;
                const col = best[c]!;
                const desired: number[] = [];
                const weightsC: number[] = [];

                col.forEach((g, i) => {
                    let sum = 0;
                    let n = 0;

                    for (const [id, off] of offsets[c]![i]!) {
                        for (const nc of [c - 1, c + 1]) {
                            const y = centres[nc]?.get(id);

                            if (y !== undefined) {
                                sum += y - off;
                                n++;
                            }
                        }
                    }

                    desired.push(n > 0 ? sum / n : tops[c]![i]!);
                    weightsC.push(Math.max(1, n));
                });

                // top_i - shift_i must be non-decreasing, shift_i = minimal stacked offset.
                const shift: number[] = [];
                let acc = 0;

                col.forEach((g, i) => {
                    if (i > 0) {
                        acc += heightOf(col[i - 1]!, c) + gapBetween(col[i - 1]!, g);
                    }
                    shift.push(acc);
                });

                const z = StorylineLayout.isotonic(desired.map((d, i) => d - shift[i]!), weightsC);

                tops[c] = z.map((v, i) => v + shift[i]!);
                centres[c] = centre(c);
            }
        }

        centres = best.map((_, c) => centre(c));

        // Normalise so the topmost band starts at 0.
        let minY = Infinity;
        let maxY = -Infinity;

        best.forEach((col, c) => col.forEach((g, i) => {
            minY = Math.min(minY, tops[c]![i]!);
            maxY = Math.max(maxY, tops[c]![i]! + heightOf(g, c));
        }));
        if (!Number.isFinite(minY)) {
            minY = 0;
            maxY = 0;
        }

        const columns: StoryColumn[] = times.map((time, c) => {
            const first = data.events.find((e) => e.time === time && e.period !== undefined);
            const prev = c > 0 ? data.events.find((e) => e.time === times[c - 1] && e.period !== undefined) : undefined;
            const period = first?.period ?? null;

            return {index: c, x: c * o.columnGap, time, period: period !== null && period !== (prev?.period ?? null) ? period : null};
        });

        const events = new Map<string, PlacedEvent>();

        best.forEach((col, c) => col.forEach((g, i) => {
            if (g.event !== null) {
                const ev = eventById.get(g.event)!;

                events.set(g.event, {
                    id: ev.id, label: ev.label, series: ev.series ?? null, period: ev.period ?? null, column: c,
                    x: c * o.columnGap, y0: tops[c]![i]! - minY, y1: tops[c]![i]! + heightOf(g, c) - minY, members: g.members.slice()
                });
            }
        }));

        const entities = new Map<string, PlacedEntity>();

        for (const ent of data.entities) {
            const s = span.get(ent.id);

            if (s === undefined) {
                continue;
            }

            const points: EntityPoint[] = [];

            for (let c = s.first; c <= s.last; c++) {
                const y = centres[c]!.get(ent.id);

                if (y !== undefined) {
                    points.push({column: c, x: c * o.columnGap, y: y - minY, width: width[c]!.get(ent.id)!, event: membership[c]!.get(ent.id) ?? null});
                }
            }
            entities.set(ent.id, {id: ent.id, points});
        }

        return {
            columns,
            events,
            entities,
            bounds: {minX: -o.barWidth, minY: 0, maxX: Math.max(0, nCols - 1) * o.columnGap + o.barWidth, maxY: maxY - minY},
            crossings
        };
    }

    /** Barycentre sweeps; returns the ordering with the fewest crossings seen. */
    private order(groups: Group[][], fallback: (id: string) => number): Group[][] {
        const n = groups.length;
        let current = groups.map((col) => col.map((g) => ({event: g.event, members: g.members.slice()})));
        let best = current;
        let bestCross = StorylineLayout.crossings(current);
        const positions = (col: Group[]): Map<string, number> => {
            const ids = col.flatMap((g) => g.members);
            const out = new Map<string, number>();

            ids.forEach((id, i) => out.set(id, ids.length <= 1 ? 0.5 : i / (ids.length - 1)));

            return out;
        };

        for (let s = 0; s < this.o.sweeps; s++) {
            const forward = s % 2 === 0;
            const next = current.map((col) => col.map((g) => ({event: g.event, members: g.members.slice()})));

            for (let k = 0; k < n; k++) {
                const c = forward ? k : n - 1 - k;
                const ref = forward ? c - 1 : c + 1;

                if (ref < 0 || ref >= n) {
                    continue;
                }

                const refPos = positions(next[ref]!);
                const ownPos = positions(next[c]!);
                const key = (id: string): number => refPos.get(id) ?? ownPos.get(id) ?? fallback(id);

                for (const g of next[c]!) {
                    g.members.sort((a, b) => key(a) - key(b));
                }

                const scored = next[c]!.map((g, i) => {
                    const known = g.members.map((id) => refPos.get(id)).filter((v): v is number => v !== undefined);
                    const score = known.length > 0
                        ? known.reduce((a, b) => a + b, 0) / known.length
                        : g.members.reduce((a, id) => a + key(id), 0) / g.members.length;

                    return {g, i, score};
                });

                scored.sort((a, b) => a.score - b.score || a.i - b.i);
                next[c] = scored.map((x) => x.g);
            }

            current = next;

            const cross = StorylineLayout.crossings(current);

            if (cross < bestCross) {
                bestCross = cross;
                best = current;
            }
        }

        return best;
    }

    /** Pairwise order inversions of entities present in two neighbouring columns. */
    public static crossings(order: ReadonlyArray<ReadonlyArray<{members: ReadonlyArray<string>}>>): number {
        let total = 0;

        for (let c = 0; c + 1 < order.length; c++) {
            const a = order[c]!.flatMap((g) => g.members);
            const bPos = new Map(order[c + 1]!.flatMap((g) => g.members).map((id, i) => [id, i]));
            const seq = a.map((id) => bPos.get(id)).filter((v): v is number => v !== undefined);

            for (let i = 0; i < seq.length; i++) {
                for (let j = i + 1; j < seq.length; j++) {
                    if (seq[i]! > seq[j]!) {
                        total++;
                    }
                }
            }
        }

        return total;
    }

    /**
     * Weighted isotonic regression (pool adjacent violators): the
     * non-decreasing sequence closest to `values` in weighted least squares.
     */
    public static isotonic(values: ReadonlyArray<number>, weights: ReadonlyArray<number>): number[] {
        const blocks: {value: number; weight: number; count: number}[] = [];

        values.forEach((v, i) => {
            blocks.push({value: v, weight: weights[i] ?? 1, count: 1});

            while (blocks.length > 1 && blocks[blocks.length - 2]!.value > blocks[blocks.length - 1]!.value) {
                const b = blocks.pop()!;
                const a = blocks.pop()!;
                const weight = a.weight + b.weight;

                blocks.push({value: (a.value * a.weight + b.value * b.weight) / weight, weight, count: a.count + b.count});
            }
        });

        return blocks.flatMap((b) => Array<number>(b.count).fill(b.value));
    }

}
