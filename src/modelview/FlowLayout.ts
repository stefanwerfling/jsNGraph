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

    public apply(nodes: ModelNode[], flows: FlowRef[]): void {
        if (nodes.length === 0) {
            return;
        }

        const ranks = FlowLayout.computeRanks(nodes, flows);

        // Group node references by rank, preserving input order within a rank
        // so the picture is stable across runs.
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
