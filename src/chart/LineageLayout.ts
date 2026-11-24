import { Color } from '../util/Color';

/** One member of a family tree on a time axis. */
export interface LineageNode {
    id: string;
    label: string;
    /** Year it appeared (fractions allowed). */
    year: number;
    /** Where it came from; none = a root. */
    parent?: string;
    /** Year it ended; none = still going (the line runs to the end of the axis). */
    end?: number;
    /**
     * Continue the parent's row instead of branching off (the successor). By
     * default the child with the largest family continues it.
     */
    trunk?: boolean;
    /** Side a branch leaves to; by default the side with fewer rows so far. */
    side?: 'up' | 'down';
    /** Band (bands are stacked below each other); children inherit their parent's. */
    band?: string;
    /** A marked member (e.g. one with long-term support): drawn with a white ring. */
    mark?: boolean;
    labelPosition?: 'below' | 'above' | 'right';
    color?: string;
    description?: string;
}

export interface LineageBand {
    id: string;
    label: string;
}

export type LineageScale = 'linear' | 'compressed';

export interface LineageLayoutOptions {
    from: number;
    to: number;
    scale?: LineageScale;
    /** World x of `from` / `to`. */
    x0: number;
    x1: number;
    /** World y of the first row. */
    top: number;
    rowHeight: number;
    /** Extra space between bands (default one row). */
    bandGap?: number;
    bands?: ReadonlyArray<LineageBand>;
}

export type LineagePoint = [number, number];

export interface LineagePlaced {
    node: LineageNode;
    x: number;
    y: number;
    row: number;
    band: string;
    /** Line from the parent: along the row for a successor, riser + row for a branch; empty for roots. */
    incoming: LineagePoint[];
    /** Line after the node when nothing continues its row: to `end` or to the end of the axis. */
    tail: LineagePoint[];
    /** True when the tail stops at `end`. */
    ended: boolean;
    depth: number;
}

export interface LineageBandSpan {
    id: string;
    label: string;
    y0: number;
    y1: number;
}

export interface LineageResult {
    placed: LineagePlaced[];
    rows: number;
    bands: LineageBandSpan[];
    /** World y below the last row. */
    bottom: number;
    x: (year: number) => number;
}

interface Block {
    rows: string[][];
    main: number;
}

/**
 * Pure layout of a family tree on a time axis: x = year (linear or
 * compressed, where quiet decades shrink), one row per line of descent. A
 * node's successor continues its row; other children branch off on a riser
 * at the parent's x, above or below the parent's block, so blocks nest and
 * lines never cross inside a band. Bands (e.g. embedded systems) are stacked
 * under each other.
 */
export class LineageLayout {

    /**
     * Year → x. 'compressed' puts every distinct year on a knot and gives each
     * gap the width gap^power (default 0.5), so a crowded decade gets room and
     * a quiet one shrinks; piecewise linear between knots.
     */
    public static timeScale(years: ReadonlyArray<number>, from: number, to: number, x0: number, x1: number,
        scale: LineageScale = 'linear', power = 0.5): (year: number) => number {
        if (scale === 'linear' || to <= from) {
            const k = (x1 - x0) / Math.max(1e-9, to - from);
            return (y: number): number => x0 + (y - from) * k;
        }
        const knots = [...new Set([from, to, ...years.filter((y) => y > from && y < to)])].sort((a, b) => a - b);
        const cum = [0];
        for (let i = 1; i < knots.length; i++) {
            cum.push(cum[i - 1]! + Math.pow(knots[i]! - knots[i - 1]!, power));
        }
        const total = cum[cum.length - 1]!;
        const xs = cum.map((c) => x0 + (x1 - x0) * c / total);

        return (y: number): number => {
            let i = 1;
            while (i < knots.length - 1 && knots[i]! < y) {
                i++;
            }
            const a = knots[i - 1]!, b = knots[i]!;
            return xs[i - 1]! + (xs[i]! - xs[i - 1]!) * (y - a) / (b - a);
        };
    }

    /** Children by parent id, sorted by year (then input order). */
    public static children(nodes: ReadonlyArray<LineageNode>): Map<string, LineageNode[]> {
        const ids = new Set(nodes.map((n) => n.id));
        const out = new Map<string, LineageNode[]>();
        for (const n of nodes) {
            if (n.parent !== undefined && ids.has(n.parent)) {
                const list = out.get(n.parent) ?? [];
                list.push(n);
                out.set(n.parent, list);
            }
        }
        for (const list of out.values()) {
            list.sort((a, b) => a.year - b.year);
        }

        return out;
    }

    /** Roots: nodes without a (known) parent, by year. */
    public static roots(nodes: ReadonlyArray<LineageNode>): LineageNode[] {
        const ids = new Set(nodes.map((n) => n.id));

        return nodes.filter((n) => n.parent === undefined || !ids.has(n.parent)).sort((a, b) => a.year - b.year);
    }

    /** Successor of each node that has one (explicit `trunk`, else the child with the largest family). */
    public static trunks(nodes: ReadonlyArray<LineageNode>): Map<string, string> {
        const kids = LineageLayout.children(nodes);
        const size = new Map<string, number>();
        const count = (id: string): number => {
            const known = size.get(id);
            if (known !== undefined) {
                return known;
            }
            size.set(id, 1);
            const s = 1 + (kids.get(id) ?? []).reduce((a, c) => a + count(c.id), 0);
            size.set(id, s);
            return s;
        };
        const out = new Map<string, string>();
        for (const [id, list] of kids) {
            const explicit = list.find((c) => c.trunk === true);
            if (explicit !== undefined) {
                out.set(id, explicit.id);
            } else if (!list.some((c) => c.trunk === false)) {
                let best = list[0]!;
                for (const c of list) {
                    if (count(c.id) > count(best.id)) {
                        best = c;
                    }
                }
                out.set(id, best.id);
            } else {
                const free = list.filter((c) => c.trunk !== false);
                if (free.length > 0) {
                    out.set(id, free.reduce((b, c) => (count(c.id) > count(b.id) ? c : b)).id);
                }
            }
        }

        return out;
    }

    /** Rows top → bottom, each row the node ids that share it (a node and its chain of successors). */
    public static rows(nodes: ReadonlyArray<LineageNode>): string[][] {
        const kids = LineageLayout.children(nodes);
        const trunk = LineageLayout.trunks(nodes);
        const seen = new Set<string>();
        const block = (n: LineageNode): Block => {
            seen.add(n.id);
            const t = trunk.get(n.id);
            const list = (kids.get(n.id) ?? []).filter((c) => !seen.has(c.id));
            const tn = list.find((c) => c.id === t);
            const base: Block = tn !== undefined ? block(tn) : {rows: [[]], main: 0};
            base.rows[base.main]!.unshift(n.id);
            const up: Block[] = [], down: Block[] = [];
            let nu = 0, nd = 0;
            for (const c of list) {
                if (c === tn || seen.has(c.id)) {
                    continue;
                }
                const b = block(c);
                const side = c.side ?? (nu < nd ? 'up' : nd < nu ? 'down' : 'up');
                if (side === 'up') {
                    up.push(b);
                    nu += b.rows.length;
                } else {
                    down.push(b);
                    nd += b.rows.length;
                }
            }
            // earlier branches sit nearer to the parent's row
            const rows = [...[...up].reverse().flatMap((b) => b.rows), ...base.rows, ...down.flatMap((b) => b.rows)];

            return {rows, main: nu + base.main};
        };

        return LineageLayout.roots(nodes).flatMap((r) => (seen.has(r.id) ? [] : block(r).rows));
    }

    /** Band of every node: its own, else its parent's, else ''. */
    public static bandsOf(nodes: ReadonlyArray<LineageNode>): Map<string, string> {
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const out = new Map<string, string>();
        const get = (n: LineageNode, guard: number): string => {
            const known = out.get(n.id);
            if (known !== undefined) {
                return known;
            }
            const p = n.parent !== undefined ? byId.get(n.parent) : undefined;
            const b = n.band ?? (p !== undefined && guard < nodes.length ? get(p, guard + 1) : '');
            out.set(n.id, b);
            return b;
        };
        nodes.forEach((n) => get(n, 0));

        return out;
    }

    public static layout(nodes: ReadonlyArray<LineageNode>, o: LineageLayoutOptions): LineageResult {
        const x = LineageLayout.timeScale(nodes.map((n) => n.year), o.from, o.to, o.x0, o.x1, o.scale ?? 'linear');
        const bandOf = LineageLayout.bandsOf(nodes);
        const order = ['', ...(o.bands ?? []).map((b) => b.id)];
        const bandIndex = (id: string): number => {
            const i = order.indexOf(id);
            return i < 0 ? order.length : i;
        };
        // rows of a band below those of the bands before it (stable)
        const rows = LineageLayout.rows(nodes)
            .map((r, i) => ({r, i, b: bandIndex(bandOf.get(r[0]!) ?? '')}))
            .sort((p, q) => p.b - q.b || p.i - q.i);
        const gap = o.bandGap ?? o.rowHeight;
        const rowOf = new Map<string, number>();
        const yOfRow: number[] = [];
        const spans: LineageBandSpan[] = [];
        let y = o.top;
        rows.forEach((r, i) => {
            const prev = rows[i - 1];
            if (prev !== undefined && prev.b !== r.b) {
                y += gap;
            }
            yOfRow.push(y);
            r.r.forEach((id) => rowOf.set(id, i));
            const bid = order[r.b] ?? '';
            const span = spans[spans.length - 1];
            if (span !== undefined && span.id === bid) {
                span.y1 = y + o.rowHeight / 2;
            } else {
                spans.push({id: bid, label: o.bands?.find((b) => b.id === bid)?.label ?? '', y0: y - o.rowHeight / 2, y1: y + o.rowHeight / 2});
            }
            y += o.rowHeight;
        });

        const byId = new Map(nodes.map((n) => [n.id, n]));
        const trunk = LineageLayout.trunks(nodes);
        const depth = (n: LineageNode): number => {
            let d = 0, p = n.parent !== undefined ? byId.get(n.parent) : undefined;
            while (p !== undefined && d < nodes.length) {
                d++;
                p = p.parent !== undefined ? byId.get(p.parent) : undefined;
            }
            return d;
        };
        const placed: LineagePlaced[] = [];
        for (const n of nodes) {
            const row = rowOf.get(n.id);
            if (row === undefined) {
                continue;
            }
            const nx = x(n.year), ny = yOfRow[row]!;
            const p = n.parent !== undefined ? byId.get(n.parent) : undefined;
            const pr = p !== undefined ? rowOf.get(p.id) : undefined;
            let incoming: LineagePoint[] = [];
            if (p !== undefined && pr !== undefined) {
                const px = x(p.year), py = yOfRow[pr]!;
                incoming = py === ny ? [[px, py], [nx, ny]] : [[px, py], [px, ny], [nx, ny]];
            }
            const hasSuccessor = trunk.has(n.id) && rowOf.get(trunk.get(n.id)!) === row;
            const ended = n.end !== undefined;
            const tail: LineagePoint[] = hasSuccessor ? [] : [[nx, ny], [x(Math.min(o.to, Math.max(n.year, n.end ?? o.to))), ny]];
            placed.push({node: n, x: nx, y: ny, row, band: bandOf.get(n.id) ?? '', incoming, tail, ended, depth: depth(n)});
        }

        return {placed, rows: rows.length, bands: spans, bottom: y - o.rowHeight / 2, x};
    }

    /** The node, all its ancestors and all its descendants (not its siblings' families). */
    public static lineage(nodes: ReadonlyArray<LineageNode>, id: string): Set<string> {
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const kids = LineageLayout.children(nodes);
        const out = new Set<string>();
        let p = byId.get(id);
        while (p !== undefined && !out.has(p.id)) {
            out.add(p.id);
            p = p.parent !== undefined ? byId.get(p.parent) : undefined;
        }
        const stack = [...(kids.get(id) ?? [])];
        while (stack.length > 0) {
            const c = stack.pop()!;
            if (!out.has(c.id)) {
                out.add(c.id);
                stack.push(...(kids.get(c.id) ?? []));
            }
        }

        return out;
    }

    /**
     * Year tags along the top: every year gets a pill on level 0, or level 1
     * when it would overlap the previous one there; years that fit on neither
     * are left out (their grid line stays).
     */
    public static tags(years: ReadonlyArray<number>, x: (y: number) => number, width: number): Array<{year: number; x: number; level: number}> {
        const out: Array<{year: number; x: number; level: number}> = [];
        const last = [-Infinity, -Infinity];
        for (const year of [...new Set(years)].sort((a, b) => a - b)) {
            const px = x(year);
            const level = px - last[0]! >= width ? 0 : px - last[1]! >= width ? 1 : -1;
            if (level >= 0) {
                last[level] = px;
                out.push({year, x: px, level});
            }
        }

        return out;
    }

    /** Colour along stops for t in 0…1. */
    public static colorAt(t: number, stops: ReadonlyArray<string>): string {
        if (stops.length === 0) {
            return '#888888';
        }
        if (stops.length === 1) {
            return stops[0]!;
        }
        const s = Math.max(0, Math.min(1, t)) * (stops.length - 1);
        const i = Math.min(stops.length - 2, Math.floor(s));

        return Color.lerp(stops[i]!, stops[i + 1]!, s - i);
    }

    /** Distance from a point to a polyline (Infinity for fewer than two points). */
    public static distanceToPath(px: number, py: number, pts: ReadonlyArray<LineagePoint>): number {
        let best = Infinity;
        for (let i = 1; i < pts.length; i++) {
            const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!;
            const dx = bx - ax, dy = by - ay;
            const len = dx * dx + dy * dy;
            const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
            best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
        }

        return best;
    }

}
