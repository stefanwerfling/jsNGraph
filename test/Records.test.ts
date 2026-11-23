import { describe, expect, it } from 'vitest';
import { RecordLayout } from '../src/records/RecordLayout';
import { RecordQuery } from '../src/records/RecordQuery';
import { RecordGraphData, RecordNode } from '../src/records/RecordTypes';

const card = (id: string, rows: string[], extra: Partial<RecordNode> = {}): RecordNode =>
    ({id, title: id, rows: rows.map((r) => ({id: r, label: r, value: 3})), ...extra});
const link = (a: string, ar: string, b: string, br: string, id?: string) => ({id, from: {node: a, row: ar}, to: {node: b, row: br}});

// mine → smelter → frame → shop → recycling → smelter (loop)
const data: RecordGraphData = {
    nodes: [
        card('mine', ['ore']),
        card('smelter', ['steel', 'alu'], {group: 'metal'}),
        card('tubes', ['tube'], {group: 'metal'}),
        card('frame', ['frame']),
        card('paint', ['paint']),
        card('shop', ['bike', 'waste']),
        card('recycling', ['scrap'])
    ],
    links: [
        link('mine', 'ore', 'smelter', 'steel', 'l0'),
        link('mine', 'ore', 'smelter', 'alu', 'l1'),
        link('smelter', 'alu', 'tubes', 'tube', 'l2'),
        link('tubes', 'tube', 'frame', 'frame', 'l3'),
        link('paint', 'paint', 'shop', 'bike', 'l4'),
        link('frame', 'frame', 'shop', 'bike', 'l5'),
        link('shop', 'waste', 'recycling', 'scrap', 'l6'),
        link('recycling', 'scrap', 'smelter', 'steel', 'l7')
    ],
    groups: [{id: 'metal', label: 'Metal works'}]
};

describe('RecordLayout.columns', () => {
    it('ranks by longest path and breaks the recycling loop', () => {
        const c = RecordLayout.columns(data.nodes, data.links);
        expect(Object.fromEntries(c)).toEqual({mine: 0, smelter: 1, tubes: 2, frame: 3, paint: 0, shop: 4, recycling: 5});
    });

    it('lets a fixed column win', () => {
        const nodes = data.nodes.map((n) => (n.id === 'paint' ? {...n, column: 3} : n));
        expect(RecordLayout.columns(nodes, data.links).get('paint')).toBe(3);
    });
});

describe('RecordLayout', () => {
    const layout = new RecordLayout();
    const r = layout.layout(data);

    it('places rows inside their card and cards in their column', () => {
        const smelter = r.records.get('smelter')!;
        expect(smelter.x).toBe(layout.columnX(1));
        expect(smelter.h).toBe(50 + 2 * 19 + 6);
        expect(smelter.rows.get('steel')).toBe(smelter.y + 50 + 9.5);
        expect(smelter.rows.get('alu')).toBe(smelter.y + 50 + 28.5);
    });

    it('frames a group around its members, and no foreign card overlaps a frame', () => {
        const g = r.groups.get('metal')!;
        for (const m of ['smelter', 'tubes']) {
            const rec = r.records.get(m)!;
            expect(rec.x).toBeGreaterThan(g.x);
            expect(rec.x + rec.w).toBeLessThan(g.x + g.w);
            expect(rec.y).toBeGreaterThan(g.y);
            expect(rec.y + rec.h).toBeLessThan(g.y + g.h);
        }
        for (const rec of r.records.values()) {
            if (rec.group === null) {
                const overlap = rec.x < g.x + g.w && rec.x + rec.w > g.x && rec.y < g.y + g.h && rec.y + rec.h > g.y;
                expect(overlap).toBe(false);
            }
        }
    });

    it('never overlaps two cards', () => {
        const list = [...r.records.values()];
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i]!;
                const b = list[j]!;
                expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(false);
            }
        }
    });

    it('routes forward links row to row and the loop under everything', () => {
        const fwd = r.links.find((l) => l.ids[0] === 'l2')!;
        expect(fwd.kind).toBe('forward');
        expect(fwd.points[0]).toEqual({x: r.records.get('smelter')!.x + 170, y: r.records.get('smelter')!.rows.get('alu')});
        expect(fwd.points[1]).toEqual({x: r.records.get('tubes')!.x, y: r.records.get('tubes')!.rows.get('tube')});

        const back = r.links.find((l) => l.ids[0] === 'l7')!;
        expect(back.kind).toBe('back');
        const lowest = Math.max(...[...r.records.values()].map((x) => x.y + x.h), ...[...r.groups.values()].map((g) => g.y + g.h));
        expect(back.points[2]!.y).toBeGreaterThan(lowest);
        expect(r.bounds.maxY).toBeGreaterThanOrEqual(back.points[2]!.y);
    });

    it('collapses a group into one box and merges its links', () => {
        const folded = layout.layout({...data, groups: [{id: 'metal', label: 'Metal works', collapsed: true}]});
        expect(folded.records.has('smelter')).toBe(false);
        const box = folded.groups.get('metal')!;
        expect(box.collapsed).toBe(true);
        // l0 + l1 (mine.ore → two hidden rows) become one route; l2 is internal and dropped
        const fromMine = folded.links.filter((l) => l.from.node === 'mine');
        expect(fromMine).toHaveLength(1);
        expect(fromMine[0]!.ids).toEqual(['l0', 'l1']);
        expect(fromMine[0]!.points[1]).toEqual({x: box.x, y: box.y + box.h / 2});
        expect(folded.links.some((l) => l.ids.includes('l2'))).toBe(false);
    });
});

describe('RecordQuery', () => {
    it('follows a row up- and downstream without spilling into siblings', () => {
        const lin = RecordQuery.lineage({node: 'paint', row: 'paint'}, data.links);
        expect(lin.links.has('l4')).toBe(true);
        expect(lin.links.has('l5')).toBe(false);   // frame → bike is a sibling input, not this flow
        expect(lin.rows.has(RecordQuery.key({node: 'shop', row: 'bike'}))).toBe(true);
        expect(lin.rows.has(RecordQuery.key({node: 'frame', row: 'frame'}))).toBe(false);
    });

    it('terminates on the loop', () => {
        const lin = RecordQuery.lineage({node: 'recycling', row: 'scrap'}, data.links);
        expect(lin.links.has('l7')).toBe(true);
        expect(lin.links.has('l6')).toBe(true);
    });

    it('produces one unit from its inputs and refuses when one is empty', () => {
        const copy: RecordGraphData = structuredClone(data);
        expect(RecordQuery.produce(copy, {node: 'shop', row: 'bike'})).toBe(true);
        const v = (n: string, r: string) => copy.nodes.find((x) => x.id === n)!.rows.find((x) => x.id === r)!.value;
        expect(v('shop', 'bike')).toBe(4);
        expect(v('paint', 'paint')).toBe(2);
        expect(v('frame', 'frame')).toBe(2);

        copy.nodes.find((x) => x.id === 'paint')!.rows[0]!.value = 0;
        expect(RecordQuery.produce(copy, {node: 'shop', row: 'bike'})).toBe(false);
        expect(v('shop', 'bike')).toBe(4);
        expect(v('frame', 'frame')).toBe(2);
    });
});
