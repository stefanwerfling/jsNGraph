import { describe, expect, it } from 'vitest';
import { SkylineGeometry as G } from '../src/widget/SkylineGeometry';

describe('SkylineGeometry', () => {
    it('converts dates and weekdays in UTC', () => {
        expect(G.dayOf('1970-01-02')).toBe(1);
        expect(G.dateOf(G.dayOf('2024-02-29'))).toBe('2024-02-29');
        expect(G.weekday(G.dayOf('2026-11-24'))).toBe(2); // a Tuesday
        expect(G.weekday(G.dayOf('2026-03-29'))).toBe(0); // DST change day, still a Sunday
        expect(G.dayOfYear('2026-12-31')).toBe(364);
    });

    it('lays out every date on week columns and weekday rows', () => {
        const g = G.grid([{date: '2026-01-07', value: 5, category: 'x'}], {from: '2026-01-01', to: '2026-01-31'});
        expect(g.cells).toHaveLength(31);
        // 1 Jan 2026 is a Thursday: row 4 of a Sunday week, column 0
        expect(g.cells[0]).toMatchObject({col: 0, row: 4, value: 0});
        expect(g.cells.find((c) => c.date === '2026-01-07')).toMatchObject({col: 1, row: 3, value: 5, category: 'x'});
        expect(g.cols).toBe(5);
        expect(g.months).toEqual([{year: 2026, month: 0, col: 0}]);
        const mon = G.grid([], {from: '2026-01-01', to: '2026-01-04', weekStart: 1});
        expect(mon.cells.map((c) => c.row)).toEqual([3, 4, 5, 6]);
        // default range: 365 days up to the last data day
        expect(G.grid([{date: '2026-06-30', value: 1}]).cells).toHaveLength(365);
    });

    it('turns the grid for the four views and orders back to front', () => {
        const views = [0, 1, 2, 3] as const;
        const corners = views.map((v) => G.place(0, 0, 10, 7, v));
        expect(corners).toEqual([{a: 0, b: 0}, {a: 6, b: 0}, {a: 9, b: 6}, {a: 0, b: 9}]);
        for (const v of views) {
            const {na, nb} = G.extent(10, 7, v);
            const all = [];
            for (let c = 0; c < 10; c++) {
                for (let r = 0; r < 7; r++) {
                    const p = G.place(c, r, 10, 7, v);
                    expect(p.a).toBeGreaterThanOrEqual(0);
                    expect(p.a).toBeLessThan(na);
                    expect(p.b).toBeLessThan(nb);
                    all.push(p);
                }
            }
            expect(new Set(all.map((p) => `${p.a},${p.b}`)).size).toBe(70);
        }
        const o = G.order([{a: 2, b: 2}, {a: 0, b: 1}, {a: 1, b: 0}]);
        expect(o.map((p) => p.a + p.b)).toEqual([1, 1, 4]);
    });

    it('projects boxes with their three visible faces', () => {
        const b = G.box(0, 0, 0, 10, 10, 0);
        // top face corners at height 10
        expect(b.top).toEqual([0, -10, 10, -5, 0, 0, -10, -5]);
        // left face lies on b = 1, right face on a = 1
        expect(b.left.slice(0, 4)).toEqual([-10, 5, 0, 10]);
        expect(b.right.slice(0, 4)).toEqual([0, 10, 10, 5]);
    });

    it('scales heights against a quantile and finds levels', () => {
        const vals = [0, 1, 2, 3, 4, 100];
        const lin = G.heightScale(vals, 'linear', 0.8);
        expect(lin(0)).toBe(0);
        expect(lin(100)).toBe(1);
        expect(lin(2)).toBeCloseTo(2 / G.quantile([1, 2, 3, 4, 100], 0.8));
        const log = G.heightScale(vals, 'log', 1);
        expect(log(100)).toBeCloseTo(1);
        expect(log(1)).toBeCloseTo(Math.log(2) / Math.log(101));
        const lv = G.levels([1, 2, 3, 4, 5, 6, 7, 8]);
        expect([0, 1, 3, 5, 8].map(lv)).toEqual([0, 1, 2, 3, 4]);
        expect(G.heightScale([])(5)).toBe(1);
    });

    it('colours by season in both hemispheres', () => {
        expect(G.seasonColor('2026-01-15')).toBe(G.seasonColor('2026-01-20'));
        expect(G.seasonColor('2026-07-15')).not.toBe(G.seasonColor('2026-01-15'));
        expect(G.seasonColor('2026-07-15', 'south')).toBe(G.seasonColor('2026-01-14'));
        expect(G.byLevel('#336699', 4)).toBe('rgb(51, 102, 153)');
    });
});

describe('Donut and radar log scale', () => {
    it('splits a donut into shares with gaps', async () => {
        const { WidgetGeometry: W } = await import('../src/widget/WidgetGeometry');
        const d = W.donut([1, 1, 2], 4);
        expect(d.map((s) => s.share)).toEqual([0.25, 0.25, 0.5]);
        expect(d[0]).toEqual({from: 0, to: 87, share: 0.25});
        expect(d[1]!.from).toBe(91);
        expect(d[2]!.to + 4).toBeCloseTo(360);
        // empty slices keep a zero span and get no gap; one slice = full ring
        const e = W.donut([0, 3], 4, 90);
        expect(e[0]).toEqual({from: 90, to: 90, share: 0});
        expect(e[1]!.to - e[1]!.from).toBe(360);
        expect(W.donut([0, 0]).every((s) => s.to === s.from)).toBe(true);
    });

    it('puts decades on evenly spaced log rings', async () => {
        const { RadarGeometry: R } = await import('../src/chart/RadarGeometry');
        expect(R.logMax(345)).toBe(1000);
        expect(R.logMax(1000)).toBe(1000);
        expect(R.logMax(3)).toBe(10);
        expect(R.logTicks(1000)).toEqual([1, 10, 100, 1000]);
        const range = {min: 0, max: 1000};
        expect(R.fraction(1000, range, 'log')).toBe(1);
        expect(R.fraction(10, range, 'log')).toBeCloseTo(0.5);
        expect(R.fraction(0, range, 'log')).toBe(0);
        expect(R.fraction(0.05, range, 'log')).toBe(0);
        expect(R.fraction(5, {min: 0, max: 10})).toBe(0.5);
        expect([950, 1200, 10000, 3400000, 0.5].map((v) => R.compact(v))).toEqual(['950', '1.2K', '10K', '3.4M', '0.5']);
    });
});
