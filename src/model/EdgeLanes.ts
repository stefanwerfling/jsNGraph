import { GraphEdge } from './GraphEdge';

/**
 * Parallel edges (several relations between the same two nodes, in either
 * direction) would be drawn exactly on top of each other. `assign` gives
 * each edge of such a bundle its own lane, centred on 0: 2 edges → ±0.5,
 * 3 → -1, 0, 1, … A single edge keeps lane 0 (drawn straight).
 *
 * Lanes count in the pair's canonical direction (lower id → higher id); a
 * reversed edge gets its lane negated, so after the renderer applies it
 * relative to the edge's own direction, A→B and B→A still fan apart.
 * `bundle` (the bundle size) lets the force layout count a bundle as one
 * spring instead of pulling the pair n times as hard.
 */
export class EdgeLanes {

    public static assign(edges: Iterable<GraphEdge>): void {
        const bundles = new Map<string, GraphEdge[]>();

        for (const edge of edges) {
            const a = edge.source.id;
            const b = edge.target.id;
            const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
            const bundle = bundles.get(key);

            edge.lane = 0;
            edge.bundle = 1;

            if (bundle === undefined) {
                bundles.set(key, [edge]);
            } else {
                bundle.push(edge);
            }
        }

        for (const bundle of bundles.values()) {
            if (bundle.length < 2) {
                continue;
            }

            for (let i = 0; i < bundle.length; i++) {
                const edge = bundle[i] as GraphEdge;
                const lane = i - (bundle.length - 1) / 2;

                edge.lane = edge.source.id < edge.target.id ? lane : -lane;
                edge.bundle = bundle.length;
            }
        }
    }

}
