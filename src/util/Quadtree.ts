import { Bounds, Geometry } from './Geometry';

export type { Bounds };

export interface QuadtreePoint<T> {
    x: number;
    y: number;
    payload: T;
}

interface QuadNode<T> {
    bounds: Bounds;
    depth: number;
    points: QuadtreePoint<T>[];
    children: [QuadNode<T>, QuadNode<T>, QuadNode<T>, QuadNode<T>] | null;
}

/**
 * Region quadtree over (x, y, payload) points: O(log n) nearest-point,
 * radius and rectangle queries. Used for hit-testing and viewport culling
 * once a graph has more than a few hundred nodes, where a linear scan per
 * pointer move becomes a measurable hot path.
 *
 * The tree is static: build it from a snapshot of positions and rebuild
 * when they change (`Quadtree.build`). Points outside the root bounds are
 * dropped by `add`, so prefer `build`, which sizes the root to fit.
 */
export class Quadtree<T> {

    private static readonly MAX_POINTS_PER_NODE = 16;

    private static readonly MAX_DEPTH = 12;

    private readonly root: QuadNode<T>;
    private count = 0;

    public constructor(bounds: Bounds) {
        this.root = {bounds: {...bounds}, depth: 0, points: [], children: null};
    }

    /** Build a tree whose root bounds enclose every point. */
    public static build<T>(points: Iterable<QuadtreePoint<T>>): Quadtree<T> {
        const list = [...points];
        const bounds = Quadtree.boundsOf(list);
        const tree = new Quadtree<T>(bounds);

        for (const point of list) {
            tree.add(point);
        }

        return tree;
    }

    /** Bounding box of the points, padded by 1 so no point sits on a degenerate edge. */
    public static boundsOf(points: ReadonlyArray<{x: number; y: number}>): Bounds {
        if (points.length === 0) {
            return {minX: 0, minY: 0, maxX: 1, maxY: 1};
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

        return {minX: minX - 1, minY: minY - 1, maxX: maxX + 1, maxY: maxY + 1};
    }

    public get size(): number {
        return this.count;
    }

    /** Insert a point. Returns false (and ignores it) when it lies outside the root bounds. */
    public add(point: QuadtreePoint<T>): boolean {
        if (!Quadtree.inside(this.root.bounds, point.x, point.y)) {
            return false;
        }

        Quadtree.insert(this.root, point);
        this.count++;
        return true;
    }

    /** The point closest to (x, y) within maxDistance, or null. */
    public nearest(x: number, y: number, maxDistance = Infinity): {point: QuadtreePoint<T>; distance: number} | null {
        let bestDist = maxDistance;
        let best: QuadtreePoint<T> | null = null;
        const stack: QuadNode<T>[] = [this.root];

        while (stack.length > 0) {
            const node = stack.pop() as QuadNode<T>;

            if (Quadtree.rectDist(node.bounds, x, y) > bestDist) {
                continue;
            }

            if (node.children === null) {
                for (const p of node.points) {
                    const d = Math.hypot(p.x - x, p.y - y);

                    if (d <= bestDist) {
                        bestDist = d;
                        best = p;
                    }
                }

                continue;
            }

            for (const child of node.children) {
                stack.push(child);
            }
        }

        return best === null ? null : {point: best, distance: bestDist};
    }

    /** Every point within `radius` of (x, y), unordered. */
    public queryRadius(x: number, y: number, radius: number): QuadtreePoint<T>[] {
        const result: QuadtreePoint<T>[] = [];
        const r2 = radius * radius;
        const stack: QuadNode<T>[] = [this.root];

        while (stack.length > 0) {
            const node = stack.pop() as QuadNode<T>;

            if (Quadtree.rectDist(node.bounds, x, y) > radius) {
                continue;
            }

            if (node.children === null) {
                for (const p of node.points) {
                    const dx = p.x - x;
                    const dy = p.y - y;

                    if (dx * dx + dy * dy <= r2) {
                        result.push(p);
                    }
                }

                continue;
            }

            for (const child of node.children) {
                stack.push(child);
            }
        }

        return result;
    }

    /** Every point inside the rectangle (inclusive), unordered. */
    public queryRect(rect: Bounds): QuadtreePoint<T>[] {
        const result: QuadtreePoint<T>[] = [];
        const stack: QuadNode<T>[] = [this.root];

        while (stack.length > 0) {
            const node = stack.pop() as QuadNode<T>;

            if (!Geometry.intersects(node.bounds, rect)) {
                continue;
            }

            if (node.children === null) {
                for (const p of node.points) {
                    if (Quadtree.inside(rect, p.x, p.y)) {
                        result.push(p);
                    }
                }

                continue;
            }

            for (const child of node.children) {
                stack.push(child);
            }
        }

        return result;
    }

    private static insert<T>(node: QuadNode<T>, point: QuadtreePoint<T>): void {
        let current = node;

        while (current.children !== null) {
            current = Quadtree.childFor(current, point.x, point.y);
        }

        current.points.push(point);

        if (current.points.length > Quadtree.MAX_POINTS_PER_NODE && current.depth < Quadtree.MAX_DEPTH) {
            Quadtree.split(current);
        }
    }

    /** The child quadrant owning (x, y). Ties on the midline go right/down, so every point has exactly one owner. */
    private static childFor<T>(node: QuadNode<T>, x: number, y: number): QuadNode<T> {
        const children = node.children as [QuadNode<T>, QuadNode<T>, QuadNode<T>, QuadNode<T>];
        const midX = (node.bounds.minX + node.bounds.maxX) / 2;
        const midY = (node.bounds.minY + node.bounds.maxY) / 2;
        const index = (x >= midX ? 1 : 0) + (y >= midY ? 2 : 0);

        return children[index] as QuadNode<T>;
    }

    private static split<T>(node: QuadNode<T>): void {
        const {minX, minY, maxX, maxY} = node.bounds;
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        const depth = node.depth + 1;

        node.children = [
            {bounds: {minX: minX, minY: minY, maxX: midX, maxY: midY}, depth: depth, points: [], children: null},
            {bounds: {minX: midX, minY: minY, maxX: maxX, maxY: midY}, depth: depth, points: [], children: null},
            {bounds: {minX: minX, minY: midY, maxX: midX, maxY: maxY}, depth: depth, points: [], children: null},
            {bounds: {minX: midX, minY: midY, maxX: maxX, maxY: maxY}, depth: depth, points: [], children: null}
        ];

        const points = node.points;
        node.points = [];

        for (const p of points) {
            Quadtree.insert(Quadtree.childFor(node, p.x, p.y), p);
        }
    }

    private static inside(b: Bounds, x: number, y: number): boolean {
        return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
    }

    private static rectDist(b: Bounds, x: number, y: number): number {
        const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
        const dy = y < b.minY ? b.minY - y : y > b.maxY ? y - b.maxY : 0;

        return Math.hypot(dx, dy);
    }

}
