import { describe, expect, it } from 'vitest';
import { AssociationIndex as A } from '../src/chart/AssociationIndex';

const enc = [
    {t: 1, ids: ['a', 'b', 'c']},
    {t: 2, ids: ['a', 'b']},
    {t: 3, ids: ['a', 'b', 'd']},
    {t: 4, ids: ['c', 'd']},
    {t: 5, ids: ['e']}
];

describe('AssociationIndex', () => {
    it('computes the half-weight index', () => {
        expect(A.hwi(3, 0, 0)).toBe(1);
        expect(A.hwi(1, 2, 0)).toBeCloseTo(0.5);
        expect(A.hwi(0, 3, 3)).toBe(0);
        expect(A.hwi(0, 0, 0)).toBe(0);
    });

    it('tallies sightings and co-sightings up to a time', () => {
        const t = A.tally(enc, 3);
        expect(t.seen.get('a')).toEqual({sightings: 3, first: 1, last: 3});
        expect(t.seen.has('e')).toBe(false);
        const all = A.tally([...enc, {t: 6, ids: ['a', 'a', 'b']}]);
        expect(all.seen.get('a')!.sightings).toBe(4);
    });

    it('lists pairs strongest first', () => {
        const pairs = A.pairs(A.tally(enc));
        expect(pairs[0]).toMatchObject({a: 'a', b: 'b', together: 3, onlyA: 0, onlyB: 0, hwi: 1});
        const cd = pairs.find((p) => p.a === 'c' && p.b === 'd')!;
        expect(cd.together).toBe(1);
        expect(cd.hwi).toBeCloseTo(1 / (1 + 0.5 * (1 + 1)));
    });

    it('forms units above a threshold with enough co-sightings', () => {
        const pairs = A.pairs(A.tally(enc));
        expect(A.units(pairs, 0.5)).toEqual([['a', 'b']]);
        expect(A.units(pairs, 0.3, 1)).toEqual([['a', 'b', 'c', 'd']]);
    });

    it('lays out deterministically, associates closer than strangers', () => {
        const pairs = A.pairs(A.tally(enc));
        const ids = ['a', 'b', 'c', 'd', 'e'];
        const p1 = A.layout(ids, pairs, {seed: 3}), p2 = A.layout(ids, pairs, {seed: 3});
        expect(p1.get('c')).toEqual(p2.get('c'));
        const d = (x: string, y: string): number => Math.hypot(p1.get(x)!.x - p1.get(y)!.x, p1.get(x)!.y - p1.get(y)!.y);
        expect(d('a', 'b')).toBeLessThan(d('a', 'e'));
        for (const p of p1.values()) {
            expect(Math.abs(p.x)).toBeLessThanOrEqual(1 + 1e-9);
            expect(Math.abs(p.y)).toBeLessThanOrEqual(1 + 1e-9);
        }
    });

    it('builds a convex hull', () => {
        const h = A.hull([{x: 0, y: 0}, {x: 2, y: 0}, {x: 1, y: 1}, {x: 2, y: 2}, {x: 0, y: 2}]);
        expect(h).toHaveLength(4);
        expect(h.some((p) => p.x === 1 && p.y === 1)).toBe(false);
    });
});
