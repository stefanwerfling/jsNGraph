import { describe, expect, it } from 'vitest';
import { Camera } from '../src/view/Camera';
import { Geometry } from '../src/util/Geometry';

describe('Camera', () => {
    it('toScreen and toWorld are inverse', () => {
        const camera = new Camera();

        camera.setState({scale: 1.7, offsetX: -40, offsetY: 12});
        const s = camera.toScreen(123, -45);
        const w = camera.toWorld(s.x, s.y);

        expect(w.x).toBeCloseTo(123, 9);
        expect(w.y).toBeCloseTo(-45, 9);
    });

    it('zoomAt keeps the world point under the cursor fixed', () => {
        const camera = new Camera();
        const before = camera.toWorld(300, 200);

        camera.zoomAt(300, 200, 2);
        const after = camera.toWorld(300, 200);

        expect(camera.scale).toBe(2);
        expect(after.x).toBeCloseTo(before.x, 9);
        expect(after.y).toBeCloseTo(before.y, 9);
    });

    it('clamps scale to its limits', () => {
        const camera = new Camera(0.5, 2);

        camera.zoomAt(0, 0, 100);
        expect(camera.scale).toBe(2);
        camera.setState({scale: 0.01, offsetX: 0, offsetY: 0});
        expect(camera.scale).toBe(0.5);
    });

    it('fit frames the bounds inside the viewport', () => {
        const camera = new Camera(0.01, 10);
        const bounds = {minX: 100, minY: 100, maxX: 300, maxY: 200};

        camera.fit(bounds, 800, 600, 50);
        const view = camera.viewBounds(800, 600);

        expect(view.minX).toBeLessThanOrEqual(bounds.minX);
        expect(view.maxX).toBeGreaterThanOrEqual(bounds.maxX);
        expect(view.minY).toBeLessThanOrEqual(bounds.minY);
        expect(view.maxY).toBeGreaterThanOrEqual(bounds.maxY);
        const center = camera.toScreen(200, 150);
        expect(center.x).toBeCloseTo(400, 6);
        expect(center.y).toBeCloseTo(300, 6);
    });

    it('flyTo lands exactly on the target and reports when it is done', () => {
        const camera = new Camera(0.1, 10);
        const target = camera.centerState(500, 500, 800, 600, 3);

        camera.flyTo(target, 300);
        expect(camera.animating).toBe(true);
        expect(camera.step(1000)).toBe(true);
        expect(camera.step(1150)).toBe(true);
        expect(camera.scale).toBeGreaterThan(1);
        expect(camera.scale).toBeLessThan(3);
        expect(camera.step(1300)).toBe(false);
        expect(camera.getState()).toEqual(target);
        expect(camera.animating).toBe(false);
    });

    it('a direct move cancels a running flight', () => {
        const camera = new Camera();

        camera.flyTo({scale: 2, offsetX: 100, offsetY: 100}, 500);
        camera.panBy(10, 0);
        expect(camera.animating).toBe(false);
        expect(camera.step(0)).toBe(false);
    });
});

describe('Geometry', () => {
    it('distToSegment clamps to the endpoints', () => {
        expect(Geometry.distToSegment({x: 5, y: 3}, {x: 0, y: 0}, {x: 10, y: 0})).toBeCloseTo(3);
        expect(Geometry.distToSegment({x: -4, y: 3}, {x: 0, y: 0}, {x: 10, y: 0})).toBeCloseTo(5);
        expect(Geometry.distToSegment({x: 1, y: 1}, {x: 0, y: 0}, {x: 0, y: 0})).toBeCloseTo(Math.SQRT2);
    });

    it('pointInPolygon handles a concave lasso', () => {
        // A "U" shape: the notch between the arms is outside.
        const u = [
            {x: 0, y: 0}, {x: 10, y: 0}, {x: 10, y: 10}, {x: 7, y: 10},
            {x: 7, y: 3}, {x: 3, y: 3}, {x: 3, y: 10}, {x: 0, y: 10}
        ];

        expect(Geometry.pointInPolygon({x: 1, y: 8}, u)).toBe(true);
        expect(Geometry.pointInPolygon({x: 5, y: 1}, u)).toBe(true);
        expect(Geometry.pointInPolygon({x: 5, y: 8}, u)).toBe(false);
        expect(Geometry.pointInPolygon({x: 20, y: 5}, u)).toBe(false);
    });
});
