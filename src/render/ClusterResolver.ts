import { NGraphCluster, NGraphClusterEdge } from '../model/NGraphTypes';
import type { RenderCluster, RenderClusterEdge, RenderClusters } from './CanvasRenderer';

/** What the resolver needs to know about a member node. */
export interface ClusterMember {
    x: number;
    y: number;
    radius: number;
}

/**
 * Turns the host's clusters into drawable discs: centre (given, or the
 * centroid of the visible members), size, world extent and color, plus
 * the aggregated edges between them. Clusters without a position and
 * without visible members are dropped, and so are edges to them.
 */
export class ClusterResolver {

    public static resolve(
        clusters: ReadonlyArray<NGraphCluster>,
        edges: ReadonlyArray<NGraphClusterEdge>,
        member: (id: string) => ClusterMember | null,
        colorFor: (clusterId: string) => string
    ): RenderClusters {
        const byId = new Map<string, RenderCluster>();

        for (const cluster of clusters) {
            const members: ClusterMember[] = [];

            for (const id of cluster.nodeIds ?? []) {
                const m = member(id);

                if (m !== null) {
                    members.push(m);
                }
            }

            let x = cluster.x;
            let y = cluster.y;

            if (x === undefined || y === undefined) {
                if (members.length === 0) {
                    continue;
                }

                x = members.reduce((sum, m) => sum + m.x, 0) / members.length;
                y = members.reduce((sum, m) => sum + m.y, 0) / members.length;
            }

            let radius = cluster.radius ?? Infinity;

            if (cluster.radius === undefined && members.length > 0) {
                radius = 0;

                for (const m of members) {
                    radius = Math.max(radius, Math.hypot(m.x - x, m.y - y) + m.radius);
                }
            }

            byId.set(cluster.id, {
                id: cluster.id,
                x: x,
                y: y,
                size: cluster.size ?? cluster.nodeIds?.length ?? 0,
                radius: radius,
                color: cluster.color ?? colorFor(cluster.id),
                label: cluster.label ?? null
            });
        }

        const out: RenderClusterEdge[] = [];

        for (const edge of edges) {
            const source = byId.get(edge.source);
            const target = byId.get(edge.target);

            if (source !== undefined && target !== undefined && source !== target) {
                out.push({source: source, target: target, weight: edge.weight ?? 1});
            }
        }

        return {discs: [...byId.values()].sort((a, b) => b.size - a.size), edges: out};
    }

}
