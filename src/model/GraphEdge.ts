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
    /** Whether `animated` came from the data (true) or is the default. */
    public animatedExplicit: boolean;
    public kind: string | null;
    public directed: boolean | null;
    public dashed: boolean | number[] | null;
    public label: string | null;
    public color: string | null;
    public width: number | null;
    /**
     * Lane among edges between the same two nodes (set by EdgeLanes): 0 for a
     * single edge, else ±0.5, ±1, … — the renderer bends lane ≠ 0 apart.
     */
    public lane = 0;
    /** Number of edges between this edge's two nodes (1 = no parallels). */
    public bundle = 1;
    /** Phase offset (0..1) so multiple animated edges don't pulse in lockstep. */
    public readonly dashPhase: number = Math.random();

    public constructor(data: NGraphEdgeData, source: GraphNode, target: GraphNode) {
        this.id = data.id;
        this.source = source;
        this.target = target;
        this.load = GraphEdge.clamp01(data.load ?? 0);
        this.animated = data.animated ?? true;
        this.animatedExplicit = data.animated !== undefined;
        this.kind = data.kind ?? null;
        this.directed = data.directed ?? null;
        this.dashed = data.dashed ?? null;
        this.label = data.label ?? null;
        this.color = data.color ?? null;
        this.width = data.width ?? null;
    }

    public updateFrom(patch: Partial<NGraphEdgeData>): void {
        if (patch.load !== undefined) {
            this.load = GraphEdge.clamp01(patch.load);
        }

        if (patch.animated !== undefined) {
            this.animated = patch.animated;
            this.animatedExplicit = true;
        }

        if (patch.kind !== undefined) {
            this.kind = patch.kind;
        }

        if (patch.directed !== undefined) {
            this.directed = patch.directed;
        }

        if (patch.dashed !== undefined) {
            this.dashed = patch.dashed;
        }

        if (patch.label !== undefined) {
            this.label = patch.label;
        }

        if (patch.color !== undefined) {
            this.color = patch.color;
        }

        if (patch.width !== undefined) {
            this.width = patch.width;
        }
    }

    private static clamp01(value: number): number {
        return Math.min(1, Math.max(0, value));
    }

}
