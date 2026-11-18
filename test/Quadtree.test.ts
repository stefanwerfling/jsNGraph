import { describe, expect, it } from 'vitest';
import { Quadtree, QuadtreePoint } from '../src/util/Quadtree';
import { RectRandom } from '../src/rect/RectRandom';

function randomPoints(n: number, seed = 7): QuadtreePoint<number>[] {
    const rnd = new RectRandom(seed);
    const points: QuadtreePoint<number>[] = [];

    for (let i = 0; i < n; i++) {
        points.push({x: rnd.next() * 1000 - 500, y: rnd.next() * 800, payload: i});
    }

    return points;
}

describe('Quadtree', () => {
    it('build() keeps every point, even many coincident ones', () => {
        const points = randomPoints(2000);

        for (let i = 0; i < 100; i++) {
            points.push({x: 3, y: 3, payload: 10000 + i});
        }

        const tree = Quadtree.build(points);

        expect(tree.size).toBe(points.length);
        expect(tree.queryRadius(3, 3, 0.0001).length).toBeGreaterThanOrEqual(100);
    });

    it('nearest() matches a brute-force scan', () => {
        const points = randomPoints(3000);
        const tree = Quadtree.build(points);
        const rnd = new RectRandom(99);

        for (let q = 0; q < 200; q++) {
            const x = rnd.next() * 1200 - 600;
            const y = rnd.next() * 1000 - 100;
            let best = Infinity;

            for (const p of points) {
                best = Math.min(best, Math.hypot(p.x - x, p.y - y));
            }

            const hit = tree.nearest(x, y);

            expect(hit).not.toBeNull();
            expect(hit?.distance).toBeCloseTo(best, 9);
        }
    });

    it('nearest() honours maxDistance', () => {
        const tree = Quadtree.build([{x: 0, y: 0, payload: 'a'}]);

        expect(tree.nearest(10, 0, 5)).toBeNull();
        expect(tree.nearest(4, 0, 5)?.point.payload).toBe('a');
    });

    it('queryRadius() and queryRect() match brute force', () => {
        const points = randomPoints(2500, 3);
        const tree = Quadtree.build(points);
        const inRadius = points.filter((p) => Math.hypot(p.x - 10, p.y - 400) <= 120).map((p) => p.payload).sort();
        const rect = {minX: -100, minY: 100, maxX: 250, maxY: 300};
        const inRect = points
            .filter((p) => p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY)
            .map((p) => p.payload)
            .sort();

        expect(tree.queryRadius(10, 400, 120).map((p) => p.payload).sort()).toEqual(inRadius);
        expect(tree.queryRect(rect).map((p) => p.payload).sort()).toEqual(inRect);
    });

    it('add() rejects points outside the root bounds', () => {
        const tree = new Quadtree<number>({minX: 0, minY: 0, maxX: 10, maxY: 10});

        expect(tree.add({x: 5, y: 5, payload: 1})).toBe(true);
        expect(tree.add({x: 50, y: 5, payload: 2})).toBe(false);
        expect(tree.size).toBe(1);
    });

    it('an empty tree answers every query with nothing', () => {
        const tree = Quadtree.build<number>([]);

        expect(tree.nearest(0, 0)).toBeNull();
        expect(tree.queryRadius(0, 0, 100)).toEqual([]);
    });
});
