import { Point } from './Geometry';

/** Convex hulls for cluster outlines (J6). */
export class Hull {

    /** Convex hull (Andrew's monotone chain), counter-clockwise, no repeated end point. */
    public static convex(points: ReadonlyArray<Point>): Point[] {
        if (points.length <= 2) {
            return points.map((p) => ({x: p.x, y: p.y}));
        }

        const sorted = [...points].sort((a, b) => (a.x - b.x) || (a.y - b.y));
        const lower: Point[] = [];

        for (const p of sorted) {
            while (lower.length >= 2 && Hull.cross(lower[lower.length - 2] as Point, lower[lower.length - 1] as Point, p) <= 0) {
                lower.pop();
            }

            lower.push(p);
        }

        const upper: Point[] = [];

        for (let i = sorted.length - 1; i >= 0; i--) {
            const p = sorted[i] as Point;

            while (upper.length >= 2 && Hull.cross(upper[upper.length - 2] as Point, upper[upper.length - 1] as Point, p) <= 0) {
                upper.pop();
            }

            upper.push(p);
        }

        lower.pop();
        upper.pop();

        return [...lower, ...upper].map((p) => ({x: p.x, y: p.y}));
    }

    /**
     * Hull grown by `padding` with rounded corners: every hull vertex is
     * replaced by `samples` points on a circle around it and the hull is
     * taken again. Unlike pushing vertices away from the centroid this keeps
     * an even margin on long thin clusters, and it works for 1 or 2 points
     * (a circle / a capsule).
     */
    public static padded(points: ReadonlyArray<Point>, padding: number, samples = 12): Point[] {
        if (points.length === 0) {
            return [];
        }

        const core = Hull.convex(points);

        if (padding <= 0) {
            return core;
        }

        const ring: Point[] = [];

        for (const p of core) {
            for (let i = 0; i < samples; i++) {
                const angle = (i / samples) * Math.PI * 2;
                ring.push({x: p.x + Math.cos(angle) * padding, y: p.y + Math.sin(angle) * padding});
            }
        }

        return Hull.convex(ring);
    }

    private static cross(o: Point, a: Point, b: Point): number {
        return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    }

}
