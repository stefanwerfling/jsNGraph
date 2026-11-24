import { Point } from '../util/Geometry';
import { RecordGraphData, RecordNode, RecordPort } from './RecordTypes';

export interface RecordLayoutOptions {
    /** Card width, world px. Default 170. */
    nodeWidth?: number;
    /** Card header height. Default 50. */
    headerHeight?: number;
    /** Height of one row. Default 19. */
    rowHeight?: number;
    /** Space under the last row. Default 6. */
    rowPad?: number;
    /** Horizontal space between columns. Default 120. */
    columnGap?: number;
    /** Vertical space between cards / blocks. Default 22. */
    nodeGap?: number;
    /** Padding inside a group frame. Default 12. */
    groupPad?: number;
    /** Height of a group frame's title bar. Default 22. */
    groupHeader?: number;
    /** Size of a collapsed group box. Defaults 170 × 46. */
    collapsedWidth?: number;
    collapsedHeight?: number;
    /** Distance between the lanes of backward links (under everything). Default 7. */
    laneGap?: number;
    /** Ordering passes; the one with the shortest vertical link span wins. Default 8. */
    passes?: number;
    /** How far a block may move down (world px) to line up with its partners. Default 60. */
    align?: number;
}

export interface PlacedRecord {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    column: number;
    group: string | null;
    /** Row id → row centre y. */
    rows: Map<string, number>;
}

export interface PlacedGroup {
    id: string;
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
    collapsed: boolean;
    /** Member record ids. */
    members: string[];
}

export interface PlacedLink {
    /** Ids of the input links drawn by this route (several when a collapsed group merges them). */
    ids: string[];
    from: RecordPort;
    to: RecordPort;
    /** forward = left→right curve; back = orthogonal detour under everything. */
    kind: 'forward' | 'back';
    points: Point[];
}

export interface RecordLayoutResult {
    records: Map<string, PlacedRecord>;
    groups: Map<string, PlacedGroup>;
    links: PlacedLink[];
    columns: number;
    bounds: {minX: number; minY: number; maxX: number; maxY: number};
}

interface Block {
    /** Expanded group id, collapsed group id, or null for a lone record. */
    group: string | null;
    collapsed: boolean;
    members: string[];
    c0: number;
    c1: number;
    index: number;
}

/**
 * Layout of a record graph (cards with rows, links row → row), left to
 * right. Columns are the longest path from the sources after breaking
 * cycles by DFS (so a recycling loop becomes one backward link). Groups
 * are frames spanning their members' columns; lone records, frames and
 * collapsed groups are blocks packed per column like a skyline, so a frame
 * never covers a foreign card. Ordering passes sort the blocks (and the
 * cards inside) by the mean height of their link partners and keep the
 * pass with the shortest total vertical link span. Pure and deterministic.
 */
export class RecordLayout {

    private static readonly DEFAULTS: Required<RecordLayoutOptions> = {
        nodeWidth: 170,
        headerHeight: 50,
        rowHeight: 19,
        rowPad: 6,
        columnGap: 120,
        nodeGap: 22,
        groupPad: 12,
        groupHeader: 22,
        collapsedWidth: 170,
        collapsedHeight: 46,
        laneGap: 7,
        passes: 8,
        align: 60
    };

    private readonly o: Required<RecordLayoutOptions>;

    public constructor(options: RecordLayoutOptions = {}) {
        this.o = {...RecordLayout.DEFAULTS, ...options};
    }

    public get options(): Readonly<Required<RecordLayoutOptions>> {
        return this.o;
    }

    public cardHeight(node: RecordNode): number {
        return this.o.headerHeight + node.rows.length * this.o.rowHeight + this.o.rowPad;
    }

    public columnX(column: number): number {
        return column * (this.o.nodeWidth + this.o.columnGap);
    }

    public layout(data: RecordGraphData): RecordLayoutResult {
        const o = this.o;
        const nodes = new Map(data.nodes.map((n) => [n.id, n]));
        const order = new Map(data.nodes.map((n, i) => [n.id, i]));
        const links = data.links.filter((l) => {
            const a = nodes.get(l.from.node);
            const b = nodes.get(l.to.node);

            return a !== undefined && b !== undefined && a.rows.some((r) => r.id === l.from.row) && b.rows.some((r) => r.id === l.to.row);
        });
        const column = RecordLayout.columns(data.nodes, links);

        // Groups that exist and have members.
        const groupDefs = new Map((data.groups ?? []).map((g) => [g.id, g]));
        const membersOf = new Map<string, string[]>();

        for (const n of data.nodes) {
            if (n.group !== undefined && groupDefs.has(n.group)) {
                const list = membersOf.get(n.group) ?? [];
                list.push(n.id);
                membersOf.set(n.group, list);
            }
        }

        const groupOf = (id: string): string | null => {
            const g = nodes.get(id)?.group;

            return g !== undefined && membersOf.has(g) ? g : null;
        };
        const collapsed = (g: string | null): boolean => g !== null && groupDefs.get(g)?.collapsed === true;

        // Blocks: one per group (expanded or collapsed), one per lone record.
        const blocks: Block[] = [];
        const blockOf = new Map<string, Block>();
        const seen = new Set<string>();

        for (const n of data.nodes) {
            const g = groupOf(n.id);

            if (g !== null && seen.has(g)) {
                continue;
            }

            const members = g === null ? [n.id] : membersOf.get(g)!;
            const cols = members.map((m) => column.get(m)!);
            const isCollapsed = collapsed(g);
            let c0 = Math.min(...cols);
            let c1 = Math.max(...cols);

            if (isCollapsed) {
                // One column for the box: right of everything that feeds it (inside the group's span),
                // so links into it stay forward.
                const inside = new Set(members);
                let feed = -1;

                for (const l of links) {
                    if (inside.has(l.to.node) && !inside.has(l.from.node)) {
                        feed = Math.max(feed, column.get(l.from.node)!);
                    }
                }
                c0 = Math.min(c1, Math.max(c0, feed + 1));
                c1 = c0;
            }

            const block: Block = {group: g, collapsed: isCollapsed, members, c0, c1, index: blocks.length};

            if (g !== null) {
                seen.add(g);
            }
            blocks.push(block);
            for (const m of members) {
                blockOf.set(m, block);
            }
        }

        const heightOf = (id: string): number => this.cardHeight(nodes.get(id)!);
        const key = (p: RecordPort): string => `${p.node}\u0000${p.row}`;

        // Current row y estimates (from the previous pass).
        let rowY = new Map<string, number>();
        let best: {cost: number; records: Map<string, PlacedRecord>; groups: Map<string, PlacedGroup>} | null = null;
        let prevTop = new Map<Block, number>();
        let prevOwn = new Map<Block, number>();

        for (let pass = 0; pass < Math.max(1, o.passes); pass++) {
            // Partner mean per record and per block.
            const partner = (ids: ReadonlyArray<string>): number | null => {
                const inside = new Set(ids);
                let sum = 0;
                let n = 0;

                for (const l of links) {
                    const a = inside.has(l.from.node);
                    const b = inside.has(l.to.node);

                    if (a === b) {
                        continue;
                    }

                    const y = rowY.get(key(a ? l.to : l.from));

                    if (y !== undefined) {
                        sum += y;
                        n++;
                    }
                }

                return n > 0 ? sum / n : null;
            };

            const sorted = pass === 0
                ? blocks.slice()
                : blocks
                    .map((b) => ({b, k: partner(b.members) ?? prevTop.get(b) ?? 0}))
                    .sort((x, y) => x.k - y.k || x.b.index - y.b.index)
                    .map((x) => x.b);

            const sky = new Map<number, number>();
            const records = new Map<string, PlacedRecord>();
            const groups = new Map<string, PlacedGroup>();
            const tops = new Map<Block, number>();
            const own = new Map<Block, number>();

            for (const b of sorted) {
                let top = -Infinity;

                for (let c = b.c0; c <= b.c1; c++) {
                    const s = sky.get(c);
                    top = Math.max(top, s === undefined ? 0 : s + o.nodeGap);
                }

                if (pass > 0 && o.align > 0) {
                    const p = partner(b.members);
                    const prev = prevTop.get(b);
                    const mine = prevOwn.get(b);

                    if (p !== null && prev !== undefined && mine !== undefined) {
                        const desired = prev + (p - mine);
                        top = Math.max(top, Math.min(desired, top + o.align));
                    }
                }

                let height: number;

                if (b.collapsed) {
                    const g = groupDefs.get(b.group!)!;

                    height = o.collapsedHeight;
                    groups.set(g.id, {
                        id: g.id, label: g.label, x: this.columnX(b.c0) + (o.nodeWidth - o.collapsedWidth) / 2, y: top,
                        w: o.collapsedWidth, h: height, collapsed: true, members: b.members.slice()
                    });
                } else {
                    const inner = b.group !== null ? o.groupHeader + o.groupPad : 0;
                    let stack = 0;

                    for (let c = b.c0; c <= b.c1; c++) {
                        const inCol = b.members.filter((m) => column.get(m) === c);
                        const ranked = pass === 0
                            ? inCol.sort((a, z) => order.get(a)! - order.get(z)!)
                            : inCol
                                .map((m) => ({m, k: partner([m]) ?? records.get(m)?.y ?? rowY.get(m) ?? 0}))
                                .sort((x, y) => x.k - y.k || order.get(x.m)! - order.get(y.m)!)
                                .map((x) => x.m);
                        let y = top + inner;

                        for (const m of ranked) {
                            const node = nodes.get(m)!;
                            const h = heightOf(m);
                            const rows = new Map<string, number>();

                            node.rows.forEach((r, i) => rows.set(r.id, y + o.headerHeight + (i + 0.5) * o.rowHeight));
                            records.set(m, {id: m, x: this.columnX(c), y, w: o.nodeWidth, h, column: c, group: b.group, rows});
                            y += h + o.nodeGap;
                        }
                        stack = Math.max(stack, y - o.nodeGap - top - inner);
                    }

                    height = inner + stack + (b.group !== null ? o.groupPad : 0);

                    if (b.group !== null) {
                        const g = groupDefs.get(b.group)!;

                        groups.set(g.id, {
                            id: g.id, label: g.label, x: this.columnX(b.c0) - o.groupPad, y: top,
                            w: this.columnX(b.c1) - this.columnX(b.c0) + o.nodeWidth + 2 * o.groupPad, h: height,
                            collapsed: false, members: b.members.slice()
                        });
                    }
                }

                for (let c = b.c0; c <= b.c1; c++) {
                    sky.set(c, top + height);
                }
                tops.set(b, top);
            }

            // New row estimates (hidden records report their collapsed box centre).
            const nextY = new Map<string, number>();

            for (const n of data.nodes) {
                const rec = records.get(n.id);

                if (rec !== undefined) {
                    for (const [row, y] of rec.rows) {
                        nextY.set(`${n.id}\u0000${row}`, y);
                    }
                } else {
                    const g = groups.get(groupOf(n.id) ?? '');

                    for (const r of n.rows) {
                        nextY.set(`${n.id}\u0000${r.id}`, g === undefined ? 0 : g.y + g.h / 2);
                    }
                }
            }

            for (const b of blocks) {
                const ys = b.members.flatMap((m) => nodes.get(m)!.rows.map((r) => nextY.get(`${m}\u0000${r.id}`) ?? 0));
                own.set(b, ys.length > 0 ? ys.reduce((a, v) => a + v, 0) / ys.length : tops.get(b)!);
            }

            let cost = 0;

            for (const l of links) {
                if (l.from.node !== l.to.node) {
                    cost += Math.abs((nextY.get(key(l.from)) ?? 0) - (nextY.get(key(l.to)) ?? 0));
                }
            }

            if (best === null || cost < best.cost - 1e-6) {
                best = {cost, records, groups};
            }

            rowY = nextY;
            prevTop = tops;
            prevOwn = own;
        }

        const {records, groups} = best!;
        const result = this.route(links, records, groups, groupOf, collapsed);
        let columns = 0;

        for (const c of column.values()) {
            columns = Math.max(columns, c + 1);
        }

        return {records, groups, links: result.links, columns, bounds: result.bounds};
    }

    /** Endpoints and routes; backward links get their own lane under everything. */
    private route(
        links: ReadonlyArray<{id?: string; from: RecordPort; to: RecordPort}>,
        records: Map<string, PlacedRecord>,
        groups: Map<string, PlacedGroup>,
        groupOf: (id: string) => string | null,
        collapsed: (g: string | null) => boolean
    ): {links: PlacedLink[]; bounds: RecordLayoutResult['bounds']} {
        const o = this.o;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        const grow = (x: number, y: number, w: number, h: number): void => {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
        };

        for (const r of records.values()) {
            grow(r.x, r.y, r.w, r.h);
        }
        for (const g of groups.values()) {
            grow(g.x, g.y, g.w, g.h);
        }
        if (!Number.isFinite(minX)) {
            return {links: [], bounds: {minX: 0, minY: 0, maxX: 0, maxY: 0}};
        }

        const end = (p: RecordPort, side: 'out' | 'in'): {pt: Point; unit: string} | null => {
            const g = groupOf(p.node);

            if (collapsed(g)) {
                const box = groups.get(g!)!;

                return {pt: {x: side === 'out' ? box.x + box.w : box.x, y: box.y + box.h / 2}, unit: `g:${g}`};
            }

            const rec = records.get(p.node);
            const y = rec?.rows.get(p.row);

            if (rec === undefined || y === undefined) {
                return null;
            }

            return {pt: {x: side === 'out' ? rec.x + rec.w : rec.x, y}, unit: `n:${p.node}\u0000${p.row}`};
        };

        const out: PlacedLink[] = [];
        const merged = new Map<string, PlacedLink>();
        let lane = 0;
        const bottom = maxY;

        links.forEach((l, i) => {
            const a = end(l.from, 'out');
            const b = end(l.to, 'in');
            const id = l.id ?? `link${i}`;

            if (a === null || b === null || a.unit === b.unit && a.unit.startsWith('g:')) {
                return;
            }

            const k = `${a.unit}|${b.unit}`;
            const dup = merged.get(k);

            if (dup !== undefined) {
                dup.ids.push(id);
                return;
            }

            let link: PlacedLink;

            if (b.pt.x > a.pt.x + 1) {
                link = {ids: [id], from: l.from, to: l.to, kind: 'forward', points: [a.pt, b.pt]};
            } else {
                const y = bottom + 18 + lane * o.laneGap;
                const stub = 12 + (lane % 4) * 3;

                lane++;
                link = {
                    ids: [id], from: l.from, to: l.to, kind: 'back',
                    points: [a.pt, {x: a.pt.x + stub, y: a.pt.y}, {x: a.pt.x + stub, y}, {x: b.pt.x - stub, y}, {x: b.pt.x - stub, y: b.pt.y}, b.pt]
                };
                grow(b.pt.x - stub, y, a.pt.x - b.pt.x + 2 * stub, 1);
            }

            merged.set(k, link);
            out.push(link);
        });

        return {links: out, bounds: {minX, minY, maxX, maxY}};
    }

    /**
     * Column per record: fixed `column` wins, else the longest path from the
     * sources over the record-level links, with cycles broken by DFS (input
     * order) so a feedback loop does not push everything to the right.
     */
    public static columns(nodes: ReadonlyArray<RecordNode>, links: ReadonlyArray<{from: RecordPort; to: RecordPort}>): Map<string, number> {
        const ids = nodes.map((n) => n.id);
        const known = new Set(ids);
        const adj = new Map<string, string[]>(ids.map((id) => [id, []]));

        for (const l of links) {
            if (l.from.node !== l.to.node && known.has(l.from.node) && known.has(l.to.node)) {
                const list = adj.get(l.from.node)!;

                if (!list.includes(l.to.node)) {
                    list.push(l.to.node);
                }
            }
        }

        // DFS: drop edges into the current stack (back edges).
        const state = new Map<string, 1 | 2>();
        const dag = new Map<string, string[]>(ids.map((id) => [id, []]));
        const hasIn = new Set<string>();

        for (const list of adj.values()) {
            for (const t of list) {
                hasIn.add(t);
            }
        }

        const starts = [...ids.filter((id) => !hasIn.has(id)), ...ids];

        for (const s of starts) {
            if (state.has(s)) {
                continue;
            }

            const stack: {id: string; i: number}[] = [{id: s, i: 0}];

            state.set(s, 1);
            while (stack.length > 0) {
                const top = stack[stack.length - 1]!;
                const next = adj.get(top.id)![top.i++];

                if (next === undefined) {
                    state.set(top.id, 2);
                    stack.pop();
                    continue;
                }
                if (state.get(next) === 1) {
                    continue;   // back edge
                }

                dag.get(top.id)!.push(next);
                if (!state.has(next)) {
                    state.set(next, 1);
                    stack.push({id: next, i: 0});
                }
            }
        }

        // Longest path (Kahn).
        const indeg = new Map<string, number>(ids.map((id) => [id, 0]));

        for (const list of dag.values()) {
            for (const t of list) {
                indeg.set(t, indeg.get(t)! + 1);
            }
        }

        const rank = new Map<string, number>(ids.map((id) => [id, 0]));
        const queue = ids.filter((id) => indeg.get(id) === 0);

        while (queue.length > 0) {
            const id = queue.shift()!;

            for (const t of dag.get(id)!) {
                rank.set(t, Math.max(rank.get(t)!, rank.get(id)! + 1));
                indeg.set(t, indeg.get(t)! - 1);
                if (indeg.get(t) === 0) {
                    queue.push(t);
                }
            }
        }

        for (const n of nodes) {
            if (n.column !== undefined) {
                rank.set(n.id, Math.max(0, Math.round(n.column)));
            }
        }

        return rank;
    }

}
