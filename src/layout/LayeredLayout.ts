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
    /**
     * Number of barycenter ordering sweeps across the columns. Sweeps
     * alternate direction (forward = each column ordered against the one to
     * its left, backward = against the one to its right); more sweeps reduce
     * crossings further on deeper flows. Clamped to >= 1.
     */
    sweeps?: number;
}

const DEFAULTS: Required<LayeredLayoutOptions> = {
    easing: 0.12,
    marginX: 120,
    marginY: 48,
    maxSpacing: 84,
    sweeps: 4
};

/**
 * Sugiyama-style layered layout: node.ring is the COLUMN (0 = leftmost),
 * columns are evenly spread left-to-right, nodes stack vertically inside
 * their column. Within a column nodes are ordered by the barycenter of
 * their neighbors in the adjacent column, swept back and forth across the
 * columns (the classic iterative crossing-reduction) so deeper flows settle
 * to a low-crossing arrangement without a full Sugiyama solver.
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
        const sweeps = Math.max(1, Math.floor(this.options.sweeps));

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
        const adjacency = LayeredLayout.buildAdjacency(nodes, edges);

        // Position of every node within its own column; kept in sync as the
        // sweeps reorder columns so each ordering pass reads current indexes.
        const posIndex = new Map<string, number>();

        const reindex = (ring: number): void => {
            const members = columns.get(ring) ?? [];

            for (let i = 0; i < members.length; i++) {
                const node = members[i];

                if (node !== undefined) {
                    posIndex.set(node.id, i);
                }
            }
        };

        for (const ring of orderedRings) {
            reindex(ring);
        }

        const orderAgainst = (ring: number, referenceRing: number): void => {
            const members = columns.get(ring) ?? [];
            const referenceMembers = columns.get(referenceRing) ?? [];
            const referenceIds = new Set(referenceMembers.map((node) => node.id));
            const ordered = LayeredLayout.barycenterOrder(members, adjacency, posIndex, referenceIds);

            columns.set(ring, ordered);
            reindex(ring);
        };

        for (let s = 0; s < sweeps; s++) {
            if (s % 2 === 0) {
                for (let c = 1; c < orderedRings.length; c++) {
                    const ring = orderedRings[c];
                    const referenceRing = orderedRings[c - 1];

                    if (ring !== undefined && referenceRing !== undefined) {
                        orderAgainst(ring, referenceRing);
                    }
                }
            } else {
                for (let c = orderedRings.length - 2; c >= 0; c--) {
                    const ring = orderedRings[c];
                    const referenceRing = orderedRings[c + 1];

                    if (ring !== undefined && referenceRing !== undefined) {
                        orderAgainst(ring, referenceRing);
                    }
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

    /** Undirected id → neighbor-ids map, so repeated sweeps avoid rescanning every edge per node. */
    private static buildAdjacency(nodes: GraphNode[], edges: GraphEdge[]): Map<string, string[]> {
        const adjacency = new Map<string, string[]>();

        for (const node of nodes) {
            adjacency.set(node.id, []);
        }

        for (const edge of edges) {
            adjacency.get(edge.source.id)?.push(edge.target.id);
            adjacency.get(edge.target.id)?.push(edge.source.id);
        }

        return adjacency;
    }

    /**
     * Order a column by the average position of each node's neighbors in the
     * reference (adjacent) column. Nodes without such a neighbor keep their
     * current position (their input index is the fallback score), so they
     * stay put across sweeps rather than drifting to the end — keeping the
     * iteration stable and deterministic.
     */
    private static barycenterOrder(members: GraphNode[], adjacency: Map<string, string[]>,
        posIndex: Map<string, number>, referenceIds: Set<string>): GraphNode[] {
        const scored = members.map((node, inputIndex) => {
            const neighbors = adjacency.get(node.id) ?? [];
            let sum = 0;
            let count = 0;

            for (const neighborId of neighbors) {
                if (referenceIds.has(neighborId)) {
                    sum += posIndex.get(neighborId) ?? 0;
                    count++;
                }
            }

            const score = count > 0 ? sum / count : inputIndex;

            return {node: node, inputIndex: inputIndex, score: score};
        });

        scored.sort((a, b) => a.score - b.score || a.inputIndex - b.inputIndex);

        return scored.map((s) => s.node);
    }

}