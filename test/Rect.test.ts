import { describe, expect, it } from 'vitest';
import { RectRandom } from '../src/rect/RectRandom';
import { RectColor } from '../src/rect/RectColor';

describe('RectRandom', () => {
    it('is deterministic for a given seed', () => {
        const a = new RectRandom(42);
        const b = new RectRandom(42);

        for (let i = 0; i < 20; i++) {
            expect(a.next()).toBe(b.next());
        }
    });

    it('produces values in [0, 1)', () => {
        const r = new RectRandom(7);

        for (let i = 0; i < 200; i++) {
            const v = r.next();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    it('different seeds diverge', () => {
        const a = new RectRandom(1);
        const b = new RectRandom(2);

        expect(a.next()).not.toBe(b.next());
    });
});

describe('RectColor', () => {
    it('resolves palette keys and passes through raw colours', () => {
        expect(RectColor.resolve('amber')).toBe('#efa14b');
        expect(RectColor.resolve('#123456')).toBe('#123456');
        expect(RectColor.resolve(undefined, 'green')).toBe('#2fd27a');
    });

    it('shade clamps t and interpolates from the dark base to the accent', () => {
        const low = RectColor.shade('cyan', 0);
        const high = RectColor.shade('cyan', 1);

        expect(low).toBe('rgb(14, 22, 40)');          // the dark base
        expect(high).toBe('rgb(55, 199, 212)');       // #37c7d4, the accent
        // out-of-range t is clamped, not extrapolated
        expect(RectColor.shade('cyan', -5)).toBe(low);
        expect(RectColor.shade('cyan', 5)).toBe(high);
    });
});
