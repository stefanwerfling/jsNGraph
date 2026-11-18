import { describe, expect, it } from 'vitest';
import { Geometry } from '../src/util/Geometry';
import { Hull } from '../src/util/Hull';

const square = [{x: 0, y: 0}, {x: 10, y: 0}, {x: 10, y: 10}, {x: 0, y: 10}, {x: 5, y: 5}, {x: 3, y: 7}];

describe('Hull', () => {
    it('keeps only the outer points', () => {
        const hull = Hull.convex(square);

        expect(hull).toHaveLength(4);
        expect(hull.map((p) => `${p.x},${p.y}`).sort()).toEqual(['0,0', '0,10', '10,0', '10,10']);
    });

    it('drops collinear points on an edge', () => {
        expect(Hull.convex([{x: 0, y: 0}, {x: 5, y: 0}, {x: 10, y: 0}, {x: 5, y: 5}])).toHaveLength(3);
    });

    it('pads evenly around every member, also for long thin clusters', () => {
        const line = Array.from({length: 20}, (_, i) => ({x: i * 50, y: 0}));
        const padded = Hull.padded(line, 24);

        for (const p of line) {
            expect(Geometry.pointInPolygon(p, padded)).toBe(true);
            expect(Geometry.pointInPolygon({x: p.x, y: 20}, padded)).toBe(true);
            expect(Geometry.pointInPolygon({x: p.x, y: 30}, padded)).toBe(false);
        }

        // The ends are rounded: just past the last member is still inside, far past is not.
        expect(Geometry.pointInPolygon({x: 950 + 20, y: 0}, padded)).toBe(true);
        expect(Geometry.pointInPolygon({x: 950 + 30, y: 0}, padded)).toBe(false);
    });

    it('turns one or two members into a circle or a capsule', () => {
        const single = Hull.padded([{x: 100, y: 100}], 10);

        expect(single.length).toBeGreaterThanOrEqual(8);
        expect(Geometry.pointInPolygon({x: 100, y: 108}, single)).toBe(true);
        expect(Geometry.pointInPolygon({x: 100, y: 112}, single)).toBe(false);

        const pair = Hull.padded([{x: 0, y: 0}, {x: 100, y: 0}], 10);
        expect(Geometry.pointInPolygon({x: 50, y: 8}, pair)).toBe(true);
        expect(Hull.padded([], 10)).toEqual([]);
    });
});
