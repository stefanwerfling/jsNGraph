import { describe, expect, it } from 'vitest';
import { EncounterGeometry as G } from '../src/chart/EncounterGeometry';

describe('EncounterGeometry', () => {
    it('measures bearings clockwise from up', () => {
        expect(G.bearing(0, 0, 0, 1)).toBeCloseTo(0);
        expect(G.bearing(0, 0, 1, 0)).toBeCloseTo(Math.PI / 2);
        expect(G.bearing(0, 0, -1, 0)).toBeCloseTo(Math.PI * 1.5);
        expect(G.turn(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2);
    });

    it('moves a track to the origin and turns the reference up', () => {
        // heading east from (100, 50); reference = east → it should point up
        const t = G.align([{t: 10, x: 100, y: 50}, {t: 20, x: 200, y: 50}], Math.PI / 2);
        expect(t[0]).toMatchObject({t: 0, x: 0, y: 0});
        expect(t[1]!.x).toBeCloseTo(0);
        expect(t[1]!.y).toBeCloseTo(100);
        expect(t[1]!.heading).toBeCloseTo(0);
        expect(G.firstHeading([{t: 0, x: 0, y: 0}, {t: 1, x: 3, y: 0}, {t: 2, x: 0, y: 50}], 10)).toBeCloseTo(0);
    });

    it('interpolates the position at a time', () => {
        const t = G.align([{t: 0, x: 0, y: 0}, {t: 10, x: 0, y: 100}, {t: 20, x: 100, y: 100, dive: true}]);
        expect(G.at(t, -1)).toBeNull();
        expect(G.at(t, 5)).toMatchObject({i: 0, x: 0, y: 50, dive: false});
        const p = G.at(t, 15)!;
        expect(p.x).toBeCloseTo(50);
        expect(p.dive).toBe(true);
        expect(G.at(t, 99)).toMatchObject({x: 100, y: 100});
    });

    it('computes track statistics', () => {
        const s = G.stats(G.align([{t: 0, x: 0, y: 0}, {t: 10, x: 0, y: 100}, {t: 20, x: 100, y: 100}]));
        expect(s.length).toBeCloseTo(200);
        expect(s.duration).toBe(20);
        expect(s.speed).toBeCloseTo(10);
        expect(s.net).toBeCloseTo(Math.SQRT2 * 100);
        expect(s.bearing).toBeCloseTo(Math.PI / 4);
        expect(s.straightness).toBeCloseTo(Math.SQRT2 / 2);
        expect(s.meanTurn).toBeCloseTo(Math.PI / 2);
    });

    it('bins directions into a stacked rose', () => {
        expect(G.binOf(0, 4)).toBe(0);
        expect(G.binOf(Math.PI * 2 - 0.1, 4)).toBe(0);
        expect(G.binOf(Math.PI / 2, 4)).toBe(1);
        const r = G.rose([{bearing: 0, category: 0}, {bearing: 0.1, category: 1}, {bearing: Math.PI, category: 1, weight: 3}], 4, 2);
        expect(r[0]).toEqual([1, 1]);
        expect(r[2]).toEqual([0, 3]);
    });

    it('averages directions on the circle', () => {
        const m = G.circularMean([Math.PI * 2 - 0.2, 0.2]);
        expect(Math.min(m.bearing, Math.PI * 2 - m.bearing)).toBeCloseTo(0);
        expect(m.r).toBeCloseTo(Math.cos(0.2));
        expect(G.circularMean([0, Math.PI]).r).toBeCloseTo(0);
    });

    it('picks round ring steps and measures distance to a path', () => {
        expect(G.ringStep(1800, 4)).toBe(500);
        expect(G.ringStep(90, 4)).toBe(50);
        expect(G.distanceToPath(5, 4, [0, 0, 10, 0])).toBeCloseTo(4);
    });
});
