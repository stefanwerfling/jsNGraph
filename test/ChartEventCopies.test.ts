// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ChartRange } from '../src/chart/ChartScale';
import { DepthChart } from '../src/chart/DepthChart';
import { EncounterHover, EncounterRose } from '../src/chart/EncounterRose';
import { LineageChart, LineageHover } from '../src/chart/LineageChart';
import { RootsActor, RootsChart, RootsHover } from '../src/chart/RootsChart';
import { StreamChart } from '../src/chart/StreamChart';
import { TimeSeriesChart } from '../src/chart/TimeSeriesChart';
import { VolumeHit, VolumeView } from '../src/chart/VolumeView';
import { FakeCanvas } from './support/FakeCanvas';

beforeAll(() => FakeCanvas.install());

const charts: Array<{destroy(): void}> = [];

afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const host = (): HTMLElement => document.body.appendChild(document.createElement('div'));

const keep = <T extends {destroy(): void}>(chart: T): T => {
    charts.push(chart);
    return chart;
};

/** Private members reached from the test (payload builders and copy helpers). */
const priv = <T>(target: unknown): T => target as T;

describe('chart event payloads are copies', () => {
    it('rangeChange payloads do not alias the view', () => {
        const ranges: ChartRange[] = [];
        const time = keep(new TimeSeriesChart(host(), {series: [{t: [0, 1000, 2000], values: [1, 2, 3]}]}));

        time.on('rangeChange', (r) => ranges.push(r));
        time.setRange(null, false);
        ranges[0]!.min = -99;
        expect(time.getRange().min).toBe(0);

        const depth = keep(new DepthChart(host(), {bids: [{price: 9, quantity: 1}], asks: [{price: 11, quantity: 2}]}));
        depth.on('rangeChange', (r) => ranges.push(r));
        depth.setRange({min: 8, max: 12});
        ranges[1]!.min = -99;
        expect(priv<{view: ChartRange}>(depth).view.min).toBe(8);

        const stream = keep(new StreamChart(host(), {
            data: {x: [0, 1, 2, 3], layers: [{id: 'a', label: 'A'}], panels: [{values: [[1, 2, 3, 4]]}]}, animate: false
        }));
        stream.on('rangeChange', (r) => ranges.push(r));
        stream.setRange(null);
        const domain = {...ranges[2]!};
        ranges[2]!.min = -99;
        stream.setRange(null);
        expect(ranges[3]).toEqual(domain);
    });

    it('hover payloads carry their own data', () => {
        const encounters = [{id: 'e', category: 'c', fixes: [{t: 0, x: 0, y: 0}, {t: 10, x: 5, y: 5}]}];
        const rose = keep(new EncounterRose(host(), {encounters, categories: [{id: 'c', name: 'C', color: '#f00'}]}));
        const prepared = priv<{prepared: unknown[]}>(rose).prepared;
        const toHover = priv<{toHover(p: unknown): EncounterHover}>(rose).toHover.bind(rose);
        const first = toHover(prepared[0]);

        first.encounter.fixes[1]!.x = 500;
        first.category!.color = '#000';
        expect(toHover(prepared[0]).encounter.fixes[1]!.x).toBe(5);
        expect(toHover(prepared[0]).category!.color).toBe('#f00');

        const lineage = keep(new LineageChart(host(), {nodes: [
            {id: 'a', label: 'A', year: 1970}, {id: 'b', label: 'B', year: 1980, parent: 'a'}
        ]}));
        const info = priv<{info(id: string): LineageHover}>(lineage).info.bind(lineage);
        const hover = info('b');

        hover.node.label = 'x';
        hover.parent!.label = 'y';
        expect(info('b').node.label).toBe('B');
        expect(info('b').parent!.label).toBe('A');
        info('a').children[0]!.label = 'z';
        expect(info('b').node.label).toBe('B');
    });

    it('roots hover copies actors and categories', () => {
        const roots = keep(new RootsChart(host(), {
            categories: [{id: 'x', name: 'X', color: '#f00'}],
            actors: [{id: 'p', name: 'P', year: 1900, categories: ['x'], contribution: {year: 1910, label: 'L'}}]
        }));
        const hoverInfo = priv<{hoverInfo(f: unknown): RootsHover}>(roots).hoverInfo.bind(roots);
        const actor = hoverInfo({kind: 'actor', id: 'p'}) as {actor: RootsActor; categories: Array<{name: string}>};

        actor.actor.categories.push('y');
        actor.actor.contribution!.label = 'changed';
        actor.categories[0]!.name = 'changed';
        const again = hoverInfo({kind: 'actor', id: 'p'}) as {actor: RootsActor; categories: Array<{name: string}>};
        expect(again.actor.categories).toEqual(['x']);
        expect(again.actor.contribution!.label).toBe('L');
        expect(again.categories[0]!.name).toBe('X');
    });

    it('volume hits get their own values array', () => {
        const copyHit = priv<{copyHit(h: VolumeHit | null): VolumeHit | null}>(VolumeView).copyHit;
        const hit: VolumeHit = {u: 0.1, v: 0.2, w: 0.3, values: [1, 2]};
        const copy = copyHit(hit)!;

        copy.values[0] = 9;
        expect(hit.values[0]).toBe(1);
        expect(copyHit(null)).toBeNull();
    });
});
