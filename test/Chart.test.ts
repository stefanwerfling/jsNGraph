import { describe, expect, it } from 'vitest';
import { ChartScale } from '../src/chart/ChartScale';
import { WaterfallGeometry } from '../src/chart/WaterfallGeometry';

describe('ChartScale ticks', () => {
    it('picks round steps', () => {
        expect(ChartScale.niceStep(300, 5)).toBe(100);
        expect(ChartScale.niceStep(35, 7)).toBe(5);
        expect(ChartScale.niceStep(110, 5)).toBe(25);
        expect(ChartScale.niceStep(0.9, 5)).toBe(0.2);
    });

    it('lists ticks inside the range on step multiples', () => {
        expect(ChartScale.ticks({min: -50, max: 60}, 5)).toEqual([-50, -25, 0, 25, 50]);
        expect(ChartScale.ticks({min: 0, max: 299}, 3)).toEqual([0, 100, 200]);
        expect(ChartScale.ticks({min: 0.1, max: 0.7}, 6)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
    });

    it('formats labels with the decimals the step needs', () => {
        expect(ChartScale.format(50, 25)).toBe('50.0');
        expect(ChartScale.format(0.25, 0.25)).toBe('0.25');
        expect(ChartScale.format(-0.0001, 1)).toBe('0.0');
    });
});

describe('ChartScale mapping, zoom and pan', () => {
    it('maps values to pixels and back', () => {
        const r = {min: -30, max: 5};
        expect(ChartScale.toPx(-30, r, 100, 0)).toBe(100);
        expect(ChartScale.toPx(5, r, 100, 0)).toBe(0);
        expect(ChartScale.fromPx(ChartScale.toPx(-12, r, 100, 0), r, 100, 0)).toBeCloseTo(-12);
    });

    it('zooms around a point and keeps it fixed', () => {
        const z = ChartScale.zoom({min: 0, max: 100}, 25, 0.5);
        expect(z).toEqual({min: 12.5, max: 62.5});
    });

    it('keeps zoom/pan inside the limits and above the minimum span', () => {
        const limits = {min: 0, max: 100};
        expect(ChartScale.zoom({min: 0, max: 100}, 50, 3, limits)).toEqual(limits);
        expect(ChartScale.pan({min: 80, max: 100}, 15, limits)).toEqual({min: 80, max: 100});
        expect(ChartScale.pan({min: 10, max: 30}, -25, limits)).toEqual({min: 0, max: 20});
        const tiny = ChartScale.zoom({min: 40, max: 60}, 50, 0.001, limits, 2);
        expect(tiny.max - tiny.min).toBeCloseTo(2);
    });

    it('extent skips non-finite values and pads flat ranges', () => {
        expect(ChartScale.extent([3, NaN, -1, Infinity])).toEqual({min: -1, max: 3});
        expect(ChartScale.pad({min: 2, max: 2}, 0.1)).toEqual({min: 1, max: 3});
    });
});

describe('WaterfallGeometry', () => {
    const area = {x: 0, y: 0, w: 400, h: 300};

    it('stacks traces right and up so the back one ends in the corner', () => {
        const l = WaterfallGeometry.layout(area, 11, 0.25, 0.5);
        expect(l.plot).toEqual({x: 0, y: 150, w: 300, h: 150});
        expect(l.stepX).toBeCloseTo(10);
        expect(l.stepY).toBeCloseTo(-15);
        const back = WaterfallGeometry.point(l, 10, 1, 1, {min: 0, max: 1}, {min: 0, max: 1});
        expect(back).toEqual({x: 400, y: 0});
    });

    it('finds the nearest index with or without x values', () => {
        expect(WaterfallGeometry.nearestIndex({y: [0, 0, 0, 0]}, 2.4)).toBe(2);
        expect(WaterfallGeometry.nearestIndex({x: [0, 10, 20], y: [0, 0, 0]}, 16)).toBe(2);
        expect(WaterfallGeometry.nearestIndex({y: []}, 1)).toBe(-1);
    });

    it('interpolates a value and returns null outside the data', () => {
        const s = {x: [0, 10], y: [0, 100]};
        expect(WaterfallGeometry.valueAt(s, 2.5)).toBe(25);
        expect(WaterfallGeometry.valueAt(s, 11)).toBeNull();
    });

    it('hits the trace under the pointer, also on a steep flank', () => {
        const series = [
            {y: [0, 0, 0, 0, 0]},
            {y: [0, 0, 10, 0, 0]}
        ];
        const l = WaterfallGeometry.layout(area, 2, 0.1, 0.2);
        const xr = {min: 0, max: 4};
        const yr = {min: 0, max: 10};
        const front = WaterfallGeometry.point(l, 0, 1, 0, xr, yr);
        expect(WaterfallGeometry.hit(l, series, front.x, front.y + 2, xr, yr)).toBe(0);

        // halfway up the back trace's peak flank: vertical distance is large, segment distance small
        const a = WaterfallGeometry.point(l, 1, 1, 0, xr, yr);
        const b = WaterfallGeometry.point(l, 1, 2, 10, xr, yr);
        expect(WaterfallGeometry.hit(l, series, (a.x + b.x) / 2 + 2, (a.y + b.y) / 2, xr, yr)).toBe(1);
        expect(WaterfallGeometry.hit(l, series, 5, 5, xr, yr)).toBeNull();
    });
});
