import { describe, expect, it } from 'vitest';
import { CalendarGeometry } from '../src/widget/CalendarGeometry';
import { WidgetGeometry } from '../src/widget/WidgetGeometry';
import { WorldMapGeometry } from '../src/widget/WorldMapGeometry';

describe('WidgetGeometry', () => {
    it('measures angles clockwise from the top', () => {
        const [x, y] = WidgetGeometry.polar(0, 0, 10, 90);
        expect(x).toBeCloseTo(10);
        expect(y).toBeCloseTo(0);
        const [x2, y2] = WidgetGeometry.polar(0, 0, 10, 180);
        expect(x2).toBeCloseTo(0);
        expect(y2).toBeCloseTo(10);
    });

    it('draws empty, partial and full arcs', () => {
        expect(WidgetGeometry.arcPath(0, 0, 10, 0, 0)).toBe('');
        expect(WidgetGeometry.arcPath(0, 0, 10, 0, 90).match(/A/g)).toHaveLength(1);
        expect(WidgetGeometry.arcPath(0, 0, 10, 0, 270)).toContain(' 0 1 1 ');
        // a full circle needs two arc commands
        expect(WidgetGeometry.arcPath(0, 0, 10, 0, 360).match(/A/g)).toHaveLength(2);
    });

    it('clamps fractions and counts lit cells', () => {
        expect(WidgetGeometry.fraction(150, 100)).toBe(1);
        expect(WidgetGeometry.fraction(-5, 100)).toBe(0);
        expect(WidgetGeometry.fraction(5, 0)).toBe(0);
        expect(WidgetGeometry.litCount(50, 100, 20)).toBe(10);
        expect(WidgetGeometry.litCount(52, 100, 20)).toBe(10);
        expect(WidgetGeometry.litCount(53, 100, 20)).toBe(11);
    });

    it('stacks parts into segment owners', () => {
        // 30 + 40 + 10 of 100 over 10 cells: 3 × part 0, 4 × part 1, 1 × part 2, 2 unlit
        expect(WidgetGeometry.segmentOwners([30, 40, 10], 100, 10)).toEqual([0, 0, 0, 1, 1, 1, 1, 2, -1, -1]);
        expect(WidgetGeometry.segmentOwners([], 100, 3)).toEqual([-1, -1, -1]);
    });

    it('makes nice ticks and maps x back to values', () => {
        expect(WidgetGeometry.ticks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
        expect(WidgetGeometry.ticks(100, 500, 4)).toEqual([100, 200, 300, 400, 500]);
        expect(WidgetGeometry.valueAt(50, 0, 100, 0, 10)).toBe(5);
        expect(WidgetGeometry.valueAt(-20, 0, 100, 0, 10)).toBe(0);
        expect(WidgetGeometry.valueAt(33, 0, 100, 0, 100, 5)).toBe(35);
    });
});

describe('CalendarGeometry', () => {
    it('lays out whole weeks around the month', () => {
        // November 2026 starts on a Sunday
        const mon = CalendarGeometry.grid(2026, 10, 1);
        expect(mon.length % 7).toBe(0);
        expect(mon[0]!.date.getDate()).toBe(26); // Monday 26 Oct
        expect(mon[0]!.inMonth).toBe(false);
        expect(mon[6]!.date.getDate()).toBe(1);
        expect(mon[6]!.inMonth).toBe(true);

        const sun = CalendarGeometry.grid(2026, 10, 0);
        expect(sun[0]!.date.getDate()).toBe(1);
        expect(sun[0]!.weekday).toBe(0);
        expect(sun.filter((c) => c.inMonth)).toHaveLength(30);
        expect(CalendarGeometry.weekdays(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    });

    it('splits a range into one run per row with caps only at the real ends', () => {
        const cells = CalendarGeometry.grid(2026, 10, 0);
        // 13 … 17 Nov: Friday 13 to Tuesday 17 — wraps after Saturday 14
        const runs = CalendarGeometry.runs(cells, new Date(2026, 10, 17), new Date(2026, 10, 13));
        expect(runs).toEqual([
            {row: 1, from: 5, to: 6, startCap: true, endCap: false},
            {row: 2, from: 0, to: 2, startCap: false, endCap: true}
        ]);
        const one = CalendarGeometry.runs(cells, new Date(2026, 10, 4), new Date(2026, 10, 4));
        expect(one).toEqual([{row: 0, from: 3, to: 3, startCap: true, endCap: true}]);
    });

    it('counts days across DST and shifts months over the year end', () => {
        expect(CalendarGeometry.daysBetween(new Date(2026, 2, 28), new Date(2026, 2, 30))).toBe(2);
        expect(CalendarGeometry.shift(2026, 11, 1)).toEqual({year: 2027, month: 0});
        expect(CalendarGeometry.shift(2026, 0, -1)).toEqual({year: 2025, month: 11});
    });
});

describe('WorldMapGeometry', () => {
    it('decodes polyline-encoded rings', () => {
        // same encoder as scripts/worldmap.mjs
        const enc = (v: number): string => {
            let n = v < 0 ? ~(v << 1) : v << 1;
            let out = '';
            while (n >= 0x20) {
                out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
                n >>= 5;
            }
            return out + String.fromCharCode(n + 63);
        };
        const ring: [number, number][] = [[13.4, 52.5], [-77, 39], [151.2, -33.9], [-180, 0]];
        let px = 0;
        let py = 0;
        let s = '';
        for (const [lon, lat] of ring) {
            const x = Math.round(lon * 10);
            const y = Math.round(lat * 10);
            s += enc(x - px) + enc(y - py);
            px = x;
            py = y;
        }
        const pts = WorldMapGeometry.decode(s);
        expect(pts).toHaveLength(4);
        pts.forEach(([lon, lat], i) => {
            expect(lon).toBeCloseTo(ring[i]![0]);
            expect(lat).toBeCloseTo(ring[i]![1]);
        });
    });

    it('knows land from sea', () => {
        expect(WorldMapGeometry.land().length).toBeGreaterThan(50);
        expect(WorldMapGeometry.isLand(13.4, 52.5)).toBe(true); // Berlin
        expect(WorldMapGeometry.isLand(151.2, -33.9 + 0.5)).toBe(true); // near Sydney
        expect(WorldMapGeometry.isLand(-77, 39)).toBe(true); // Washington
        expect(WorldMapGeometry.isLand(-30, 30)).toBe(false); // mid Atlantic
        expect(WorldMapGeometry.isLand(-150, 0)).toBe(false); // Pacific
    });

    it('samples dots on land only', () => {
        const dots = WorldMapGeometry.dots(3, 84, -58);
        expect(dots.length).toBeGreaterThan(500);
        // a dot exactly on an edge may disagree with the point test; allow a handful
        const wrong = dots.filter(([lon, lat]) => !WorldMapGeometry.isLand(lon, lat));
        expect(wrong.length).toBeLessThan(dots.length / 200);
        expect(dots.every(([, lat]) => lat < 84 && lat > -58)).toBe(true);
    });

    it('projects equirectangularly from the top latitude', () => {
        expect(WorldMapGeometry.project(-180, 84, 84)).toEqual([0, 0]);
        expect(WorldMapGeometry.project(0, 0, 84)).toEqual([180, 84]);
    });
});
