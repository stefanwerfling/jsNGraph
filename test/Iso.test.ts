import { describe, expect, it } from 'vitest';
import { IsoIcons } from '../src/iso/IsoIcons';
import { IsoProjection } from '../src/iso/IsoProjection';

describe('IsoProjection', () => {
    const p = new IsoProjection(100);

    it('projects floor points 2:1', () => {
        expect(p.tileH).toBe(50);
        expect(p.toWorld(1, 0)).toEqual({x: 50, y: 25});
        expect(p.toWorld(0, 1)).toEqual({x: -50, y: 25});
        expect(p.toWorld(1, 1, 10)).toEqual({x: 0, y: 40});
        expect(p.center({x: 0, y: 0})).toEqual({x: 0, y: 25});
    });

    it('inverts world points back to the floor and to tiles', () => {
        const w = p.toWorld(2.3, -1.6);
        const f = p.toFloor(w.x, w.y);
        expect(f.u).toBeCloseTo(2.3);
        expect(f.v).toBeCloseTo(-1.6);
        expect(p.toTile(w.x, w.y)).toEqual({x: 2, y: -2});
        const c = p.center({x: 5, y: 7});
        expect(p.toTile(c.x, c.y)).toEqual({x: 5, y: 7});
    });

    it('has a floor matrix that agrees with toWorld', () => {
        const [a, b, c, d, e, f] = p.floorMatrix();
        const u = 3, v = 2;
        const w = p.toWorld(u, v);
        expect(a * u + c * v + e).toBeCloseTo(w.x);
        expect(b * u + d * v + f).toBeCloseTo(w.y);
    });

    it('orders by depth and measures rectangles', () => {
        expect(IsoProjection.depth({x: 0, y: 0})).toBeLessThan(IsoProjection.depth({x: 1, y: 0}));
        expect(IsoProjection.depth({x: 0, y: 1})).toBeLessThan(IsoProjection.depth({x: 1, y: 0}));
        expect(IsoProjection.depth({x: 2, y: 0})).toBeLessThan(IsoProjection.depth({x: 0, y: 3}));
        expect(p.rectBounds({x: 0, y: 0}, {x: 0, y: 0})).toEqual({minX: -50, maxX: 50, minY: 0, maxY: 50});
        expect(IsoProjection.rect({x: 3, y: 1}, {x: 1, y: 4})).toEqual({x0: 1, y0: 1, x1: 3, y1: 4});
    });

    it('finds the tiles inside a world box', () => {
        const t = p.tilesIn(p.rectBounds({x: 0, y: 0}, {x: 2, y: 2}));
        expect(t.x0).toBeLessThanOrEqual(0);
        expect(t.x1).toBeGreaterThanOrEqual(3);
        expect(t.y0).toBeLessThanOrEqual(0);
        expect(t.y1).toBeGreaterThanOrEqual(3);
    });
    it('orders by depth and builds back walls with door gaps', () => {
        expect(IsoProjection.zOf(3.5, 2.5)).toBeGreaterThan(IsoProjection.zOf(2.5, 2.5));
        // the wall behind a tile sits between it and the tile behind it
        const wallZ = IsoProjection.zOf(2.5, 2);
        expect(wallZ).toBeLessThan(IsoProjection.zOf(2.5, 2.5));
        expect(wallZ).toBeGreaterThan(IsoProjection.zOf(2.5, 1.5));
        const w = IsoProjection.walls({x: 4, y: 3}, {x: 2, y: 1}, [{x: 3, y: 1}, {x: 2, y: 2}]);
        expect(w.filter((p) => p.face === 'left').map((p) => p.u0)).toEqual([2, 4]);
        expect(w.filter((p) => p.face === 'right').map((p) => p.v0)).toEqual([1, 3]);
        expect(w.every((p) => p.face === 'left' ? p.v0 === 1 && p.v1 === 1 : p.u0 === 2 && p.u1 === 2)).toBe(true);
    });
});

describe('IsoIcons', () => {
    it('projects icon-box points with the tile centre at (50, 115)', () => {
        expect(IsoIcons.P(0, 0)).toEqual([50, 115]);
        expect(IsoIcons.P(0.5, -0.5)).toEqual([100, 115]);
        expect(IsoIcons.P(0.5, 0.5, 10)).toEqual([50, 130]);
    });

    it('shades a colour into lighter top and darker right faces', () => {
        const s = IsoIcons.shades('#808080');
        expect(s.left).toBe('#808080');
        expect(s.top).toBe('rgb(185, 185, 185)');
        expect(s.right).toBe('rgb(96, 96, 96)');
    });

    it('renders every built-in icon in any colour', () => {
        const all = IsoIcons.builtins();
        expect(all.length).toBeGreaterThanOrEqual(16);
        expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
        for (const t of all) {
            const svg = IsoIcons.svg(t, '#3366cc');
            expect(svg.startsWith('<svg')).toBe(true);
            expect(svg).not.toContain('NaN');
            expect(svg).not.toContain('undefined');
        }
    });
});
