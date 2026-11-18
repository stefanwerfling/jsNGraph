export type NeighborDirection = 'both' | 'out' | 'in';

interface EdgeLike {
    source: {id: string};
    target: {id: string};
}

/**
 * Pure graph queries over the runtime edge set. Kept separate from NGraph
 * so they are testable without a canvas.
 */
export class GraphQuery {

    /**
     * Every node id within `depth` hops of `startId` (the start included),
     * following edges in `direction` ('out' = source→target). depth 0 is
     * just the start node. An unknown start id yields an empty set.
     */
    public static neighborhood(
        startId: string,
        edges: Iterable<EdgeLike>,
        depth = 1,
        direction: NeighborDirection = 'both',
        knownIds?: ReadonlySet<string> | ReadonlyMap<string, unknown>
    ): Set<string> {
        if (knownIds !== undefined && !knownIds.has(startId)) {
            return new Set();
        }

        const adjacency = GraphQuery.adjacency(edges, direction);

        const seen = new Set<string>([startId]);
        let frontier = [startId];

        for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
            const next: string[] = [];

            for (const id of frontier) {
                for (const neighbor of adjacency.get(id) ?? []) {
                    if (!seen.has(neighbor)) {
                        seen.add(neighbor);
                        next.push(neighbor);
                    }
                }
            }

            frontier = next;
        }

        return seen;
    }

    /** Hop distance from `startId` to every reachable node (undirected), up to maxDepth. */
    public static hopDistances(startId: string, edges: Iterable<EdgeLike>, maxDepth = Infinity): Map<string, number> {
        const adjacency = GraphQuery.adjacency(edges, 'both');
        const distances = new Map<string, number>([[startId, 0]]);
        let frontier = [startId];

        for (let hop = 1; hop <= maxDepth && frontier.length > 0; hop++) {
            const next: string[] = [];

            for (const id of frontier) {
                for (const neighbor of adjacency.get(id) ?? []) {
                    if (!distances.has(neighbor)) {
                        distances.set(neighbor, hop);
                        next.push(neighbor);
                    }
                }
            }

            frontier = next;
        }

        return distances;
    }

    private static adjacency(edges: Iterable<EdgeLike>, direction: NeighborDirection): Map<string, string[]> {
        const adjacency = new Map<string, string[]>();
        const link = (from: string, to: string): void => {
            const list = adjacency.get(from);

            if (list === undefined) {
                adjacency.set(from, [to]);
            } else {
                list.push(to);
            }
        };

        for (const edge of edges) {
            if (direction !== 'in') {
                link(edge.source.id, edge.target.id);
            }

            if (direction !== 'out') {
                link(edge.target.id, edge.source.id);
            }
        }

        return adjacency;
    }

}
