import { GraphEdge } from '../model/GraphEdge';
import { GraphNode } from '../model/GraphNode';

export interface RadialLayoutOptions {
    /** Fraction of the remaining distance covered toward the slot per tick (0..1). */
    easing?: number;
    /** Gap kept between the outermost ring and the canvas edge, in pixels. */
    margin?: number;
    /** Radius of the small circle ring-0 nodes share when there is more than one hub. */
    hubRadius?: number;
    /** Minimum arc length reserved per node on a ring — crowded rings widen to honor it. */
    minArc?: number;
}

const DEFAULTS: Required<RadialLayoutOptions> = {
    easing: 0.12,
    margin: 70,
    hubRadius: 40,
    minArc: 70
};

/**
 * Deterministic hub-and-ring layout: ring 0 sits at the canvas center,
 * higher rings form concentric ELLIPSES around it (a wide canvas spreads
 * its rings wide instead of wasting the horizontal space), nodes keep
 * their input order on the ring. Crowded rings widen horizontally until
 * every node has at least `minArc` of arc. Unlike the force layout
 * nothing ever drifts — each node eases toward its slot and stays there,
 * which makes the picture stable enough to point at ("the coder is the
 * third node top right"). Dragged (`fixed`) nodes are left alone;
 * releasing them eases them back.
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
        const {easing, margin, hubRadius, minArc} = this.options;
        const cx = width / 2;
        const cy = height / 2;
        const rxMax = Math.max(60, width / 2 - margin);
        const ryMax = Math.max(60, height / 2 - margin);

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
            let rx: number;
            let ry: number;

            if (ring === 0) {
                rx = members.length > 1 ? hubRadius : 0;
                ry = rx;
            } else {
                rx = (rxMax * ring) / maxRing;
                ry = (ryMax * ring) / maxRing;

                // Widen a crowded ring (Ramanujan's ellipse-circumference
                // approximation) until every member gets ~minArc of arc —
                // horizontally first, that's where wide canvases have room.
                const needed = members.length * minArc;

                for (let guard = 0; guard < 8 && RadialLayout.circumference(rx, ry) < needed && rx < rxMax; guard++) {
                    rx = Math.min(rxMax, rx * 1.35);
                }
            }

            // Slot angles by EQUAL ARC LENGTH, not equal parameter angle — on a
            // flat ellipse the parametric angle bunches nodes at the sides.
            const angles = RadialLayout.arcUniformAngles(rx, ry, members.length, ring);

            for (let i = 0; i < members.length; i++) {
                const node = members[i];
                const angle = angles[i];

                if (node === undefined || angle === undefined || node.fixed) {
                    continue;
                }

                const tx = cx + Math.cos(angle) * rx;
                const ty = cy + Math.sin(angle) * ry;

                node.x += (tx - node.x) * easing;
                node.y += (ty - node.y) * easing;
                node.vx = 0;
                node.vy = 0;
            }
        }
    }

    /**
     * n parameter-angles whose slots are equally spaced by arc length along
     * the ellipse (rx, ry), starting at 12 o'clock. Even rings are staggered
     * by half a slot so neighboring rings interleave instead of lining up.
     */
    private static arcUniformAngles(rx: number, ry: number, n: number, ring: number): number[] {
        if (n <= 0) {
            return [];
        }

        const SAMPLES = 256;
        const cumulative: number[] = [0];
        let prevX = Math.cos(-Math.PI / 2) * rx;
        let prevY = Math.sin(-Math.PI / 2) * ry;
        let total = 0;

        for (let s = 1; s <= SAMPLES; s++) {
            const angle = -Math.PI / 2 + (s / SAMPLES) * Math.PI * 2;
            const x = Math.cos(angle) * rx;
            const y = Math.sin(angle) * ry;

            total += Math.hypot(x - prevX, y - prevY);
            cumulative.push(total);
            prevX = x;
            prevY = y;
        }

        const stagger = ring % 2 === 0 ? total / n / 2 : 0;
        const angles: number[] = [];
        let cursor = 0;

        for (let i = 0; i < n; i++) {
            const target = ((i / n) * total + stagger) % (total || 1);

            if (target < (cumulative[cursor] ?? 0)) {
                cursor = 0;
            }

            while (cursor < SAMPLES && (cumulative[cursor + 1] ?? total) < target) {
                cursor++;
            }

            angles.push(-Math.PI / 2 + (cursor / SAMPLES) * Math.PI * 2);
        }

        return angles;
    }

    private static circumference(rx: number, ry: number): number {
        const h = ((rx - ry) * (rx - ry)) / ((rx + ry) * (rx + ry) || 1);

        return Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    }

}
