import { describe, expect, it } from 'vitest';
import { PhaseRingGeometry } from '../src/chart/PhaseRingGeometry';

describe('PhaseRingGeometry', () => {
    const view = {cx: 100, cy: 50, rx: 80, ry: 20, lift: 1, yaw: 0};

    it('puts phase 0 in front, 0.25 right, 0.5 at the back, and lifts by height', () => {
        const front = PhaseRingGeometry.point(view, 0);
        expect(front.x).toBeCloseTo(100);
        expect(front.y).toBeCloseTo(70);
        expect(front.depth).toBeCloseTo(1);
        expect(PhaseRingGeometry.point(view, 0.25).x).toBeCloseTo(180);
        const back = PhaseRingGeometry.point(view, 0.5, 10);
        expect(back.y).toBeCloseTo(20);
        expect(back.depth).toBeCloseTo(-1);
    });

    it('smooths through every sample and closes the loop', () => {
        const values = [1, 5, 2, 8];
        const s = PhaseRingGeometry.smooth(values, 4);
        expect(s).toHaveLength(17);
        values.forEach((v, i) => expect(s[i * 4]!.value).toBeCloseTo(v));
        expect(s[16]!.phase).toBe(1);
        expect(s[16]!.value).toBeCloseTo(1);
    });

    it('finds the nearest bin cyclically', () => {
        expect(PhaseRingGeometry.binAt(0.98, 30)).toBe(29);
        expect(PhaseRingGeometry.binAt(0.999, 30)).toBe(0);
        expect(PhaseRingGeometry.binAt(0.5, 8)).toBe(4);
    });

    it('describes the moon: dark when new, lit on the right when waxing, full at 0.5', () => {
        expect(PhaseRingGeometry.terminator(0).lit).toBeCloseTo(0);
        const q1 = PhaseRingGeometry.terminator(0.25);
        expect(q1.lit).toBeCloseTo(0.5);
        expect(q1.waxing).toBe(true);
        expect(q1.mid).toBeCloseTo(0);
        expect(PhaseRingGeometry.terminator(0.5).lit).toBeCloseTo(1);
        expect(PhaseRingGeometry.terminator(0.75).waxing).toBe(false);
        expect(PhaseRingGeometry.moonName(0.5)).toBe('Full moon');
        expect(PhaseRingGeometry.moonName(0.97)).toBe('New moon');
    });

    it('interpolates colours and clamps', () => {
        expect(PhaseRingGeometry.colorAt(['#000000', '#ffffff'], 0.5)).toBe('rgb(128,128,128)');
        expect(PhaseRingGeometry.colorAt(['#000000', '#ffffff'], 2)).toBe('rgb(255,255,255)');
        expect(PhaseRingGeometry.stats([2, 4, 9])).toEqual({mean: 5, min: 2, max: 9});
    });

    it('hit-tests within a radius', () => {
        const pts = [{x: 0, y: 0}, {x: 10, y: 0}];
        expect(PhaseRingGeometry.nearest(pts, 8, 1, 5)).toBe(1);
        expect(PhaseRingGeometry.nearest(pts, 50, 50, 5)).toBe(-1);
    });
});
