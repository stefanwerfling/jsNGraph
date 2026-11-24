import { describe, expect, it } from 'vitest';
import { LineageLayout as L, LineageNode } from '../src/chart/LineageLayout';

const tree: LineageNode[] = [
    {id: 'u', label: 'U', year: 1970},
    {id: 'b', label: 'B', year: 1978, parent: 'u'},
    {id: 'l', label: 'L', year: 1990, parent: 'u'},
    {id: 'r', label: 'R', year: 1994, parent: 'l'},
    {id: 'f', label: 'F', year: 2003, parent: 'r'},
    {id: 'd', label: 'D', year: 1993, parent: 'l'},
    {id: 'e', label: 'E', year: 2008, parent: 'l', band: 'emb'}
];

describe('LineageLayout', () => {
    it('maps years linearly or compressed', () => {
        const lin = L.timeScale([], 2000, 2010, 0, 100);
        expect(lin(2005)).toBe(50);
        const c = L.timeScale([1970, 1971, 2000], 1970, 2000, 0, 100, 'compressed');
        expect(c(1970)).toBe(0);
        expect(c(2000)).toBeCloseTo(100);
        // one year gap gets 1, the 29 year gap √29 → the busy start widens
        expect(c(1971)).toBeCloseTo(100 / (1 + Math.sqrt(29)));
        expect(c(1985)).toBeGreaterThan(c(1971));
    });

    it('lets the largest family continue the row and branches the rest', () => {
        const trunk = L.trunks(tree);
        expect(trunk.get('u')).toBe('l');
        expect(trunk.get('l')).toBe('r');
        const rows = L.rows(tree);
        const rowOf = (id: string): number => rows.findIndex((r) => r.includes(id));
        expect(rowOf('u')).toBe(rowOf('l'));
        expect(rowOf('l')).toBe(rowOf('r'));
        // every node exactly once
        expect(rows.flat().sort()).toEqual(tree.map((n) => n.id).sort());
        // branches of l (d, e) and u (b) on both sides of the main row
        const main = rowOf('u');
        expect([rowOf('b'), rowOf('d'), rowOf('e'), rowOf('f')].some((r) => r < main)).toBe(true);
        expect([rowOf('b'), rowOf('d'), rowOf('e'), rowOf('f')].some((r) => r > main)).toBe(true);
        expect(L.trunks([...tree, {id: 'x', label: 'X', year: 1980, parent: 'b', trunk: false}]).has('b')).toBe(false);
    });

    it('places bands below and routes branches on a riser', () => {
        const res = L.layout(tree, {from: 1969, to: 2020, x0: 0, x1: 510, top: 10, rowHeight: 20,
            bands: [{id: 'emb', label: 'Embedded'}]});
        const at = (id: string) => res.placed.find((p) => p.node.id === id)!;
        expect(at('e').band).toBe('emb');
        expect(at('e').y).toBe(Math.max(...res.placed.map((p) => p.y)));
        expect(res.bands.map((b) => b.id)).toEqual(['', 'emb']);
        // band gap: one extra row between the bands
        expect(at('e').y - Math.max(...res.placed.filter((p) => p.band === '').map((p) => p.y))).toBe(40);
        const l = at('l'), d = at('d');
        expect(d.incoming).toEqual([[l.x, l.y], [l.x, d.y], [d.x, d.y]]);
        expect(at('r').incoming).toEqual([[l.x, l.y], [at('r').x, l.y]]);
        expect(at('l').tail).toEqual([]);
        expect(at('f').tail[1]![0]).toBe(510);
    });

    it('finds the lineage without siblings', () => {
        expect([...L.lineage(tree, 'r')].sort()).toEqual(['f', 'l', 'r', 'u']);
        expect(L.lineage(tree, 'b').has('l')).toBe(false);
    });

    it('staggers year tags and measures distances', () => {
        const tags = L.tags([1990, 1991, 1992, 2000], (y) => (y - 1990) * 20, 30);
        expect(tags.map((t) => t.level)).toEqual([0, 1, 0, 0]);
        expect(L.tags([1990, 1990.5, 1991], (y) => y * 10, 30)).toHaveLength(2);
        expect(L.distanceToPath(5, 3, [[0, 0], [10, 0]])).toBe(3);
        expect(L.colorAt(0, ['#000000', '#ffffff'])).toBe('rgb(0, 0, 0)');
    });
});
