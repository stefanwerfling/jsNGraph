import { GraphEdge } from '../model/GraphEdge';
import { GraphNode } from '../model/GraphNode';

export interface ForceLayoutOptions {
    /** Repulsion strength between any two nodes. */
    repulsion?: number;
    /** Spring stiffness pulling edge-connected nodes together. */
    springStrength?: number;
    /** Resting length of an edge spring, in pixels. */
    springLength?: number;
    /** Pull toward the canvas center, keeps disconnected components from drifting off. */
    centerStrength?: number;
    /** Velocity multiplier applied each tick (0..1), higher = jitterier, lower = sluggish. */
    damping?: number;
    /** Fraction the simulation "temperature" (alpha) cools per tick. 0 = never
     *  cools (runs forever, the V1 behaviour). Default 0.02 (~4 s at 60 fps). */
    alphaDecay?: number;
    /** Below this alpha the simulation stops moving nodes. Default 0.005. */
    alphaMin?: number;
}

const DEFAULTS: Required<ForceLayoutOptions> = {
    repulsion: 5000,
    springStrength: 0.06,
    springLength: 140,
    centerStrength: 0.01,
    damping: 0.85,
    alphaDecay: 0.02,
    alphaMin: 0.005
};

/** Minimum gap enforced between node edges on top of the repulsion force. */
const COLLISION_PADDING = 10;

/** Floor on distance² used for repulsion — avoids a 1/d² blow-up when two
 *  nodes start out (near-)coincident, e.g. from random initial placement. */
const MIN_REPULSION_DIST_SQ = 900;

/** Hard cap on per-tick velocity so a single spike (e.g. sudden overlap)
 *  can't fling a node off-canvas before damping has a chance to act. */
const MAX_SPEED = 40;

/**
 * A small O(n²) force-directed layout: node-node repulsion, edge springs,
 * and gentle centering. O(n²) is fine at network-monitoring scale (a few
 * hundred nodes); this deliberately skips Barnes-Hut/quadtree partitioning
 * to stay dependency-free and simple.
 */
export class ForceLayout {

    private readonly options: Required<ForceLayoutOptions>;
    private alpha = 1;

    public constructor(options: ForceLayoutOptions = {}) {
        this.options = {...DEFAULTS, ...options};
    }

    /** Current temperature, 1 = hot, below alphaMin = settled. */
    public get temperature(): number {
        return this.alpha;
    }

    /**
     * Warm the simulation back up so it moves again — after new data (1),
     * a drag or a resize (a gentle 0.3). Never cools it down.
     */
    public reheat(alpha = 1): void {
        this.alpha = Math.max(this.alpha, Math.min(1, alpha));
    }

    /**
     * Advance the simulation by one tick, mutating node x/y/vx/vy in place.
     * Fixed and actively-dragged nodes are excluded from position updates.
     */
    public tick(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number): void {
        const {springLength, damping, alphaDecay, alphaMin} = this.options;

        if (this.alpha < alphaMin) {
            return;
        }

        // Forces scale with alpha, so the motion dies down instead of
        // oscillating forever between springs, repulsion and collisions.
        const alpha = this.alpha;
        const repulsion = this.options.repulsion * alpha;
        const springStrength = this.options.springStrength * alpha;
        const centerStrength = this.options.centerStrength * alpha;
        this.alpha *= 1 - alphaDecay;
        const cx = width / 2;
        const cy = height / 2;

        for (const node of nodes) {
            if (node.fixed) {
                continue;
            }

            let fx = (cx - node.x) * centerStrength;
            let fy = (cy - node.y) * centerStrength;

            for (const other of nodes) {
                if (other === node) {
                    continue;
                }

                let dx = node.x - other.x;
                let dy = node.y - other.y;
                let distSq = dx * dx + dy * dy;

                if (distSq < 0.01) {
                    dx = Math.random() - 0.5;
                    dy = Math.random() - 0.5;
                    distSq = 0.01;
                }

                const dist = Math.sqrt(distSq);
                const force = repulsion / Math.max(distSq, MIN_REPULSION_DIST_SQ);

                fx += (dx / dist) * force;
                fy += (dy / dist) * force;
            }

            node.vx = ForceLayout.clampSpeed((node.vx + fx) * damping);
            node.vy = ForceLayout.clampSpeed((node.vy + fy) * damping);
        }

        for (const edge of edges) {
            const dx = edge.target.x - edge.source.x;
            const dy = edge.target.y - edge.source.y;
            const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const stretch = dist - springLength;
            const force = stretch * springStrength;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            if (!edge.source.fixed) {
                edge.source.vx += fx;
                edge.source.vy += fy;
            }

            if (!edge.target.fixed) {
                edge.target.vx -= fx;
                edge.target.vy -= fy;
            }
        }

        for (const node of nodes) {
            if (node.fixed) {
                continue;
            }

            node.vx = ForceLayout.clampSpeed(node.vx);
            node.vy = ForceLayout.clampSpeed(node.vy);
            node.x += node.vx;
            node.y += node.vy;
        }

        ForceLayout.resolveCollisions(nodes);
    }

    private static clampSpeed(v: number): number {
        return Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));
    }

    /**
     * Hard-guarantee no two nodes visually overlap, on top of the repulsion
     * force above (which only discourages it). One O(n²) pass is enough at
     * this scale and converges over a few ticks as the sim keeps running.
     */
    private static resolveCollisions(nodes: GraphNode[]): void {
        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];

            if (a === undefined) {
                continue;
            }

            for (let j = i + 1; j < nodes.length; j++) {
                const b = nodes[j];

                if (b === undefined) {
                    continue;
                }

                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const minDist = a.radius + b.radius + COLLISION_PADDING;
                let dist = Math.sqrt(dx * dx + dy * dy);

                if (dist >= minDist) {
                    continue;
                }

                let nx = dx / dist;
                let ny = dy / dist;

                if (dist < 0.01) {
                    nx = Math.random() - 0.5;
                    ny = Math.random() - 0.5;
                    dist = 0.01;
                }

                const overlap = (minDist - dist) / 2;
                const aFixed = a.fixed;
                const bFixed = b.fixed;

                if (!aFixed) {
                    a.x -= nx * overlap * (bFixed ? 2 : 1);
                    a.y -= ny * overlap * (bFixed ? 2 : 1);
                }

                if (!bFixed) {
                    b.x += nx * overlap * (aFixed ? 2 : 1);
                    b.y += ny * overlap * (aFixed ? 2 : 1);
                }
            }
        }
    }

}
