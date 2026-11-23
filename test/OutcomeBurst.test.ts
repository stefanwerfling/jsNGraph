import { describe, expect, it } from 'vitest';
import { OutcomeBurstLayout as L } from '../src/chart/OutcomeBurstLayout';

const item = (id: string, group: string, probability: number, count = 100, lift = 1) => ({id, group, probability, count, lift});

describe('OutcomeBurstLayout', () => {
    it('puts the positive majority on top and the negative below, strongest at the right', () => {
        const {slots} = L.slots([item('a', 'g', 0.9), item('b', 'g', 0.6), item('c', 'g', 0.2), item('d', 'g', 0.45)], 'probability', 'overview');
        const by = Object.fromEntries(slots.map((s) => [s.id, s]));
        expect(by.a!.side).toBe(0);
        expect(by.a!.angle).toBeLessThan(0);
        expect(by.c!.angle).toBeGreaterThan(0);
        // right = angle near 0: the strongest of each side
        expect(Math.abs(by.a!.angle)).toBeLessThan(Math.abs(by.b!.angle));
        expect(Math.abs(by.c!.angle)).toBeLessThan(Math.abs(by.d!.angle));
        for (const s of slots) {
            expect(Math.abs(s.angle)).toBeGreaterThan(0);
            expect(Math.abs(s.angle)).toBeLessThan(Math.PI);
        }
    });

    it('orders by another metric and spreads a side evenly', () => {
        const {slots} = L.slots([item('a', 'g', 0.9, 10), item('b', 'g', 0.6, 500), item('c', 'g', 0.7, 50)], 'count', 'overview', 0);
        expect(slots.map((s) => s.id)).toEqual(['b', 'c', 'a']);
        expect(slots[0]!.angle).toBeCloseTo(-Math.PI / 6);
        expect(slots[2]!.angle).toBeCloseTo(-Math.PI * 5 / 6);
    });

    it('gives every group its own sector in group mode', () => {
        const {slots, groups} = L.slots([item('a', 'x', 0.9), item('b', 'y', 0.95), item('c', 'x', 0.8), item('d', 'y', 0.1)], 'probability', 'group', 0, 0.1);
        expect(groups.map((g) => `${g.group}${g.side}${g.count}`)).toEqual(['x02', 'y01', 'y11']);
        const top = slots.filter((s) => s.side === 0).map((s) => s.id);
        expect(top).toEqual(['a', 'c', 'b']);
        // the gap: a group break is wider than a slot step
        const ang = Object.fromEntries(slots.map((s) => [s.id, s.angle]));
        expect(Math.abs(ang.b! - ang.c!)).toBeGreaterThan(Math.abs(ang.c! - ang.a!));
    });

    it('scales counts on a log scale with round ends', () => {
        const s = L.scale([12, 90, 3400], 'count');
        expect(s.log).toBe(true);
        expect(s.min).toBe(10);
        expect(s.max).toBe(3400);
        expect(s.ticks).toEqual([100, 1000]);
        expect(L.frac(s, 10)).toBe(0);
        expect(L.frac(s, 3400)).toBe(1);
        expect(L.frac(s, Math.sqrt(10 * 3400))).toBeCloseTo(0.5);
        const p = L.scale([], 'probability');
        expect(L.frac(p, 0.75)).toBeCloseTo(0.5);
        expect(L.scale([1.7, 3.1], 'lift').max).toBe(4);
    });

    it('measures the majority confidence and the strand colours', () => {
        expect(L.confidence(0.2)).toBeCloseTo(0.8);
        expect(L.metric(item('a', 'g', 0.3, 40, 2), 'probability')).toBeCloseTo(0.7);
        expect(L.stops(0.67, 0.1).map((s) => s.positive)).toEqual([true, true, false, false]);
        expect(L.stops(0.67, 0.1)[1]!.at).toBeCloseTo(0.62);
    });

    it('builds a bent strand and a closed tapered ribbon', () => {
        const line = L.strand(0, 0, 0, 10, 110, 0, 0, 0, 10);
        expect(line.length).toBe(22);
        expect(line[0]).toBeCloseTo(10);
        expect(line[20]).toBeCloseTo(110);
        expect(line[21]).toBeCloseTo(0);
        const bent = L.strand(0, 0, 0, 10, 110, 0.1, 0, 0, 10);
        expect(bent[11]).toBeCloseTo(8.25); // middle pushed sideways: swirl × length × (1 − 0.35 t)
        const rib = L.ribbon(line, 4);
        expect(rib.length).toBe(44);
        expect(L.distanceToPath(60, 3, line)).toBeCloseTo(3);
        expect(L.formatCount(1234)).toBe('1.2k');
    });
});

describe('OutcomeBurstLayout edge cases', () => {
    it('scales an empty list without looping', () => {
        const s = L.scale([], 'count');
        expect(s.min).toBe(1);
        expect(s.max).toBe(10);
        expect(L.scale([], 'lift').max).toBeGreaterThan(0);
        expect(L.slots([], 'probability', 'group').slots).toEqual([]);
    });
});
