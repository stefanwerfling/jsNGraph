import { describe, expect, it } from 'vitest';
import { StreamData, StreamLayout } from '../src/chart/StreamLayout';

const range = (n: number): number[] => Array.from({length: n}, (_, i) => i);

function data(values: number[][][], n: number): StreamData {
    return {
        x: range(n),
        layers: values[0]!.map((_, i) => ({id: `l${i}`, label: `L${i}`})),
        panels: values.map((v, i) => ({id: `p${i}`, values: v}))
    };
}

describe('StreamLayout.smooth', () => {
    it('interpolates linearly without bandwidth and is 0 outside the data', () => {
        const out = StreamLayout.smooth([0, 1, 2], [0, 10, 0], [-1, 0, 0.5, 1, 1.5, 3], 0);
        expect(Array.from(out)).toEqual([0, 0, 5, 10, 5, 0]);
    });

    it('keeps the level of dense data and tapers beyond it', () => {
        const x = range(41);
        const v = x.map(() => 5);
        const out = StreamLayout.smooth(x, v, [-10, 0, 20, 40, 50], 1.5);
        expect(out[2]).toBeCloseTo(5, 3);          // middle: the level
        expect(out[1]).toBeGreaterThan(2);         // edge: about half
        expect(out[1]).toBeLessThan(3.5);
        expect(out[0]).toBeLessThan(1e-6);         // far outside: gone
        expect(out[4]).toBeLessThan(1e-6);
    });
});

describe('StreamLayout.insideOut', () => {
    it('puts early peaks inside and balances both sides', () => {
        const s = [
            [9, 1, 1, 1],   // peaks first
            [1, 9, 1, 1],
            [1, 1, 9, 1],
            [1, 1, 1, 9]
        ];
        const order = StreamLayout.insideOut(s);
        expect(order).toHaveLength(4);
        expect(new Set(order)).toEqual(new Set([0, 1, 2, 3]));
        // the earliest peak sits next to the middle, the latest ones at the edges
        const pos = (i: number): number => Math.abs(order.indexOf(i) - 1.5);
        expect(pos(0)).toBeLessThan(pos(3));
    });
});

describe('StreamLayout.layout', () => {
    const d = data([[[1, 2, 3, 2, 1], [2, 2, 2, 2, 2], [0, 1, 4, 1, 0]]], 5);

    it('centres the silhouette and stacks layers without gaps', () => {
        const r = new StreamLayout({bandwidth: 0}).layout(d);
        const p = r.panels[0]!;

        expect(p.min).toBeCloseTo(-p.max);
        for (let s = 0; s < r.xs.length; s++) {
            for (let k = 1; k < r.order.length; k++) {
                expect(p.lower[r.order[k]!]![s]).toBeCloseTo(p.upper[r.order[k - 1]!]![s]!);
            }
            const bottom = p.lower[r.order[0]!]![s]!;
            const top = p.upper[r.order[r.order.length - 1]!]![s]!;
            expect(bottom).toBeCloseTo(-top);
        }
    });

    it('stacks on zero and stretches to 100 %', () => {
        const zero = new StreamLayout({bandwidth: 0, offset: 'zero'}).layout(d).panels[0]!;
        expect(zero.min).toBe(0);
        expect(zero.max).toBeCloseTo(9);  // 3 + 2 + 4 at x = 2

        const expand = new StreamLayout({bandwidth: 0, offset: 'expand'}).layout(d);
        const e = expand.panels[0]!;
        const top = expand.order[expand.order.length - 1]!;
        for (let s = 0; s < expand.xs.length; s++) {
            expect(e.upper[top]![s]).toBeCloseTo(1);
        }
    });

    it('keeps a single steady layer flat with wiggle, centred on zero', () => {
        const flat = data([[[3, 3, 3, 3, 3]]], 5);
        const r = new StreamLayout({bandwidth: 0, offset: 'wiggle'}).layout(flat);
        const p = r.panels[0]!;
        for (let s = 0; s < r.xs.length; s++) {
            expect(p.lower[0]![s]).toBeCloseTo(-1.5);
            expect(p.upper[0]![s]).toBeCloseTo(1.5);
        }
    });

    it('reduces wiggle compared to the silhouette for a growing bottom layer', () => {
        // a layer that grows pushes the silhouette's other bands around; wiggle keeps them calmer
        const grow = data([[[1, 2, 4, 8, 16], [3, 3, 3, 3, 3]]], 5);
        const slope = (offset: 'wiggle' | 'silhouette'): number => {
            const r = new StreamLayout({bandwidth: 0, offset, order: 'given'}).layout(grow);
            const mid = r.panels[0]!.lower[1]!;
            let sum = 0;
            for (let s = 1; s < mid.length; s++) {
                sum += Math.abs(mid[s]! - mid[s - 1]!);
            }
            return sum;
        };
        expect(slope('wiggle')).toBeLessThan(slope('silhouette'));
    });

    it('treats hidden layers as zero and uses one order for all panels', () => {
        const two = data([[[1, 1, 1], [5, 5, 5]], [[9, 9, 9], [1, 1, 1]]], 3);
        const r = new StreamLayout({bandwidth: 0, order: 'insideOut', hidden: new Set(['l1'])}).layout(two);
        expect(r.panels).toHaveLength(2);
        for (const p of r.panels) {
            for (let s = 0; s < r.xs.length; s++) {
                expect(p.upper[1]![s]! - p.lower[1]![s]!).toBeCloseTo(0);
            }
        }
    });

    it('tapers the domain when smoothing and finds the layer under a point', () => {
        const r = new StreamLayout({bandwidth: 1}).layout(d);
        expect(r.domain.min).toBeLessThan(0);
        expect(r.domain.max).toBeGreaterThan(4);

        const p = r.panels[0]!;
        const f = StreamLayout.sampleAt(r.xs, 2);
        for (const li of [0, 1, 2]) {
            const mid = (StreamLayout.at(p.lower[li]!, f) + StreamLayout.at(p.upper[li]!, f)) / 2;
            expect(StreamLayout.layerAt(r, 0, 2, mid)).toBe(li);
        }
        expect(StreamLayout.layerAt(r, 0, 2, p.max + 1)).toBe(-1);
        expect(StreamLayout.layerAt(r, 5, 2, 0)).toBe(-1);
    });

    it('finds the nearest data x and the median step', () => {
        expect(StreamLayout.nearest([0, 10, 20], 14)).toBe(1);
        expect(StreamLayout.medianStep([0, 1, 2, 10])).toBe(1);
        expect(StreamLayout.medianStep([5])).toBe(1);
    });
});
