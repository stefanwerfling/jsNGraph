import { NGraphNodeData, NodeKind, NodeStatus } from './NGraphTypes';

/**
 * Runtime node: the data a caller provided, plus the physics state the
 * force layout mutates each tick (position/velocity/radius).
 */
export class GraphNode {

    public readonly id: string;
    public label: string;
    public kind: NodeKind;
    public status: NodeStatus;
    public load: number;
    public ip: string | null;
    public meta: Record<string, string> | null;
    public sublabel: string | null;
    public pulse: boolean;
    public ring: number;
    public shape: 'circle' | 'card';
    public fixed: boolean;

    public x: number;
    public y: number;
    public vx = 0;
    public vy = 0;
    public radius = 22;

    public constructor(data: NGraphNodeData, fallbackX: number, fallbackY: number) {
        this.id = data.id;
        this.label = data.label;
        this.kind = data.kind;
        this.status = data.status ?? 'ok';
        this.load = GraphNode.clamp01(data.load ?? 0);
        this.ip = data.ip ?? null;
        this.meta = data.meta ?? null;
        this.sublabel = data.sublabel ?? null;
        this.pulse = data.pulse ?? false;
        this.ring = data.ring ?? 1;
        this.shape = data.shape ?? 'circle';

        if (this.shape === 'card') {
            this.radius = 30;
        }
        this.fixed = data.fixed ?? false;
        this.x = data.x ?? fallbackX;
        this.y = data.y ?? fallbackY;
    }

    /**
     * Apply a partial update (e.g. a live load/status change) in place.
     */
    public updateFrom(patch: Partial<NGraphNodeData>): void {
        if (patch.label !== undefined) {
            this.label = patch.label;
        }

        if (patch.kind !== undefined) {
            this.kind = patch.kind;
        }

        if (patch.status !== undefined) {
            this.status = patch.status;
        }

        if (patch.load !== undefined) {
            this.load = GraphNode.clamp01(patch.load);
        }

        if (patch.ip !== undefined) {
            this.ip = patch.ip;
        }

        if (patch.meta !== undefined) {
            this.meta = patch.meta;
        }

        if (patch.sublabel !== undefined) {
            this.sublabel = patch.sublabel;
        }

        if (patch.pulse !== undefined) {
            this.pulse = patch.pulse;
        }

        if (patch.ring !== undefined) {
            this.ring = patch.ring;
        }

        if (patch.shape !== undefined) {
            this.shape = patch.shape;
        }

        if (patch.fixed !== undefined) {
            this.fixed = patch.fixed;
        }

        if (patch.x !== undefined) {
            this.x = patch.x;
        }

        if (patch.y !== undefined) {
            this.y = patch.y;
        }
    }

    private static clamp01(value: number): number {
        return Math.min(1, Math.max(0, value));
    }

}
