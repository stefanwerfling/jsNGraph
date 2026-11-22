import { describe, expect, it } from 'vitest';
import { DAY_MINUTES, DayClockGeometry, DayClockItem } from '../src/widget/DayClockGeometry';

const at = (h: number, m = 0, day = 15): Date => new Date(2026, 10, day, h, m);
const item = (from: Date, to: Date, label = 'x'): DayClockItem => ({start: from, end: to, label});

describe('DayClockGeometry', () => {
    it('tells past, running and upcoming apart', () => {
        const now = at(10);

        expect(DayClockGeometry.state(item(at(8), at(9)), now)).toBe('past');
        expect(DayClockGeometry.state(item(at(9), at(10)), now)).toBe('past');       // ends exactly now
        expect(DayClockGeometry.state(item(at(10), at(11)), now)).toBe('running');   // starts exactly now
        expect(DayClockGeometry.state(item(at(11), at(12)), now)).toBe('upcoming');
    });

    it('puts 00:00 at the top and runs clockwise', () => {
        const [x0, y0] = DayClockGeometry.point(0, 100, 145);
        const [x6, y6] = DayClockGeometry.point(360, 100, 145);
        const [x12, y12] = DayClockGeometry.point(720, 100, 145);

        expect([x0, y0]).toEqual([145, 45]);
        expect(x6).toBeCloseTo(245);
        expect(y6).toBeCloseTo(145);
        expect(x12).toBeCloseTo(145);
        expect(y12).toBeCloseTo(245);
    });

    it('gives overlapping items their own rings and reuses free ones', () => {
        const placed = DayClockGeometry.place([
            item(at(9), at(11), 'a'),
            item(at(10), at(12), 'b'),     // overlaps a → ring 1
            item(at(11), at(13), 'c'),     // a has ended → ring 0 again
            item(at(10, 30), at(14), 'd'), // a, b busy … b ends 12 → ring 2
            item(at(10, 45), at(15), 'e')  // all busy, max 3 rings → innermost
        ], at(12), 3);

        expect(placed.map((p) => `${p.item.label}${p.lane}`)).toEqual(['a0', 'b1', 'd2', 'e2', 'c0']);
    });

    it('cuts items at the day edge, drops other days, and keeps tiny ones visible', () => {
        const placed = DayClockGeometry.place([
            item(at(23, 0, 14), at(1, 0, 15), 'overnight'),
            item(at(9, 0, 16), at(10, 0, 16), 'tomorrow'),
            item(at(12), at(12), 'instant'),
            item(at(22), at(2, 0, 16), 'late')
        ], at(12), 4);

        expect(placed.map((p) => p.item.label)).toEqual(['overnight', 'instant', 'late']);
        expect(placed[0]).toMatchObject({from: 0, to: 60});
        expect(placed[1]).toMatchObject({from: 720, to: 724});
        expect(placed[2]).toMatchObject({from: 1320, to: DAY_MINUTES});
    });

    it('draws arcs and the elapsed wedge, including a full day', () => {
        expect(DayClockGeometry.arcPath(0, 360, 100, 145)).toBe('M145 45A100 100 0 0 1 245 145');
        expect(DayClockGeometry.arcPath(0, 1000, 100, 145)).toContain(' 0 1 1 ');      // large arc
        expect(DayClockGeometry.arcPath(0, DAY_MINUTES, 100, 145).match(/A/g)).toHaveLength(2);
        expect(DayClockGeometry.wedgePath(0, 100, 145)).toBe('');
        expect(DayClockGeometry.wedgePath(360, 100, 145)).toBe('M145 145L145 45A100 100 0 0 1 245 145Z');
        expect(DayClockGeometry.wedgePath(DAY_MINUTES, 100, 145).match(/A/g)).toHaveLength(2);
    });
});
