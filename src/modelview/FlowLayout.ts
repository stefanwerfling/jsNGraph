import { ModelNode } from './ModelNode';

export interface FlowLayoutOptions {
    /** Horizontal gap between blocks that share a rank. Default 40. */
    laneGap?: number;
    /** Vertical gap between consecutive ranks. Default 72. */
    rankGap?: number;
}

interface FlowRef {
    source: string;
    target: string;
}

/**
 * Deterministic top-down flow layout. Modules are ranked by their longest
 * path from a source (so a residual/skip edge spanning several ranks never
 * pulls its target up next to its source), ranks stack vertically, and
 * blocks sharing a rank sit side by side centered on x = 0.
 *
 * Longest-path ranking is computed by edge relaxation capped at V iterations:
 * on a DAG it converges to the true longest path; a feedback cycle simply
 * stops growing at the cap instead of looping forever. x/y are block centers.
 */
export class FlowLayout {

    private readonly laneGap: number;
    private readonly rankGap: number;

    public constructor(options: FlowLayoutOptions = {}) {
        this.laneGap = options.laneGap ?? 40;
        this.rankGap = options.rankGap ?? 72;
    }

    /**
     * `clusterOf` returns each node's outermost open-group id (or '' for the
     * backbone). When given, nodes of the same group are kept together as a
     * vertical column pushed to one side, while backbone nodes stay centered
     * on x = 0 — so a branch's group frame no longer overlaps outside nodes.
     */
    public apply(nodes: ModelNode[], flows: FlowRef[], clusterOf: (node: ModelNode) => string = (): string => ''): void {
        if (nodes.length === 0) {
            return;
        }

        const ranks = FlowLayout.computeRanks(nodes, flows);
        const byRank = new Map<number, ModelNode[]>();

        for (const node of nodes) {
            node.rank = ranks.get(node.id) ?? 0;

            let row = byRank.get(node.rank);

            if (row === undefined) {
                row = [];
                byRank.set(node.rank, row);
            }

            row.push(node);
        }

        const orderedRanks = [...byRank.keys()].sort((a, b) => a - b);
        let cursorY = 0;

        for (const rank of orderedRanks) {
            const row = byRank.get(rank)!;

            // Keep same-group nodes contiguous within the rank.
            row.sort((a, b) => clusterOf(a).localeCompare(clusterOf(b)));

            const rowHeight = Math.max(...row.map((n) => n.h));
            const totalWidth = row.reduce((sum, n) => sum + n.w, 0) + this.laneGap * (row.length - 1);
            let cursorX = -totalWidth / 2;

            row.forEach((node, index) => {
                node.lane = index;

                if (!node.pinned) {
                    node.x = cursorX + node.w / 2;
                    node.y = cursorY + rowHeight / 2;
                }

                cursorX += node.w + this.laneGap;
            });

            cursorY += rowHeight + this.rankGap;
        }

        const clustered = nodes.some((node) => !node.pinned && clusterOf(node) !== '');

        if (clustered) {
            this.separateClusters(nodes, byRank, orderedRanks, clusterOf);
        }
    }

    /**
     * Iteratively pull each open group into its own column: every rank is
     * packed into cluster-runs placed at their column's running centre, then
     * shifted so the rank's backbone nodes stay centred on 0. Column centres
     * are re-averaged each pass, so a side branch drifts off to one side and
     * its frame clears the backbone. Deterministic (no randomness).
     */
    private separateClusters(nodes: ModelNode[], byRank: Map<number, ModelNode[]>,
        orderedRanks: number[], clusterOf: (node: ModelNode) => string): void {
        const members = new Map<string, ModelNode[]>();

        for (const node of nodes) {
            const cluster = clusterOf(node);

            if (cluster === '' || node.pinned) {
                continue;
            }

            let list = members.get(cluster);

            if (list === undefined) {
                list = [];
                members.set(cluster, list);
            }

            list.push(node);
        }

        const colX = new Map<string, number>();
        const recompute = (): void => {
            for (const [cluster, list] of members) {
                colX.set(cluster, list.reduce((sum, n) => sum + n.x, 0) / list.length);
            }
        };

        recompute();

        for (let iteration = 0; iteration < 12; iteration++) {
            for (const rank of orderedRanks) {
                this.packRank(byRank.get(rank)!.filter((n) => !n.pinned), clusterOf, colX);
            }

            recompute();
        }
    }

    /** Place one rank's cluster-runs at their desired centres, resolve overlap, anchor backbone to 0. */
    private packRank(row: ModelNode[], clusterOf: (node: ModelNode) => string, colX: Map<string, number>): void {
        if (row.length === 0) {
            return;
        }

        interface Item {cluster: string; run: ModelNode[]; width: number; desired: number; center: number}

        const items: Item[] = [];
        let i = 0;

        while (i < row.length) {
            const cluster = clusterOf(row[i]!);
            let j = i;

            while (j < row.length && clusterOf(row[j]!) === cluster) {
                j++;
            }

            const run = row.slice(i, j);
            const width = run.reduce((sum, n) => sum + n.w, 0) + this.laneGap * (run.length - 1);
            const mean = run.reduce((sum, n) => sum + n.x, 0) / run.length;

            items.push({cluster: cluster, run: run, width: width, desired: cluster === '' ? mean : (colX.get(cluster) ?? 0), center: 0});
            i = j;
        }

        items.sort((a, b) => a.desired - b.desired);

        // Place centres left to right, pushing right only on overlap. Different
        // clusters get a wider gap so a side column's frame clears the backbone.
        const clusterGap = this.laneGap + 48;
        let prevRight = -Infinity;

        for (const item of items) {
            let center = item.desired;

            if (center - item.width / 2 < prevRight + clusterGap) {
                center = prevRight + clusterGap + item.width / 2;
            }

            item.center = center;
            prevRight = center + item.width / 2;
        }

        // Shift the whole rank so its backbone nodes stay centred on 0 (a rank
        // with no backbone keeps its cluster columns where they landed).
        const backbone = items.filter((item) => item.cluster === '');
        const shift = backbone.length > 0
            ? -backbone.reduce((sum, item) => sum + item.center, 0) / backbone.length
            : 0;

        for (const item of items) {
            let x = item.center + shift - item.width / 2;

            for (const node of item.run) {
                node.x = x + node.w / 2;
                x += node.w + this.laneGap;
            }
        }
    }

    /**
     * Longest-path rank per node id. Sources (no incoming edge) rank 0.
     * Dangling flow endpoints (referencing an unknown node) are ignored.
     */
    public static computeRanks(nodes: ModelNode[], flows: FlowRef[]): Map<string, number> {
        const rank = new Map<string, number>();
        const known = new Set<string>();

        for (const node of nodes) {
            rank.set(node.id, 0);
            known.add(node.id);
        }

        const edges = flows.filter((flow) => known.has(flow.source) && known.has(flow.target));

        // Relax every edge up to V times. A DAG settles in at most its longest
        // path length (< V); the cap bounds work if the graph has a cycle.
        for (let iteration = 0; iteration < nodes.length; iteration++) {
            let changed = false;

            for (const edge of edges) {
                const next = (rank.get(edge.source) ?? 0) + 1;

                if (next > (rank.get(edge.target) ?? 0)) {
                    rank.set(edge.target, next);
                    changed = true;
                }
            }

            if (!changed) {
                break;
            }
        }

        return rank;
    }

}
