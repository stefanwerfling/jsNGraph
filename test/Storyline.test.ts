import { describe, expect, it } from 'vitest';
import { StorylineData, StorylineLayout } from '../src/chart/StorylineLayout';

const ent = (id: string) => ({id, label: id});

describe('StorylineLayout.isotonic', () => {
    it('keeps a sorted sequence and pools violators to their weighted mean', () => {
        expect(StorylineLayout.isotonic([1, 2, 3], [1, 1, 1])).toEqual([1, 2, 3]);
        expect(StorylineLayout.isotonic([3, 1], [1, 1])).toEqual([2, 2]);
        expect(StorylineLayout.isotonic([4, 1, 5], [3, 1, 1])).toEqual([3.25, 3.25, 5]);
    });
});

describe('StorylineLayout', () => {
    // a and b meet in e1, split, c joins b in e3, everyone in e4
    const data: StorylineData = {
        entities: [ent('a'), ent('b'), ent('c')],
        events: [
            {id: 'e1', label: 'E1', time: 1, period: '2020'},
            {id: 'e2', label: 'E2', time: 2, period: '2020'},
            {id: 'e3', label: 'E3', time: 3, period: '2021'},
            {id: 'e4', label: 'E4', time: 4, period: '2022'}
        ],
        appearances: [
            {entity: 'a', event: 'e1'}, {entity: 'b', event: 'e1'},
            {entity: 'a', event: 'e2'},
            {entity: 'b', event: 'e3', weight: 3}, {entity: 'c', event: 'e3'},
            {entity: 'a', event: 'e4'}, {entity: 'b', event: 'e4'}, {entity: 'c', event: 'e4'}
        ]
    };
    const layout = new StorylineLayout({columnGap: 100, minWidth: 2, maxWidth: 10, minEventHeight: 0});
    const r = layout.layout(data);

    it('gives every time a column and prints a period only where it changes', () => {
        expect(r.columns.map((c) => c.x)).toEqual([0, 100, 200, 300]);
        expect(r.columns.map((c) => c.period)).toEqual(['2020', null, '2021', '2022']);
    });

    it('runs each entity from its first to its last appearance, idle in between', () => {
        const b = r.entities.get('b')!;
        expect(b.points.map((p) => p.column)).toEqual([0, 1, 2, 3]);
        expect(b.points.map((p) => p.event)).toEqual(['e1', null, 'e3', 'e4']);
        expect(r.entities.get('c')!.points.map((p) => p.column)).toEqual([2, 3]);
    });

    it('scales band width with the weight and keeps it while idle', () => {
        const b = r.entities.get('b')!.points;
        expect(b[2]!.width).toBe(10);
        expect(b[0]!.width).toBe(2);
        expect(b[1]!.width).toBe(2);
    });

    it('packs the members inside their event bar without overlap', () => {
        for (const ev of r.events.values()) {
            const pts = ev.members.map((id) => r.entities.get(id)!.points.find((p) => p.column === ev.column)!);
            for (const p of pts) {
                expect(p.y - p.width / 2).toBeGreaterThanOrEqual(ev.y0 - 1e-9);
                expect(p.y + p.width / 2).toBeLessThanOrEqual(ev.y1 + 1e-9);
            }
            for (let i = 1; i < pts.length; i++) {
                expect(pts[i]!.y - pts[i]!.width / 2).toBeGreaterThanOrEqual(pts[i - 1]!.y + pts[i - 1]!.width / 2 - 1e-9);
            }
        }
        expect(r.bounds.minY).toBe(0);
    });

    it('keeps groups of one column apart', () => {
        // column 1: a in e2, b idle — no overlap
        const a = r.entities.get('a')!.points.find((p) => p.column === 1)!;
        const b = r.entities.get('b')!.points.find((p) => p.column === 1)!;
        const e2 = r.events.get('e2')!;
        const idleInside = b.y + b.width / 2 > e2.y0 && b.y - b.width / 2 < e2.y1;
        expect(idleInside).toBe(false);
        expect(a.event).toBe('e2');
    });

    it('untangles an ordering where possible', () => {
        // x/y swap partners between two events — the sweep should find 0 crossings
        const swap: StorylineData = {
            entities: [ent('p'), ent('q'), ent('r'), ent('s')],
            events: [
                {id: 'm1', label: '', time: 1}, {id: 'm2', label: '', time: 1},
                {id: 'n1', label: '', time: 2}, {id: 'n2', label: '', time: 2}
            ],
            appearances: [
                {entity: 'p', event: 'm1'}, {entity: 'q', event: 'm2'}, {entity: 'r', event: 'm1'}, {entity: 's', event: 'm2'},
                {entity: 'p', event: 'n2'}, {entity: 'r', event: 'n2'}, {entity: 'q', event: 'n1'}, {entity: 's', event: 'n1'}
            ]
        };
        expect(new StorylineLayout().layout(swap).crossings).toBe(0);
    });

    it('straightens a band that only passes by', () => {
        const straight: StorylineData = {
            entities: [ent('a'), ent('b')],
            events: [1, 2, 3, 4, 5].map((t) => ({id: `t${t}`, label: '', time: t})),
            appearances: [
                {entity: 'a', event: 't1'}, {entity: 'a', event: 't5'},
                {entity: 'b', event: 't2'}, {entity: 'b', event: 't3'}, {entity: 'b', event: 't4'}
            ]
        };
        const a = new StorylineLayout({minEventHeight: 0}).layout(straight).entities.get('a')!.points;
        const ys = a.map((p) => p.y);
        expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
    });
});
