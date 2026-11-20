import { describe, expect, it } from 'vitest';
import { RectBoardGeometry as G } from '../src/rect/RectBoardGeometry';
import { RectHistory } from '../src/rect/RectHistory';

const box = {x: 0, y: 0, w: 100, h: 50};

describe('RectBoardGeometry', () => {
    it('anchors on side midpoints and facing sides', () => {
        expect(G.anchor(box, 'right')).toEqual({x: 100, y: 25, side: 'right'});
        expect(G.anchor(box, 'top')).toEqual({x: 50, y: 0, side: 'top'});
        expect(G.autoSides(box, {x: 300, y: 0, w: 100, h: 50})).toEqual(['right', 'left']);
        expect(G.autoSides(box, {x: 0, y: 300, w: 100, h: 50})).toEqual(['bottom', 'top']);
        expect(G.endpoint(box, undefined, {x: -200, y: 10})).toMatchObject({side: 'left'});
        expect(G.endpoint(box, 'bottom', {x: -200, y: 10})).toMatchObject({side: 'bottom'});
    });

    it('curve controls follow the side normals, clamped by the shape', () => {
        const a = {x: 0, y: 0, side: 'right' as const};
        const b = {x: 1000, y: 0, side: 'left' as const};
        const [c1, c2] = G.curveControls(a, b, {factor: 0.4, min: 32, max: 160});
        expect(c1).toEqual({x: 160, y: 0});
        expect(c2).toEqual({x: 840, y: 0});
        const [n1] = G.curveControls(a, {x: 10, y: 0, side: 'left'}, {factor: 0.4, min: 32, max: 160});
        expect(n1.x).toBe(32);
        expect(G.curveMidpoint(a, b)).toEqual({x: 500, y: 0});
        // A free end (cursor) points straight at the other end.
        const [, free] = G.curveControls(a, {x: 0, y: 100}, {factor: 0.4, min: 40, max: Infinity});
        expect(free).toEqual({x: 0, y: 60});
    });

    it('orthogonal paths bend at the midpoints', () => {
        expect(G.orthogonalPath({x: 0, y: 0, side: 'right'}, {x: 100, y: 50, side: 'left'})).toBe('M 0 0 L 50 0 L 50 50 L 100 50');
        expect(G.orthogonalPath({x: 0, y: 0, side: 'bottom'}, {x: 100, y: 50, side: 'left'})).toBe('M 0 0 L 0 50 L 100 50');
    });

    it('snaps, normalises bands and tests rectangles', () => {
        expect(G.snap(29, 20)).toBe(20);
        expect(G.snap(31, 20)).toBe(40);
        expect(G.snap(29.6, 0)).toBe(30);
        expect(G.fromCorners({x: 10, y: 50}, {x: 0, y: 20})).toEqual({x: 0, y: 20, w: 10, h: 30});
        expect(G.overlaps(box, {x: 99, y: 49, w: 10, h: 10})).toBe(true);
        expect(G.overlaps(box, {x: 100, y: 0, w: 10, h: 10})).toBe(false);
        expect(G.contains(box, {x: 0, y: 0, w: 100, h: 50})).toBe(true);
        expect(G.contains(box, {x: 1, y: 1, w: 100, h: 10})).toBe(false);
        expect(G.bounds([box, {x: -20, y: 10, w: 10, h: 100}])).toEqual({x: -20, y: 0, w: 120, h: 110});
        expect(G.bounds([])).toBeNull();
    });
});

describe('RectHistory', () => {
    it('records snapshots, undoes and redoes without sharing references', () => {
        const doc = {n: 1, list: [1]};
        const h = new RectHistory(doc);
        doc.n = 2;
        doc.list.push(2);
        h.record(doc);
        expect(h.canUndo).toBe(true);
        expect(h.undo()).toEqual({n: 1, list: [1]});
        expect(h.redo()).toEqual({n: 2, list: [1, 2]});
        expect(h.redo()).toBeUndefined();
        h.record({n: 3, list: []});
        h.undo();
        h.record({n: 4, list: []});
        expect(h.canRedo).toBe(false);
    });

    it('caps the stack and resets', () => {
        const h = new RectHistory(0, 2);
        h.record(1);
        h.record(2);
        h.record(3);
        expect(h.undo()).toBe(2);
        expect(h.undo()).toBe(1);
        expect(h.undo()).toBeUndefined();
        h.reset(9);
        expect(h.canUndo).toBe(false);
    });
});
