import { describe, expect, it } from 'vitest';
import { EdgeLanes } from '../src/model/EdgeLanes';
import { GraphEdge } from '../src/model/GraphEdge';
import { GraphNode } from '../src/model/GraphNode';
import { CanvasRenderer } from '../src/render/CanvasRenderer';

const node = (id: string, x: number, y: number): GraphNode => new GraphNode({id: id, label: id}, x, y);
const edge = (id: string, s: GraphNode, t: GraphNode): GraphEdge => new GraphEdge({id: id, source: s.id, target: t.id}, s, t);

describe('EdgeLanes', () => {
    it('leaves single edges on lane 0 and centres a bundle around it', () => {
        const a = node('a', 0, 0);
        const b = node('b', 200, 0);
        const c = node('c', 0, 200);
        const single = edge('ac', a, c);
        const bundle = [edge('1', a, b), edge('2', a, b), edge('3', a, b)];

        EdgeLanes.assign([single, ...bundle]);

        expect(single.lane).toBe(0);
        expect(bundle.map((e) => e.lane)).toEqual([-1, 0, 1]);
        expect(bundle.map((e) => e.bundle)).toEqual([3, 3, 3]);
        expect(single.bundle).toBe(1);
    });

    it('counts both directions as one bundle; the reversed edge bows to the other side', () => {
        const a = node('a', 0, 0);
        const b = node('b', 200, 0);
        const ab = edge('ab', a, b);
        const ba = edge('ba', b, a);

        EdgeLanes.assign([ab, ba]);

        expect(Math.abs(ab.lane)).toBe(0.5);
        expect(ba.lane).toBe(ab.lane);

        // Same lane value, opposite direction → the apexes land on opposite sides of the line.
        const apexAb = CanvasRenderer.cubicPoint(CanvasRenderer.edgeCurve(ab, 'line', false)!, 0.5);
        const apexBa = CanvasRenderer.cubicPoint(CanvasRenderer.edgeCurve(ba, 'line', false)!, 0.5);

        expect(Math.sign(apexAb.y)).toBe(-Math.sign(apexBa.y));
        expect(Math.abs(apexAb.y)).toBeCloseTo(CanvasRenderer.LANE_SPACING / 2, 5);
    });

    it('re-assigning resets lanes when a bundle shrinks to one edge', () => {
        const a = node('a', 0, 0);
        const b = node('b', 200, 0);
        const e1 = edge('1', a, b);
        const e2 = edge('2', a, b);

        EdgeLanes.assign([e1, e2]);
        EdgeLanes.assign([e1]);

        expect(e1.lane).toBe(0);
        expect(CanvasRenderer.edgeCurve(e1, 'line', true)).toBeNull();
    });

    it('a directed bow ends on the target rim, not its centre', () => {
        const a = node('a', 0, 0);
        const b = node('b', 200, 0);
        const e1 = edge('1', a, b);
        const e2 = edge('2', a, b);

        EdgeLanes.assign([e1, e2]);

        const end = CanvasRenderer.edgeCurve(e1, 'line', true)![3];

        expect(Math.hypot(end.x - b.x, end.y - b.y)).toBeCloseTo(b.radius + 2, 5);
    });
});
