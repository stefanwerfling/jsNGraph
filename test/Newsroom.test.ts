import { describe, expect, it } from 'vitest';
import { AreaLayout } from '../src/chart/AreaLayout';
import { BarLayout } from '../src/chart/BarLayout';
import { ChartNotes } from '../src/chart/ChartNotes';
import { UnitLayout } from '../src/chart/UnitLayout';
import { ChoroplethGeometry, ColorScale } from '../src/widget/ChoroplethGeometry';
import { ParliamentGeometry } from '../src/widget/ParliamentGeometry';

describe('BarLayout', () => {
    const panels = [
        {series: [{values: [3, 9, 6]}, {values: [1, 2, -4]}]},
        {series: [{values: [2, 3, 2]}, {values: [1, 1, 1]}]}
    ];

    it('takes one nice range over all panels, 0 included', () => {
        expect(BarLayout.range(panels, 'grouped', 3)).toEqual({min: -5, max: 10});
        // stacked: positives 9+2 = 11, negatives -4
        const stacked = BarLayout.range(panels, 'stacked', 3);
        expect(stacked.max).toBeGreaterThanOrEqual(11);
        expect(stacked.min).toBeLessThanOrEqual(-4);
    });

    it('places grouped bars side by side and stacked bars on top of each other', () => {
        const rect = {x: 0, y: 0, w: 300, h: 100};
        const range = {min: 0, max: 10};
        const grouped = BarLayout.bars({series: [{values: [5]}, {values: [10]}]}, 0, 1, rect, range, 'grouped');

        expect(grouped).toHaveLength(2);
        expect(grouped[0]!.x + grouped[0]!.w).toBeLessThan(grouped[1]!.x + 0.01 + 1);
        expect(grouped[0]!.h).toBeCloseTo(50);
        expect(grouped[1]!.y).toBeCloseTo(0);

        const stacked = BarLayout.bars({series: [{values: [4]}, {values: [6]}]}, 0, 1, rect, range, 'stacked');
        expect(stacked[0]!.x).toBe(stacked[1]!.x);
        expect(stacked[0]!.y).toBeCloseTo(60);           // 0…4 → px 100…60
        expect(stacked[1]!.y + stacked[1]!.h).toBeCloseTo(60);
        expect(stacked[1]!.y).toBeCloseTo(0);

        expect(BarLayout.hit(stacked, 150, 80)?.series).toBe(0);
        expect(BarLayout.hit(stacked, 150, 30)?.series).toBe(1);
        expect(BarLayout.hit(stacked, 5, 30)).toBeNull();
    });
});

describe('UnitLayout', () => {
    it('bins units and stacks them by category, then value', () => {
        const units = [
            {value: 1.2, category: 'lost'},
            {value: 1.9, category: 'won'},
            {value: 1.5, category: 'won'},
            {value: -0.5, category: 'won', panel: 'b'},
            {value: 7, category: 'won', panel: 'zzz'}       // unknown panel: dropped
        ];
        const r = UnitLayout.place(units, {
            binWidth: 1, categories: [{id: 'won', label: 'Won'}, {id: 'lost', label: 'Lost'}], panels: [{id: 'a'}, {id: 'b'}]
        });

        expect(r.cells).toHaveLength(4);
        expect(r.maxStack).toBe(3);
        expect(r.minBin).toBe(-1);
        expect(r.maxBin).toBe(1);

        const bin1 = r.cells.filter((c) => c.panel === 0 && c.bin === 1).sort((a, b) => a.stack - b.stack);
        expect(bin1.map((c) => units[c.unit]!.value)).toEqual([1.5, 1.9, 1.2]);
        expect(r.cells.find((c) => c.unit === 3)!.panel).toBe(1);
    });

    it('puts values on a bin edge into the upper bin', () => {
        expect(UnitLayout.binOf(2, 2)).toBe(1);
        expect(UnitLayout.binOf(-0.1, 2)).toBe(-1);
        expect(UnitLayout.binOf(5, 2, 1)).toBe(2);
    });
});

describe('AreaLayout', () => {
    const values = [[1, 2, 3], [3, 2, 1]];

    it('stacks on zero', () => {
        const b = AreaLayout.stack(values, 3, 'zero');
        expect(b[1]!.lower).toEqual([1, 2, 3]);
        expect(b[1]!.upper).toEqual([4, 4, 4]);
        expect(AreaLayout.range(b)).toEqual({min: 0, max: 4});
    });

    it('stretches shares to 1 and leaves overlapping series alone', () => {
        const e = AreaLayout.stack(values, 3, 'expand');
        expect(e[0]!.upper[0]).toBeCloseTo(0.25);
        expect(e[1]!.upper.every((v) => Math.abs(v - 1) < 1e-9)).toBe(true);

        const none = AreaLayout.stack(values, 3, 'none');
        expect(none[1]!.lower).toEqual([0, 0, 0]);
        expect(none[1]!.upper).toEqual([3, 2, 1]);
    });
});

describe('ParliamentGeometry', () => {
    it('places exactly the seats asked for, left to right', () => {
        for (const total of [1, 7, 101, 349, 650]) {
            const {seats, radius} = ParliamentGeometry.seats(total);
            expect(seats).toHaveLength(total);
            expect(radius).toBeGreaterThan(0);
            for (let i = 1; i < seats.length; i++) {
                expect(seats[i]!.angle).toBeLessThanOrEqual(seats[i - 1]!.angle + 1e-12);
            }
        }
    });

    it('keeps seats from overlapping', () => {
        const {seats, radius} = ParliamentGeometry.seats(349);
        let closest = Infinity;

        for (let i = 0; i < seats.length; i++) {
            for (let j = i + 1; j < seats.length; j++) {
                closest = Math.min(closest, Math.hypot(seats[i]!.x - seats[j]!.x, seats[i]!.y - seats[j]!.y));
            }
        }
        expect(closest).toBeGreaterThan(radius * 2);
    });

    it('fills parties in order and leaves the rest empty', () => {
        expect(ParliamentGeometry.assign([2, 1], 5)).toEqual([0, 0, 1, -1, -1]);
    });
});

describe('ChoroplethGeometry', () => {
    const square = {type: 'Feature', properties: {code: 'A', name: 'Alpha'},
        geometry: {type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]}};
    const multi = {type: 'Feature', id: 7, properties: null,
        geometry: {type: 'MultiPolygon', coordinates: [[[[20, 0], [30, 0], [30, 5], [20, 0]]], [[[40, 0], [41, 0], [41, 1], [40, 0]]]]}};

    it('reads GeoJSON features with ids and names', () => {
        const r = ChoroplethGeometry.fromGeoJSON({features: [square, multi]}, {idProperty: 'code'});
        expect(r[0]).toMatchObject({id: 'A', name: 'Alpha'});
        expect(r[0]!.polygons).toHaveLength(1);
        expect(r[1]!.id).toBe('1');       // idProperty missing → index
        expect(r[1]!.polygons).toHaveLength(2);
        expect(ChoroplethGeometry.fromGeoJSON({features: [multi]})[0]!.id).toBe('7');
    });

    it('fits the plane to the view box and writes closed paths', () => {
        const regions = ChoroplethGeometry.fromGeoJSON({features: [square]});
        const fit = ChoroplethGeometry.fit(ChoroplethGeometry.bounds(regions, 'none'), 100);

        expect(fit).toMatchObject({scale: 10, width: 100, height: 100});
        expect(ChoroplethGeometry.path(regions[0]!.polygons, 'none', fit)).toBe('M0 0L100 0L100 100L0 100L0 0Z');
    });

    it('projects north up and stretches high latitudes with mercator', () => {
        const [, yEq] = ChoroplethGeometry.project([0, 0], 'mercator');
        const [, y60] = ChoroplethGeometry.project([0, 60], 'mercator');
        const [, y60e] = ChoroplethGeometry.project([0, 60], 'equirectangular');

        expect(yEq).toBeCloseTo(0);
        expect(y60).toBeLessThan(y60e);       // further up than plain degrees
        expect(ChoroplethGeometry.project([5, 5], 'none')).toEqual([5, 5]);
    });
});

describe('ColorScale', () => {
    it('steps through thresholds', () => {
        const s = ColorScale.threshold([10, 20], ['#000000', '#888888', '#ffffff']);
        expect(s(5)).toBe('#000000');
        expect(s(10)).toBe('#888888');
        expect(s(25)).toBe('#ffffff');
    });

    it('ramps and diverges', () => {
        const ramp = ColorScale.sequential([0, 10], ['#000000', '#ffffff']);
        expect(ramp(-5)).toBe(ramp(0));
        expect(ramp(5)).not.toBe(ramp(0));
        const div = ColorScale.diverging([-1, 0, 1], ['#0000ff', '#ffffff', '#ff0000']);
        expect(div(0)).toBe(ramp(10));
    });
});

describe('ChartNotes.pointer', () => {
    const box = {x: 100, y: 100, w: 80, h: 30};

    it('leaves from the facing edge and skips anchors inside the box', () => {
        expect(ChartNotes.pointer(box, {x: 120, y: 110}, 'curve')).toBeNull();

        const below = ChartNotes.pointer(box, {x: 140, y: 200}, 'straight')!;
        expect(below.path.startsWith('M140.0,133.0')).toBe(true);

        const left = ChartNotes.pointer(box, {x: 20, y: 115}, 'curve')!;
        expect(left.path.startsWith('M97.0,115.0 Q')).toBe(true);
    });
});
