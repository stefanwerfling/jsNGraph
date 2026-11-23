import { describe, expect, it } from 'vitest';
import { DepthLayout } from '../src/chart/DepthLayout';
import { TimeScale } from '../src/chart/TimeScale';

const at = (y: number, m: number, d: number, h = 0): number => new Date(y, m, d, h).getTime();

describe('TimeScale', () => {
    it('picks a calendar step that fits the tick budget', () => {
        expect(TimeScale.step({min: at(2026, 3, 4), max: at(2026, 3, 5)}, 6)).toMatchObject({unit: 'hour', count: 6});
        expect(TimeScale.step({min: at(2026, 3, 4), max: at(2026, 4, 4)}, 6)).toMatchObject({unit: 'day', count: 5});
        expect(TimeScale.step({min: at(2026, 3, 4), max: at(2026, 4, 4)}, 4)).toMatchObject({unit: 'day', count: 14});
        expect(TimeScale.step({min: at(2020, 0, 1), max: at(2026, 0, 1)}, 8)).toMatchObject({unit: 'year', count: 1});
    });

    it('puts ticks on round calendar positions', () => {
        const days = TimeScale.ticks({min: at(2026, 3, 3, 15), max: at(2026, 4, 2)}, {unit: 'day', count: 5, ms: 5 * TimeScale.DAY});
        expect(days.map((t) => new Date(t).getDate())).toEqual([6, 11, 16, 21, 26, 1]);

        const months = TimeScale.ticks({min: at(2025, 10, 15), max: at(2026, 6, 1)}, {unit: 'month', count: 3, ms: 91 * TimeScale.DAY});
        expect(months.map((t) => [new Date(t).getFullYear(), new Date(t).getMonth()])).toEqual([[2026, 0], [2026, 3], [2026, 6]]);

        const daily = TimeScale.ticks({min: at(2026, 0, 30), max: at(2026, 1, 2)}, {unit: 'day', count: 1, ms: TimeScale.DAY});
        expect(daily.map((t) => new Date(t).getDate())).toEqual([30, 31, 1, 2]);

        const weeks = TimeScale.ticks({min: at(2026, 3, 1), max: at(2026, 3, 30)}, {unit: 'day', count: 7, ms: 7 * TimeScale.DAY});
        expect(weeks.every((t) => new Date(t).getDay() === 1)).toBe(true);
    });

    it('labels with the detail of the step', () => {
        const hour = {unit: 'hour' as const, count: 6, ms: 6 * TimeScale.HOUR};
        expect(TimeScale.label(at(2026, 3, 4, 6), hour, 'en-GB')).toBe('06:00');
        expect(TimeScale.label(at(2026, 3, 4), hour, 'en-GB')).toBe('4 Apr');
        expect(TimeScale.label(at(2026, 0, 1), {unit: 'month', count: 1, ms: 1}, 'en-GB')).toBe('2026');
    });

    it('searches sorted times and keeps spikes when decimating', () => {
        const t = [0, 10, 20, 30];
        expect(TimeScale.indexAtOrBefore(t, 25)).toBe(2);
        expect(TimeScale.indexAtOrBefore(t, -1)).toBe(-1);
        expect(TimeScale.nearest(t, 26)).toBe(3);
        expect(TimeScale.nearest([], 5)).toBe(-1);

        const times = Array.from({length: 1000}, (_, i) => i);
        const values = times.map((i) => (i === 500 ? 99 : 1));
        const out = TimeScale.decimate(times, values, 0, 999, {min: 0, max: 1000}, 50);
        expect(out.length).toBeLessThanOrEqual(100);
        expect(out.some(([, v]) => v === 99)).toBe(true);
    });
});

describe('DepthLayout', () => {
    const book = DepthLayout.book(
        [{price: 1.9, quantity: 10}, {price: 2, quantity: 5}, {price: 1.9, quantity: 2}, {price: 1.5, quantity: 0}],
        [{price: 2.2, quantity: 3}, {price: 2.1, quantity: 4}]
    );

    it('merges levels and sums from the middle outwards', () => {
        expect(book.bids).toEqual([{price: 2, quantity: 5, cumulative: 5}, {price: 1.9, quantity: 12, cumulative: 17}]);
        expect(book.asks.map((l) => l.cumulative)).toEqual([4, 7]);
        expect(book.bestBid).toBe(2);
        expect(book.bestAsk).toBe(2.1);
        expect(book.spread).toBeCloseTo(0.1);
        expect(book.mid).toBeCloseTo(2.05);
    });

    it('reads the depth at a price', () => {
        expect(DepthLayout.depthAt(book.bids, 1.95, 'bid')).toBe(5);
        expect(DepthLayout.depthAt(book.bids, 1, 'bid')).toBe(17);
        expect(DepthLayout.depthAt(book.bids, 2.5, 'bid')).toBe(0);
        expect(DepthLayout.depthAt(book.asks, 2.15, 'ask')).toBe(4);
        expect(DepthLayout.depthAt(book.asks, 9, 'ask')).toBe(7);
    });
});
