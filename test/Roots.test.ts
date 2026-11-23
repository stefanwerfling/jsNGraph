import { describe, expect, it } from 'vitest';
import { RootsLayout as L } from '../src/chart/RootsLayout';

describe('RootsLayout', () => {
    it('maps years onto the axis', () => {
        expect(L.xOf(1800, 1750, 2000, 0, 1000)).toBe(200);
        expect(L.yearStep(250, 6)).toBe(50);
        expect(L.yearStep(60, 6)).toBe(10);
    });

    it('packs labels into rows without overlap', () => {
        const actors = Array.from({length: 30}, (_, i) => ({id: `a${i}`, year: 1900 + (i % 5), left: 40, right: 40}));
        const {placed, rows} = L.place(actors, {from: 1900, to: 2000, x0: 0, x1: 1000, top: 10, rowH: 20});
        expect(placed.size).toBe(30);
        const byRow = new Map<number, number[]>();
        for (const p of placed.values()) {
            byRow.set(p.row, [...byRow.get(p.row) ?? [], p.x]);
            expect(p.y).toBe(10 + p.row * 20);
            expect(p.row).toBeLessThan(rows);
        }
        for (const xs of byRow.values()) {
            xs.sort((a, b) => a - b);
            for (let i = 1; i < xs.length; i++) {
                expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(80);
            }
        }
    });

    it('lays out bars, counts and shared links', () => {
        const bars = L.bars(4, 0, 400);
        expect(bars[2]).toEqual({x: 200, w: 100, cx: 250});
        expect(L.counts([[0, 1], [1], [1, 1, 3]], 4)).toEqual([1, 3, 0, 1]);
        const links = L.links([{id: 'x', categories: [2, 0]}, {id: 'y', categories: [0, 2, 1]}, {id: 'z', categories: [3]}]);
        expect(links[0]).toEqual({a: 0, b: 2, count: 2, members: ['x', 'y']});
        expect(links).toHaveLength(3);
        expect(L.links([{id: 'y', categories: [0, 2, 1]}], 2)).toEqual([]);
    });

    it('draws strands straight down at both ends and arcs below', () => {
        const c = L.strand(0, 0, 100, 200);
        expect(L.cubicAt(c, 0)).toEqual([0, 0]);
        expect(L.cubicAt(c, 1)).toEqual([100, 200]);
        expect(c[2]).toBe(0);
        expect(c[4]).toBe(100);
        expect(L.sample(c, 4)).toHaveLength(10);
        const q = L.arc(0, 10, 100, 20, 24, 0.1);
        expect(q[3]).toBe(20 + 24 + 10);
        expect(L.quadAt(q, 0.5)[0]).toBeCloseTo(50);
    });

    it('turns years into fan angles: from top-left, counter-clockwise, split at the bottom', () => {
        const top = -Math.PI / 2;
        expect(L.fanAngle(1760, 1760, 1900, 2020, 0)).toBeCloseTo(top);
        expect(L.fanAngle(1900, 1760, 1900, 2020, 0)).toBeCloseTo(top - Math.PI);
        // halfway through the early part = left (pointing to −x)
        const a = L.fanAngle(1830, 1760, 1900, 2020, 0);
        expect(Math.cos(a)).toBeCloseTo(-1);
        const b = L.fanAngle(1960, 1760, 1900, 2020, 0);
        expect(Math.cos(b)).toBeCloseTo(1);
        expect(L.fanAngle(1700, 1760, 1900, 2020, 0)).toBeCloseTo(top);
    });

    it('wraps text and measures distance to a path', () => {
        expect(L.wrap('aa bb cc', 5, (s) => s.length)).toEqual(['aa bb', 'cc']);
        expect(L.wrap('Politics\nLaw', 50, (s) => s.length)).toEqual(['Politics', 'Law']);
        expect(L.distanceToPath(5, 3, [0, 0, 10, 0])).toBeCloseTo(3);
    });
});
