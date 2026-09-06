import { GraphEdge } from '../model/GraphEdge';
import { GraphNode } from '../model/GraphNode';

export interface LayeredLayoutOptions {
    /** Fraction of the remaining distance covered toward the slot per tick (0..1). */
    easing?: number;
    /** Horizontal gap kept between the outer columns and the canvas edge. */
    marginX?: number;
    /** Vertical gap kept between a column's ends and the canvas edge. */
    marginY?: number;
    /** Maximum vertical distance between two nodes in a column, in pixels. */
    maxSpacing?: number;
}

const DEFAULTS: Required<LayeredLayoutOptions> = {
    easing: 0.12,
    marginX: 120,
    marginY: 48,
    maxSpacing: 84
};

/**
 * Sugiyama-style layered layout: node.ring is the COLUMN (0 = leftmost),
 * columns are evenly spread left-to-right, nodes stack vertically inside
 * their column. Within a column nodes are ordered by the barycenter of
 * their neighbors in the previous column (one classic crossing-reduction
 * pass), which keeps edge crossings low without a full Sugiyama solver.
 * Deterministic, eased settling, dragged (`fixed`) nodes untouched — the
 * n8n/LangGraph-style arrangement for directed flows.
 */
export class LayeredLayout {

    private readonly options: Required<LayeredLayoutOptions>;

    public constructor(options: LayeredLayoutOptions = {}) {
        this.options = {...DEFAULTS, ...options};
    }

    public tick(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number): void {
        const {easing, marginX, marginY, maxSpacing} = this.options;

        const columns = new Map<number, GraphNode[]>();
        let maxRing = 0;

        for (const node of nodes) {
            const ring = Math.max(0, node.ring);
            const members = columns.get(ring);

            if (members === undefined) {
                columns.set(ring, [node]);
            } else {
                members.push(node);
            }

            maxRing = Math.max(maxRing, ring);
        }

        const orderedRings = [...columns.keys()].sort((a, b) => a - b);
        const indexInColumn = new Map<string, number>();

        for (let c = 0; c < orderedRings.length; c++) {
            const ring = orderedRings[c];

            if (ring === undefined) {
                continue;
            }

            let members = columns.get(ring) ?? [];

            if (c > 0) {
                members = LayeredLayout.barycenterOrder(members, edges, indexInColumn);
                columns.set(ring, members);
            }

            for (let i = 0; i < members.length; i++) {
                const node = members[i];

                if (node !== undefined) {
                    indexInColumn.set(node.id, i);
                }
            }
        }

        for (const ring of orderedRings) {
            const members = columns.get(ring) ?? [];
            const tx = maxRing === 0
                ? width / 2
                : marginX + ((width - 2 * marginX) * ring) / maxRing;
            const spacing = members.length <= 1
                ? 0
                : Math.min(maxSpacing, (height - 2 * marginY) / (members.length - 1));

            for (let i = 0; i < members.length; i++) {
                const node = members[i];

                if (node === undefined || node.fixed) {
                    continue;
                }

                const ty = height / 2 + (i - (members.length - 1) / 2) * spacing;

                node.x += (tx - node.x) * easing;
                node.y += (ty - node.y) * easing;
                node.vx = 0;
                node.vy = 0;
            }
        }
    }

    /**
     * Order a column by the average position of each node's neighbors in
     * the previous column; nodes without such neighbors keep their input
     * order after the anchored ones (stable, deterministic).
     */
    private static barycenterOrder(members: GraphNode[], edges: GraphEdge[],
        previousIndex: Map<string, number>): GraphNode[] {
        const scored = members.map((node, inputIndex) => {
            const neighborIndexes: number[] = [];

            for (const edge of edges) {
                const other = edge.source.id === node.id
                    ? edge.target
                    : edge.target.id === node.id ? edge.source : null;

                if (other !== null && previousIndex.has(other.id)) {
                    neighborIndexes.push(previousIndex.get(other.id) ?? 0);
                }
            }

            const score = neighborIndexes.length > 0
                ? neighborIndexes.reduce((s, i) => s + i, 0) / neighborIndexes.length
                : Number.POSITIVE_INFINITY;

            return {node: node, inputIndex: inputIndex, score: score};
        });

        scored.sort((a, b) => a.score - b.score || a.inputIndex - b.inputIndex);

        return scored.map((s) => s.node);
    }

}
