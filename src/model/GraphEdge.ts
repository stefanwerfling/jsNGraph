import { GraphNode } from './GraphNode';
import { NGraphEdgeData } from './NGraphTypes';

/**
 * Runtime edge: resolved node references (not just ids) plus animation phase
 * for the traffic-dot effect.
 */
export class GraphEdge {

    public readonly id: string;
    public source: GraphNode;
    public target: GraphNode;
    public load: number;
    public animated: boolean;
    /** Phase offset (0..1) so multiple animated edges don't pulse in lockstep. */
    public readonly dashPhase: number = Math.random();

    public constructor(data: NGraphEdgeData, source: GraphNode, target: GraphNode) {
        this.id = data.id;
        this.source = source;
        this.target = target;
        this.load = GraphEdge.clamp01(data.load ?? 0);
        this.animated = data.animated ?? true;
    }

    public updateFrom(patch: Partial<NGraphEdgeData>): void {
        if (patch.load !== undefined) {
            this.load = GraphEdge.clamp01(patch.load);
        }

        if (patch.animated !== undefined) {
            this.animated = patch.animated;
        }
    }

    private static clamp01(value: number): number {
        return Math.min(1, Math.max(0, value));
    }

}
