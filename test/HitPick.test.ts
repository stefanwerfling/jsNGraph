import { describe, expect, it } from 'vitest';
import { HitCandidate, HitPick, pickHit } from '../src/interaction/HitPick';

const dot = (item: string, x: number, y: number, order: number, radius = 3): HitCandidate<string> =>
    ({item: item, x: x, y: y, order: order, shape: {kind: 'circle', radius: radius}});
const card = (item: string, x: number, y: number, order: number, w = 40, h = 20): HitCandidate<string> =>
    ({item: item, x: x, y: y, order: order, shape: {kind: 'box', w: w, h: h}});

describe('HitPick.pick', () => {
    it('gives a small dot a 12 px target (24 px across), not more', () => {
        expect(HitPick.pick([dot('a', 0, 0, 0)], 11.9, 0, 12)).toBe('a');
        expect(HitPick.pick([dot('a', 0, 0, 0)], 8, 8, 12)).toBe('a');
        expect(HitPick.pick([dot('a', 0, 0, 0)], 12.1, 0, 12)).toBeNull();
    });

    it('a big node keeps its own radius', () => {
        expect(HitPick.pick([dot('big', 0, 0, 0, 30)], 29, 0, 12)).toBe('big');
    });

    it('in the padded zone the nearest node wins, not the topmost', () => {
        const nodes = [dot('near', 0, 0, 0), dot('top', 16, 0, 9)];
        expect(HitPick.pick(nodes, 6, 0, 12)).toBe('near');
        expect(HitPick.pick(nodes, 10, 0, 12)).toBe('top');
    });

    it('a drawn shape beats any padded target, also a nearer one', () => {
        // The point is inside the big node, and 5 px from the small dot's centre.
        const nodes = [dot('small', 5, 0, 9), dot('big', 20, 0, 0, 20)];
        expect(HitPick.pick(nodes, 0, 0, 12)).toBe('big');
    });

    it('overlapping drawn shapes: the topmost wins', () => {
        const nodes = [dot('below', 0, 0, 1, 10), dot('above', 4, 0, 2, 10), card('card', 0, 0, 0)];
        expect(HitPick.pick(nodes, 2, 0, 12)).toBe('above');
    });

    it('cards are hit by their box only', () => {
        expect(HitPick.pick([card('c', 0, 0, 0)], 19, 9, 12)).toBe('c');
        expect(HitPick.pick([card('c', 0, 0, 0)], 21, 0, 12)).toBeNull();
    });

    it('the deprecated pickHit alias delegates', () => {
        expect(pickHit([dot('a', 0, 0, 0)], 8, 8, 12)).toBe('a');
    });
});
