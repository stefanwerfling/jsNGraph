import { RectSide } from './RectKitTypes';

/**
 * Pure geometry of the RectBoard: anchors on box sides, connector paths,
 * grid snapping and rectangle tests. No DOM, so it is unit-testable and
 * hosts can reuse it (e.g. to place an editor at an edge midpoint).
 */

export interface RectArea {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface RectPoint {
    x: number;
    y: number;
}

/** A connector end: a point, and the box side it leaves (undefined = free point, e.g. the cursor). */
export interface RectAnchorPoint extends RectPoint {
    side?: RectSide;
}

/** Shape of the 'curve' route: control points sit `clamp(dist * factor, min, max)` out along the side normals. */
export interface RectCurveShape {
    factor: number;
    min: number;
    max: number;
}

export class RectBoardGeometry {

    /** Default connector curve: control arm = factor × distance, clamped to [min, max]. */
    public static readonly DEFAULT_CURVE: Readonly<RectCurveShape> = {factor: 0.4, min: 40, max: Infinity};

    /** The four box sides in clockwise order from the top. */
    public static readonly SIDES: readonly RectSide[] = ['top', 'right', 'bottom', 'left'];

    public static center(r: RectArea): RectPoint {
        return {x: r.x + r.w / 2, y: r.y + r.h / 2};
    }

    /** Middle of a box side. */
    public static anchor(r: RectArea, side: RectSide): RectAnchorPoint {
        switch (side) {
            case 'left': return {x: r.x, y: r.y + r.h / 2, side};
            case 'right': return {x: r.x + r.w, y: r.y + r.h / 2, side};
            case 'top': return {x: r.x + r.w / 2, y: r.y, side};
            default: return {x: r.x + r.w / 2, y: r.y + r.h, side};
        }
    }

    /** Outward unit normal of a side; zero for a free point. */
    public static normal(side: RectSide | undefined): RectPoint {
        switch (side) {
            case 'left': return {x: -1, y: 0};
            case 'right': return {x: 1, y: 0};
            case 'top': return {x: 0, y: -1};
            case 'bottom': return {x: 0, y: 1};
            default: return {x: 0, y: 0};
        }
    }

    /** The side of `r` that faces point `p` (ties go horizontal). */
    public static facingSide(r: RectArea, p: RectPoint): RectSide {
        const c = RectBoardGeometry.center(r);
        const dx = p.x - c.x;
        const dy = p.y - c.y;

        if (Math.abs(dx) >= Math.abs(dy)) {
            return dx >= 0 ? 'right' : 'left';
        }

        return dy >= 0 ? 'bottom' : 'top';
    }

    /** Facing sides of two boxes from their relative position. */
    public static autoSides(from: RectArea, to: RectArea): [RectSide, RectSide] {
        return [
            RectBoardGeometry.facingSide(from, RectBoardGeometry.center(to)),
            RectBoardGeometry.facingSide(to, RectBoardGeometry.center(from))
        ];
    }

    /** Where a connector meets `box`: a pinned side, or the side facing `other`. */
    public static endpoint(box: RectArea, side: RectSide | undefined, other: RectArea | RectPoint): RectAnchorPoint {
        if (side !== undefined) {
            return RectBoardGeometry.anchor(box, side);
        }

        const target = 'w' in other ? RectBoardGeometry.center(other) : other;

        return RectBoardGeometry.anchor(box, RectBoardGeometry.facingSide(box, target));
    }

    /** Cubic control points; a free end points at the other end. */
    public static curveControls(a: RectAnchorPoint, b: RectAnchorPoint, shape: RectCurveShape = RectBoardGeometry.DEFAULT_CURVE): [RectPoint, RectPoint] {
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const k = Math.min(Math.max(dist * shape.factor, shape.min), shape.max);
        const ux = dist === 0 ? 0 : (b.x - a.x) / dist;
        const uy = dist === 0 ? 0 : (b.y - a.y) / dist;
        const na = a.side === undefined ? {x: ux, y: uy} : RectBoardGeometry.normal(a.side);
        const nb = b.side === undefined ? {x: -ux, y: -uy} : RectBoardGeometry.normal(b.side);

        return [{x: a.x + na.x * k, y: a.y + na.y * k}, {x: b.x + nb.x * k, y: b.y + nb.y * k}];
    }

    public static curvePath(a: RectAnchorPoint, b: RectAnchorPoint, shape: RectCurveShape = RectBoardGeometry.DEFAULT_CURVE): string {
        const [c1, c2] = RectBoardGeometry.curveControls(a, b, shape);

        return `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
    }

    /** Point at t = 0.5 of the curve — where a label sits. */
    public static curveMidpoint(a: RectAnchorPoint, b: RectAnchorPoint, shape: RectCurveShape = RectBoardGeometry.DEFAULT_CURVE): RectPoint {
        const [c1, c2] = RectBoardGeometry.curveControls(a, b, shape);

        return {
            x: 0.125 * a.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * b.x,
            y: 0.125 * a.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * b.y
        };
    }

    /** Right-angle path between two anchors, bending at the midpoints. */
    public static orthogonalPath(a: RectAnchorPoint, b: RectAnchorPoint): string {
        const fromH = a.side === 'left' || a.side === 'right';
        const toH = b.side === 'left' || b.side === 'right';

        if (fromH && toH) {
            const mx = (a.x + b.x) / 2;
            return `M ${a.x} ${a.y} L ${mx} ${a.y} L ${mx} ${b.y} L ${b.x} ${b.y}`;
        }
        if (!fromH && !toH) {
            const my = (a.y + b.y) / 2;
            return `M ${a.x} ${a.y} L ${a.x} ${my} L ${b.x} ${my} L ${b.x} ${b.y}`;
        }

        const cx = fromH ? b.x : a.x;
        const cy = fromH ? a.y : b.y;
        return `M ${a.x} ${a.y} L ${cx} ${cy} L ${b.x} ${b.y}`;
    }

    /** Round to the grid; step <= 0 only rounds to whole pixels. */
    public static snap(v: number, step: number): number {
        return step > 0 ? Math.round(v / step) * step : Math.round(v);
    }

    /** Normalised rect from two corners. */
    public static fromCorners(a: RectPoint, b: RectPoint): RectArea {
        return {x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y)};
    }

    /** Partial overlap counts. */
    public static overlaps(a: RectArea, b: RectArea): boolean {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    /** `inner` lies fully inside `outer` (edges inclusive). */
    public static contains(outer: RectArea, inner: RectArea): boolean {
        return inner.x >= outer.x && inner.y >= outer.y
            && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
    }

    /** Bounding box of boxes; null when empty. */
    public static bounds(boxes: Iterable<RectArea>): RectArea | null {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const b of boxes) {
            minX = Math.min(minX, b.x);
            minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.w);
            maxY = Math.max(maxY, b.y + b.h);
        }

        return minX === Infinity ? null : {x: minX, y: minY, w: maxX - minX, h: maxY - minY};
    }

}

/** @deprecated use RectBoardGeometry.DEFAULT_CURVE */
export const DEFAULT_CURVE: Readonly<RectCurveShape> = RectBoardGeometry.DEFAULT_CURVE;

/** @deprecated use RectBoardGeometry.SIDES */
export const RECT_SIDES: readonly RectSide[] = RectBoardGeometry.SIDES;
