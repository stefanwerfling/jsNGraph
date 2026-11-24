import { NGraphNodeData, NodeBadge, NodeKind, NodeShape, NodeStatus } from './NGraphTypes';

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
    public image: string | null;
    public badge: string | null;
    public badgeColor: string | null;
    public badges: NodeBadge[] | null;
    public fill: string | null;
    public iconColor: string | null;
    public ring: number;
    public shape: NodeShape;
    public color: string | null;
    public size: number | null;
    public group: string | null;
    public fixed: boolean;

    public x: number;
    public y: number;
    public vx = 0;
    public vy = 0;
    public radius = 22;

    public constructor(data: NGraphNodeData, fallbackX: number, fallbackY: number) {
        this.id = data.id;
        this.label = data.label;
        this.kind = data.kind ?? 'generic';
        this.status = data.status ?? 'ok';
        this.load = GraphNode.clamp01(data.load ?? 0);
        this.ip = data.ip ?? null;
        this.meta = data.meta === undefined || data.meta === null ? null : {...data.meta};
        this.sublabel = data.sublabel ?? null;
        this.pulse = data.pulse ?? false;
        this.image = data.image !== undefined && data.image !== '' ? data.image : null;
        this.badge = GraphNode.badgeText(data.badge);
        this.badgeColor = data.badgeColor ?? null;
        this.badges = !Array.isArray(data.badges) ? null : data.badges.map((badge) => ({...badge}));
        this.fill = data.fill ?? null;
        this.iconColor = data.iconColor ?? null;
        this.ring = data.ring ?? 1;
        this.shape = data.shape ?? 'circle';
        this.color = data.color ?? null;
        this.size = data.size ?? null;
        this.group = data.group ?? null;
        this.applyRadius();
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
            this.meta = patch.meta === null ? null : {...patch.meta};
        }

        if (patch.sublabel !== undefined) {
            this.sublabel = patch.sublabel;
        }

        if (patch.pulse !== undefined) {
            this.pulse = patch.pulse;
        }

        if (patch.image !== undefined) {
            this.image = patch.image !== '' ? patch.image : null;
        }

        if (patch.badge !== undefined) {
            this.badge = GraphNode.badgeText(patch.badge);
        }

        if (patch.badgeColor !== undefined) {
            this.badgeColor = patch.badgeColor;
        }

        if (patch.badges !== undefined) {
            this.badges = Array.isArray(patch.badges) ? patch.badges.map((badge) => ({...badge})) : null;
        }

        if (patch.fill !== undefined) {
            this.fill = patch.fill;
        }

        if (patch.iconColor !== undefined) {
            this.iconColor = patch.iconColor;
        }

        if (patch.ring !== undefined) {
            this.ring = patch.ring;
        }

        if (patch.shape !== undefined) {
            this.shape = patch.shape;
        }

        if (patch.color !== undefined) {
            this.color = patch.color;
        }

        if (patch.size !== undefined) {
            this.size = patch.size;
        }

        if (patch.group !== undefined) {
            this.group = patch.group;
        }

        if (patch.shape !== undefined || patch.size !== undefined) {
            this.applyRadius();
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

    /** Layout/collision radius: explicit size, else the shape's default. */
    private applyRadius(): void {
        if (this.size !== null && this.size > 0) {
            this.radius = this.size;
            return;
        }

        this.radius = this.shape === 'card' ? 30 : this.shape === 'dot' ? 7 : 22;
    }

    /** Badge input → text; '' and 0 mean "no badge". */
    public static badgeText(badge: number | string | null | undefined): string | null {
        if (badge === undefined || badge === null || badge === '' || badge === 0) {
            return null;
        }

        return String(badge);
    }

    private static clamp01(value: number): number {
        return Math.min(1, Math.max(0, value));
    }

}
