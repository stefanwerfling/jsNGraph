import { describe, expect, it } from 'vitest';
import { IsoRoute as R } from '../src/iso/IsoRoute';

const steps = (path: Array<{x: number; y: number}>): boolean =>
    path.every((t, i) => i === 0 || Math.abs(t.x - path[i - 1]!.x) + Math.abs(t.y - path[i - 1]!.y) === 1);

describe('IsoRoute', () => {
    it('routes a shortest path with at most one turn on a free grid', () => {
        const p = R.route({x: 0, y: 0}, {x: 4, y: 3});
        expect(p[0]).toEqual({x: 0, y: 0});
        expect(p[p.length - 1]).toEqual({x: 4, y: 3});
        expect(p).toHaveLength(8);
        expect(steps(p)).toBe(true);
        expect(R.corners(p)).toHaveLength(3);
    });

    it('goes round occupied tiles but may end on them', () => {
        const blocked = new Set(['2,0', '4,0']);
        const p = R.route({x: 0, y: 0}, {x: 4, y: 0}, [], {blocked});
        expect(p.some((t) => t.x === 2 && t.y === 0)).toBe(false);
        expect(p[p.length - 1]).toEqual({x: 4, y: 0});
        expect(steps(p)).toBe(true);
    });

    it('passes through waypoints in order', () => {
        const p = R.route({x: 0, y: 0}, {x: 4, y: 0}, [{x: 2, y: 3}]);
        expect(p.some((t) => t.x === 2 && t.y === 3)).toBe(true);
        expect(steps(p)).toBe(true);
        expect(new Set(p.map(R.key)).size).toBe(p.length);
    });

    it('handles equal ends and walls without a way through', () => {
        expect(R.route({x: 1, y: 1}, {x: 1, y: 1})).toEqual([{x: 1, y: 1}]);
        // a closed ring of blocked tiles still gets crossed (at a cost) instead of failing
        const ring = new Set<string>();
        for (let x = -2; x <= 2; x++) {
            for (let y = -2; y <= 2; y++) {
                if (Math.max(Math.abs(x), Math.abs(y)) === 2) {
                    ring.add(`${x},${y}`);
                }
            }
        }
        const p = R.route({x: 0, y: 0}, {x: 5, y: 0}, [], {blocked: ring, margin: 3});
        expect(p[p.length - 1]).toEqual({x: 5, y: 0});
        expect(steps(p)).toBe(true);
    });

    it('measures polylines and finds points along them', () => {
        const line = R.centres([{x: 0, y: 0}, {x: 3, y: 0}, {x: 3, y: 2}]);
        expect(line).toEqual([0.5, 0.5, 3.5, 0.5, 3.5, 2.5]);
        expect(R.measure(line)).toBe(5);
        expect(R.at(line, 0.5)).toEqual({u: 3, v: 0.5, du: 1, dv: 0});
        expect(R.atDistance(line, 4)).toEqual({u: 3.5, v: 1.5, du: 0, dv: 1});
        expect(R.atDistance(line, 99)).toMatchObject({u: 3.5, v: 2.5});
        expect(R.pathData(line)).toBe('M0.5 0.5L3.5 0.5L3.5 2.5');
        const a = R.arrow({u: 1, v: 0, du: 1, dv: 0}, 0.2, 0.2);
        expect(a.map((n) => Math.round(n * 100) / 100)).toEqual([1, 0, 0.8, 0.1, 0.8, -0.1]);
    });
});
