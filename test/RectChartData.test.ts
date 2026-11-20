import { describe, expect, it } from 'vitest';
import { RectChartData } from '../src/rect/RectChartData';

describe('RectChartData', () => {
    it('widens a flat domain and honours fixed bounds', () => {
        expect(RectChartData.domain([5, 5])).toEqual({min: 4, max: 6});
        expect(RectChartData.domain([2, 8], {min: 0})).toEqual({min: 0, max: 8});
        expect(RectChartData.domain([])).toEqual({min: 0, max: 1});
    });

    it('bars: bottom-aligned, proportional, tiny values stay visible', () => {
        const bars = RectChartData.bars([10, 5, 0, 0.001], 100, 50, 4);
        expect(bars).toHaveLength(4);
        expect(bars[0]).toMatchObject({x: 2, width: 21, height: 50, y: 0});
        expect(bars[1]?.height).toBe(25);
        expect(bars[2]?.height).toBe(0);
        expect(bars[3]?.height).toBe(1);
        expect(RectChartData.bars([], 100, 50, 4)).toEqual([]);
        expect(RectChartData.bars([5], 100, 50, 4, 10)[0]?.height).toBe(25);
    });

    it('lines: shared scale across series, y grows upward, single x centred', () => {
        const [a, b] = RectChartData.lines([[{y: 0}, {y: 10}], [{x: 0, y: 5}, {x: 1, y: 5}]], 100, 50, 5);
        expect(a?.[0]).toMatchObject({x: 5, y: 45});
        expect(a?.[1]).toMatchObject({x: 95, y: 5});
        expect(b?.[0]?.y).toBe(25);
        const [single] = RectChartData.lines([[{x: 3, y: 1}]], 100, 50, 5);
        expect(single?.[0]?.x).toBe(50);
    });

    it('intensities relative to the max', () => {
        expect(RectChartData.intensities([0, 2, 4])).toEqual([0, 0.5, 1]);
        expect(RectChartData.intensities([0, 0])).toEqual([0, 0]);
        expect(RectChartData.intensities([8], 4)).toEqual([1]);
    });
});
