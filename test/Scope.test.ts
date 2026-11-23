import { describe, expect, it } from 'vitest';
import { ScopeGeometry } from '../src/chart/ScopeGeometry';

describe('ScopeGeometry', () => {
    it('maps bearings clockwise from north and back', () => {
        const east = ScopeGeometry.toPlane(90, 10);
        expect(east.x).toBeCloseTo(10);
        expect(east.y).toBeCloseTo(0);
        const back = ScopeGeometry.fromPlane(ScopeGeometry.toPlane(250, 7));
        expect(back.bearing).toBeCloseTo(250);
        expect(back.range).toBeCloseTo(7);
    });

    it('measures how far the beam has moved past a bearing', () => {
        expect(ScopeGeometry.sweepAge(350, 10)).toBe(20);
        expect(ScopeGeometry.sweepAge(10, 350)).toBe(340);
    });

    it('clusters by single link and drops singletons', () => {
        const pts = [{x: 0, y: 0}, {x: 1, y: 0}, {x: 2, y: 0}, {x: 10, y: 10}, {x: 20, y: 20}, {x: 20.5, y: 20}];
        const groups = ScopeGeometry.cluster(pts, 1.2).map((g) => g.sort((a, b) => a - b));
        expect(groups).toHaveLength(2);
        expect(groups).toContainEqual([0, 1, 2]);
        expect(groups).toContainEqual([4, 5]);
    });

    it('builds a hull and a loop that keeps its distance', () => {
        const pts = [{x: 0, y: 0}, {x: 4, y: 0}, {x: 4, y: 3}, {x: 0, y: 3}, {x: 2, y: 1}];
        expect(ScopeGeometry.hull(pts)).toHaveLength(4);

        for (const set of [pts, [{x: 1, y: 1}], [{x: 0, y: 0}, {x: 5, y: 0}]]) {
            const loop = ScopeGeometry.loop(set, 2);
            expect(loop.length).toBeGreaterThan(8);
            for (const p of loop) {
                const nearest = Math.min(...set.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
                expect(nearest).toBeGreaterThan(2 - 1e-6);
            }
        }
    });

    it('gives the same irregular blob for the same seed', () => {
        const a = ScopeGeometry.blob(ScopeGeometry.hash('bird-1'));
        expect(a).toEqual(ScopeGeometry.blob(ScopeGeometry.hash('bird-1')));
        expect(a).not.toEqual(ScopeGeometry.blob(ScopeGeometry.hash('bird-2')));
        expect(Math.min(...a)).toBeGreaterThanOrEqual(0.55);
        expect(Math.max(...a)).toBeLessThanOrEqual(1);
    });
});
