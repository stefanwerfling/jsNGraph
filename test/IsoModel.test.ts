import { describe, expect, it } from 'vitest';
import { IsoModel as M } from '../src/iso/IsoModel';
import { IsoDocument } from '../src/iso/IsoTypes';

const sample = (): Required<IsoDocument> => M.normalize({
    items: [
        {id: 'a', tile: {x: 0, y: 0}, icon: 'server'},
        {id: 'b', tile: {x: 2, y: 0}, icon: 'server'},
        {id: 'c', tile: {x: 4, y: 0}, icon: 'database'}
    ],
    connectors: [
        {id: 'ab', from: {item: 'a'}, to: {item: 'b'}, via: [{x: 1, y: 2}]},
        {id: 'bc', from: {item: 'b'}, to: {item: 'c'}},
        {id: 'cfree', from: {item: 'c'}, to: {tile: {x: 6, y: 3}}}
    ],
    regions: [{id: 'r', from: {x: 0, y: 0}, to: {x: 2, y: 2}}],
    texts: [{id: 't', tile: {x: 0, y: 4}, text: 'hi'}]
});

describe('IsoModel', () => {
    it('knows kinds, occupancy and free tiles', () => {
        const d = sample();
        expect(M.kindOf(d, 'a')).toBe('item');
        expect(M.kindOf(d, 'bc')).toBe('connector');
        expect(M.kindOf(d, 'r')).toBe('region');
        expect(M.kindOf(d, 't')).toBe('text');
        expect(M.kindOf(d, 'zz')).toBeNull();
        expect(M.occupied(d).get('2,0')).toBe('b');
        expect(M.freeTileNear(d, {x: 3, y: 0})).toEqual({x: 3, y: 0});
        const near = M.freeTileNear(d, {x: 2, y: 0});
        expect(Math.abs(near.x - 2) + Math.abs(near.y)).toBe(1);
        expect(M.freeTileNear(d, {x: 2, y: 0}, new Set(['b']))).toEqual({x: 2, y: 0});
    });

    it('moves only when nothing staying is in the way, and takes waypoints along', () => {
        const d = sample();
        expect(M.canMove(d, new Set(['a']), 2, 0)).toBe(false);
        expect(M.canMove(d, new Set(['a', 'b']), 2, 0)).toBe(false); // b would land on c
        expect(M.canMove(d, new Set(['a', 'b']), 1, 0)).toBe(true);
        M.move(d, new Set(['a', 'b', 'r']), 0, 3);
        expect(d.items[0]!.tile).toEqual({x: 0, y: 3});
        expect(d.connectors[0]!.via).toEqual([{x: 1, y: 5}]);
        expect(d.regions[0]!.from).toEqual({x: 0, y: 3});
        // c stays, so its free end stays too
        expect(d.connectors[2]!.to).toEqual({tile: {x: 6, y: 3}});
    });

    it('removes items with their connectors', () => {
        const d = sample();
        const gone = M.remove(d, new Set(['b', 't']));
        expect(gone.sort()).toEqual(['ab', 'b', 'bc', 't']);
        expect(d.connectors.map((c) => c.id)).toEqual(['cfree']);
    });

    it('copies and pastes with fresh ids, shifted, onto free tiles', () => {
        const d = sample();
        const f = M.fragment(d, new Set(['a', 'b', 'r']));
        expect(f.items.map((i) => i.id)).toEqual(['a', 'b']);
        expect(f.connectors.map((c) => c.id)).toEqual(['ab']);
        expect(M.origin(f)).toEqual({x: 0, y: 0});
        const added = M.paste(d, f, {x: 0, y: 1});
        expect(added).toHaveLength(4);
        const items = d.items.filter((i) => added.includes(i.id));
        expect(items.map((i) => i.tile)).toEqual([{x: 0, y: 1}, {x: 2, y: 1}]);
        const link = d.connectors.find((c) => added.includes(c.id))!;
        expect(link.from).toEqual({item: items[0]!.id});
        expect(link.via).toEqual([{x: 1, y: 3}]);
        expect(new Set([...d.items, ...d.connectors, ...d.regions, ...d.texts].map((x) => x.id)).size).toBe(5 + 4 + 2 + 1);
        // pasting onto itself: items move to the nearest free tiles
        const again = M.paste(d, M.fragment(d, new Set(['c'])), {x: 4, y: 0});
        const c2 = d.items.find((i) => i.id === again[0])!;
        expect(c2.tile).not.toEqual({x: 4, y: 0});
    });

    it('resizes a region from any corner', () => {
        const r = {id: 'r', from: {x: 1, y: 1}, to: {x: 3, y: 4}};
        M.resizeRegion(r, 2, {x: 5, y: 2});
        expect(r).toMatchObject({from: {x: 1, y: 1}, to: {x: 5, y: 2}});
        M.resizeRegion(r, 0, {x: 7, y: 0});
        expect(r).toMatchObject({from: {x: 5, y: 0}, to: {x: 7, y: 2}});
    });
});
