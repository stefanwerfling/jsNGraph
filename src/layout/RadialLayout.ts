import { GraphEdge } from '../model/GraphEdge';
import { GraphNode } from '../model/GraphNode';

export interface RadialLayoutOptions {
    /** Fraction of the remaining distance covered toward the slot per tick (0..1). */
    easing?: number;
    /** Gap kept between the outermost ring and the canvas edge, in pixels. */
    margin?: number;
    /** Radius of the small circle ring-0 nodes share when there is more than one hub. */
    hubRadius?: number;
}

const DEFAULTS: Required<RadialLayoutOptions> = {
    easing: 0.12,
    margin: 70,
    hubRadius: 40
};

/**
 * Deterministic hub-and-ring layout: ring 0 sits at the canvas center,
 * higher rings form concentric circles around it, nodes keep their input
 * order on the ring. Unlike the force layout nothing ever drifts — each
 * node eases toward its slot and stays there, which makes the picture
 * stable enough to point at ("the coder is the third node top right").
 * Dragged (`fixed`) nodes are left alone; releasing them eases them back.
 */
export class RadialLayout {

    private readonly options: Required<RadialLayoutOptions>;

    public constructor(options: RadialLayoutOptions = {}) {
        this.options = {...DEFAULTS, ...options};
    }

    /**
     * Advance one tick: ease every non-fixed node toward its ring slot.
     * The edges parameter exists for interface parity with ForceLayout —
     * radial slots are independent of the wiring.
     */
    public tick(nodes: GraphNode[], _edges: GraphEdge[], width: number, height: number): void {
        const {easing, margin, hubRadius} = this.options;
        const cx = width / 2;
        const cy = height / 2;
        const maxRadius = Math.max(60, Math.min(width, height) / 2 - margin);

        const rings = new Map<number, GraphNode[]>();
        let maxRing = 1;

        for (const node of nodes) {
            const ring = Math.max(0, node.ring);
            const members = rings.get(ring);

            if (members === undefined) {
                rings.set(ring, [node]);
            } else {
                members.push(node);
            }

            maxRing = Math.max(maxRing, ring);
        }

        for (const [ring, members] of rings) {
            const radius = ring === 0
                ? (members.length > 1 ? hubRadius : 0)
                : (maxRadius * ring) / maxRing;

            for (let i = 0; i < members.length; i++) {
                const node = members[i];

                if (node === undefined || node.fixed) {
                    continue;
                }

                // Start at 12 o'clock; stagger odd rings by half a slot so
                // neighboring rings interleave instead of lining up.
                const stagger = ring % 2 === 1 ? 0 : Math.PI / Math.max(1, members.length);
                const angle = -Math.PI / 2 + (i / Math.max(1, members.length)) * Math.PI * 2 + stagger;
                const tx = cx + Math.cos(angle) * radius;
                const ty = cy + Math.sin(angle) * radius;

                node.x += (tx - node.x) * easing;
                node.y += (ty - node.y) * easing;
                node.vx = 0;
                node.vy = 0;
            }
        }
    }

}
