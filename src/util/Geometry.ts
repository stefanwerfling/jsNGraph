/**
 * Axis-aligned rectangle in whatever space the caller works in (world or screen).
 */
export interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface Point {
    x: number;
    y: number;
}

/**
 * Small pure geometry helpers shared by hit-testing, lasso selection and
 * viewport culling. Pure functions so they are unit-testable without a DOM.
 */
export class Geometry {

    /** Distance from p to the segment a–b. */
    public static distToSegment(p: Point, a: Point, b: Point): number {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;

        if (len2 === 0) {
            return Math.hypot(p.x - a.x, p.y - a.y);
        }

        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));

        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    }

    /** Even-odd ray cast: is p inside the (implicitly closed) polygon? */
    public static pointInPolygon(p: Point, polygon: ReadonlyArray<Point>): boolean {
        let inside = false;

        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i] as Point;
            const b = polygon[j] as Point;

            if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
                inside = !inside;
            }
        }

        return inside;
    }

    public static boundsOfPoints(points: ReadonlyArray<Point>): Bounds | null {
        if (points.length === 0) {
            return null;
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const p of points) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }

        return {minX: minX, minY: minY, maxX: maxX, maxY: maxY};
    }

    public static intersects(a: Bounds, b: Bounds): boolean {
        return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
    }

    public static expand(b: Bounds, by: number): Bounds {
        return {minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by};
    }

}
