import { describe, expect, it } from 'vitest';
import { HoloGeometry } from '../src/chart/HoloGeometry';

describe('HoloGeometry', () => {
    const cam = {yaw: 0, pitch: 45, distance: 1000, tx: 500, ty: 300};
    const f = HoloGeometry.frame(cam, 800, 600);

    it('projects the target to the screen centre', () => {
        const p = HoloGeometry.project(f, 500, 300, 0);
        expect(p.x).toBeCloseTo(400);
        expect(p.y).toBeCloseTo(300);
        expect(p.depth).toBeCloseTo(1000);
    });

    it('puts nearer points lower and right points right', () => {
        expect(HoloGeometry.project(f, 500, 200).y).toBeGreaterThan(300);   // y − 100 is towards the camera at yaw 0
        expect(HoloGeometry.project(f, 600, 300).x).toBeGreaterThan(400);
        expect(HoloGeometry.project(f, 500, 300, 50).y).toBeLessThan(300);
    });

    it('unprojects back onto the table', () => {
        for (const [x, y] of [[500, 300], [620, 180], [300, 420]] as const) {
            const p = HoloGeometry.project(f, x, y);
            const q = HoloGeometry.unproject(f, p.x, p.y)!;
            expect(q.x).toBeCloseTo(x, 6);
            expect(q.y).toBeCloseTo(y, 6);
        }
        expect(HoloGeometry.unproject(f, 400, -5000)).toBeNull();
    });

    it('turns the short way and eases the distance in log space', () => {
        const a = {...cam, yaw: 170}, b = {...cam, yaw: -170, distance: 4000};
        const m = HoloGeometry.lerp(a, b, 0.5);
        expect(Math.abs(((m.yaw % 360) + 360) % 360 - 180)).toBeLessThan(1e-9);
        expect(m.distance).toBeCloseTo(2000);
        expect(HoloGeometry.lerp(a, b, 1).distance).toBeCloseTo(4000);
    });

    it('shows only the box faces turned to the eye', () => {
        const faces = HoloGeometry.boxFaces([0, -100, 50], -10, -10, 20, 20, 0, 10);
        expect(faces.some((x) => x.top)).toBe(true);
        expect(faces).toHaveLength(2);           // top + the face towards −y
    });

    it('hit-tests polygons, polylines and walks along a line', () => {
        const sq = [{x: 0, y: 0}, {x: 10, y: 0}, {x: 10, y: 10}, {x: 0, y: 10}];
        expect(HoloGeometry.inPolygon(5, 5, sq)).toBe(true);
        expect(HoloGeometry.inPolygon(15, 5, sq)).toBe(false);
        expect(HoloGeometry.polylineDistance(5, 3, [{x: 0, y: 0}, {x: 10, y: 0}])).toBeCloseTo(3);
        const mid = HoloGeometry.along([[0, 0], [10, 0], [10, 10]], 0.75);
        expect(mid.x).toBeCloseTo(10);
        expect(mid.y).toBeCloseTo(5);
    });
});
