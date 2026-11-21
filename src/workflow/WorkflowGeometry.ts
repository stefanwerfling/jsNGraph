import { RectAnchorPoint, RectArea, RectBoardGeometry, RectCurveShape, RectPoint } from '../rect/RectBoardGeometry';
import { WorkflowNodeType, WorkflowPortDir, WorkflowPortSpec, WorkflowSide } from './WorkflowTypes';

/** Where one port sits, in world coordinates. */
export interface WorkflowPortPlace extends RectAnchorPoint {
    side: WorkflowSide;
    dir: WorkflowPortDir;
    port: WorkflowPortSpec;
}

export interface WorkflowPath {
    d: string;
    /** Where a "+" button or a label would sit. */
    mid: RectPoint;
}

/** Curve shape of forward connections. */
export const WORKFLOW_CURVE: RectCurveShape = {factor: 0.5, min: 40, max: 220};

/**
 * Pure geometry of the workflow editor: node sizes, port placement and
 * connection paths. No DOM, so it is unit-testable.
 */
export class WorkflowGeometry {

    public static readonly DEFAULT_WIDTH = 200;
    public static readonly MIN_HEIGHT = 64;
    /** Vertical room per port on the left/right sides. */
    public static readonly PORT_GAP = 28;
    /** Horizontal room per port on the top/bottom sides. */
    public static readonly PORT_GAP_H = 44;
    /** How far a backward connection leaves a port before it turns. */
    public static readonly STUB = 28;
    public static readonly CORNER = 10;

    public static portSide(port: WorkflowPortSpec, dir: WorkflowPortDir): WorkflowSide {
        return port.side ?? (dir === 'in' ? 'left' : 'right');
    }

    /** Node size from the type: explicit size wins, otherwise room for the ports. */
    public static nodeSize(type: WorkflowNodeType | undefined): {w: number; h: number} {
        const counts = WorkflowGeometry.sideCounts(type);
        const vertical = Math.max(counts.left, counts.right);
        const horizontal = Math.max(counts.top, counts.bottom);

        return {
            w: type?.width ?? Math.max(WorkflowGeometry.DEFAULT_WIDTH, horizontal * WorkflowGeometry.PORT_GAP_H + 40),
            h: type?.height ?? Math.max(WorkflowGeometry.MIN_HEIGHT, vertical * WorkflowGeometry.PORT_GAP + 16)
        };
    }

    /**
     * Every port of a node placed on its rectangle: ports sharing a side are
     * spread evenly along it (inputs first, then outputs, in declaration order).
     * Keyed `in:<id>` / `out:<id>`.
     */
    public static placePorts(type: WorkflowNodeType | undefined, rect: RectArea): Map<string, WorkflowPortPlace> {
        const bySide = new Map<WorkflowSide, {port: WorkflowPortSpec; dir: WorkflowPortDir}[]>();
        const add = (ports: WorkflowPortSpec[] | undefined, dir: WorkflowPortDir): void => {
            for (const port of ports ?? []) {
                const side = WorkflowGeometry.portSide(port, dir);
                const list = bySide.get(side) ?? [];
                list.push({port, dir});
                bySide.set(side, list);
            }
        };

        add(type?.inputs, 'in');
        add(type?.outputs, 'out');

        const out = new Map<string, WorkflowPortPlace>();

        for (const [side, list] of bySide) {
            list.forEach((entry, i) => {
                const t = (i + 1) / (list.length + 1);
                const horizontal = side === 'left' || side === 'right';
                const x = horizontal ? (side === 'left' ? rect.x : rect.x + rect.w) : rect.x + rect.w * t;
                const y = horizontal ? rect.y + rect.h * t : (side === 'top' ? rect.y : rect.y + rect.h);

                out.set(`${entry.dir}:${entry.port.id}`, {x, y, side, dir: entry.dir, port: entry.port});
            });
        }

        return out;
    }

    /**
     * Path of a connection from `a` (an output) to `b` (an input, or the
     * cursor while drafting). Forward right→left connections are a cubic
     * curve; when the target lies behind the source, the path leaves the
     * port, detours around both nodes with rounded corners and enters from
     * the left — a curve would cut straight through the nodes.
     */
    public static connectionPath(a: RectAnchorPoint, b: RectAnchorPoint, aRect?: RectArea, bRect?: RectArea): WorkflowPath {
        const stub = WorkflowGeometry.STUB;
        const backward = a.side === 'right' && b.side === 'left' && b.x < a.x + stub * 2
            && aRect !== undefined && bRect !== undefined;

        if (!backward) {
            return {
                d: RectBoardGeometry.curvePath(a, b, WORKFLOW_CURVE),
                mid: RectBoardGeometry.curveMidpoint(a, b, WORKFLOW_CURVE)
            };
        }

        const x1 = a.x + stub;
        const x2 = b.x - stub;
        const aBottom = aRect.y + aRect.h;
        const bBottom = bRect.y + bRect.h;
        let yMid: number;

        if (aBottom + stub <= bRect.y) {
            yMid = (aBottom + bRect.y) / 2;      // target clearly below: run between them
        } else if (bBottom + stub <= aRect.y) {
            yMid = (bBottom + aRect.y) / 2;      // target clearly above
        } else {
            yMid = Math.max(aBottom, bBottom) + stub * 1.5;  // overlapping rows: go under both
        }

        const points = [
            {x: a.x, y: a.y}, {x: x1, y: a.y}, {x: x1, y: yMid},
            {x: x2, y: yMid}, {x: x2, y: b.y}, {x: b.x, y: b.y}
        ];

        return {d: WorkflowGeometry.roundedPath(points, WorkflowGeometry.CORNER), mid: {x: (x1 + x2) / 2, y: yMid}};
    }

    /**
     * Top-left corner for a new node of `size` attached to the port at
     * `place`: one gap out along the port's side, centred on the port, then
     * snapped and pushed along the side (down for left/right ports, right
     * for top/bottom ports) until it overlaps none of `obstacles`.
     */
    public static placeNear(place: RectAnchorPoint, size: {w: number; h: number}, obstacles: RectArea[], grid = 0, gap = 80): RectPoint {
        let x: number;
        let y: number;

        switch (place.side) {
            case 'left':
                x = place.x - gap - size.w;
                y = place.y - size.h / 2;
                break;
            case 'top':
                x = place.x - size.w / 2;
                y = place.y - gap - size.h;
                break;
            case 'bottom':
                x = place.x - size.w / 2;
                y = place.y + gap;
                break;
            default:
                x = place.x + gap;
                y = place.y - size.h / 2;
        }

        x = RectBoardGeometry.snap(x, grid);
        y = RectBoardGeometry.snap(y, grid);

        const vertical = place.side === 'top' || place.side === 'bottom';
        const step = vertical ? size.w + 40 : size.h + 40;
        const pad = 10;

        for (let i = 0; i < 50; i++) {
            const box = {x: x - pad, y: y - pad, w: size.w + pad * 2, h: size.h + pad * 2};

            if (!obstacles.some((o) => RectBoardGeometry.overlaps(box, o))) {
                break;
            }
            if (vertical) {
                x = RectBoardGeometry.snap(x + step, grid);
            } else {
                y = RectBoardGeometry.snap(y + step, grid);
            }
        }

        return {x, y};
    }

    /** "1 item" / "3 items" — the text of a connection's item count. */
    public static itemsLabel(items: number): string {
        return `${items} ${items === 1 ? 'item' : 'items'}`;
    }

    /** Polyline with rounded corners (radius clamped to half of the shorter neighbour segment). */
    public static roundedPath(points: RectPoint[], radius: number): string {
        const first = points[0];

        if (first === undefined) {
            return '';
        }

        let d = `M ${first.x} ${first.y}`;

        for (let i = 1; i < points.length; i++) {
            const p = points[i]!;
            const prev = points[i - 1]!;
            const next = points[i + 1];

            if (next === undefined) {
                d += ` L ${p.x} ${p.y}`;
                break;
            }

            const inLen = Math.hypot(p.x - prev.x, p.y - prev.y);
            const outLen = Math.hypot(next.x - p.x, next.y - p.y);
            const r = Math.min(radius, inLen / 2, outLen / 2);

            if (r <= 0) {
                d += ` L ${p.x} ${p.y}`;
                continue;
            }

            const sx = p.x - ((p.x - prev.x) / inLen) * r;
            const sy = p.y - ((p.y - prev.y) / inLen) * r;
            const ex = p.x + ((next.x - p.x) / outLen) * r;
            const ey = p.y + ((next.y - p.y) / outLen) * r;

            d += ` L ${sx} ${sy} Q ${p.x} ${p.y} ${ex} ${ey}`;
        }

        return d;
    }

    private static sideCounts(type: WorkflowNodeType | undefined): Record<WorkflowSide, number> {
        const counts: Record<WorkflowSide, number> = {left: 0, right: 0, top: 0, bottom: 0};

        for (const p of type?.inputs ?? []) {
            counts[WorkflowGeometry.portSide(p, 'in')]++;
        }
        for (const p of type?.outputs ?? []) {
            counts[WorkflowGeometry.portSide(p, 'out')]++;
        }

        return counts;
    }

}
