// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AreaChart } from '../src/chart/AreaChart';
import { AssociationSky } from '../src/chart/AssociationSky';
import { BarChart } from '../src/chart/BarChart';
import { CHART_FONT, ChartSurface } from '../src/chart/ChartSurface';
import { ChartTheme } from '../src/chart/ChartTheme';
import { DepthChart } from '../src/chart/DepthChart';
import { EncounterData, EncounterRose } from '../src/chart/EncounterRose';
import { HoloScene, HoloTable } from '../src/chart/HoloTable';
import { LineageChart } from '../src/chart/LineageChart';
import { LineChart } from '../src/chart/LineChart';
import { BurstItem, OutcomeBurst } from '../src/chart/OutcomeBurst';
import { PhaseRing, PhaseSeries } from '../src/chart/PhaseRing';
import { RadarChart } from '../src/chart/RadarChart';
import { RadarScope, ScopeTarget } from '../src/chart/RadarScope';
import { RootsChart } from '../src/chart/RootsChart';
import { RootsFans } from '../src/chart/RootsFans';
import { StorylineChart } from '../src/chart/StorylineChart';
import { StreamChart } from '../src/chart/StreamChart';
import { StreamData } from '../src/chart/StreamLayout';
import { TimeSeriesChart } from '../src/chart/TimeSeriesChart';
import { UnitHistogram } from '../src/chart/UnitHistogram';
import { VolumeChannel, VolumeView } from '../src/chart/VolumeView';
import { WaterfallChart } from '../src/chart/WaterfallChart';
import { FakeCanvas } from './support/FakeCanvas';

beforeAll(() => {
    FakeCanvas.install();
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    proto.setPointerCapture ??= () => undefined;
    proto.releasePointerCapture ??= () => undefined;
    proto.hasPointerCapture ??= () => false;
});

const charts: Array<{destroy(): void}> = [];

afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const host = (): HTMLElement => document.body.appendChild(document.createElement('div'));

const keep = <T extends {destroy(): void}>(chart: T): T => {
    charts.push(chart);
    return chart;
};

const pointer = (type: string): PointerEvent => new PointerEvent(type, {clientX: 10, clientY: 10, button: 0, pointerId: 1});

describe('ChartSurface', () => {
    it('on/off are chainable', () => {
        const chart = keep(new LineChart(host()));
        const fn = (): void => undefined;

        expect(chart.on('hover', fn)).toBe(chart);
        expect(chart.off('hover', fn)).toBe(chart);
    });

    it('keeps CHART_FONT as an alias of ChartSurface.FONT', () => {
        expect(CHART_FONT).toBe(ChartSurface.FONT);
    });

    it('built-in themes cannot be changed from outside', () => {
        expect(Object.isFrozen(ChartTheme.dark)).toBe(true);
        expect(Object.isFrozen(ChartTheme.light)).toBe(true);
        expect(ChartTheme.resolve({text: '#000'})).not.toBe(ChartTheme.dark);
    });
});

describe('getters return copies, inputs are copied', () => {
    it('StreamChart data and layout', () => {
        const data: StreamData = {x: [0, 1, 2], layers: [{id: 'a', label: 'A'}], panels: [{values: [[1, 2, 3]]}]};
        const chart = keep(new StreamChart(host(), {data, animate: false}));

        data.layers[0]!.label = 'changed';
        (data.panels[0]!.values[0] as number[])[0] = 99;
        const got = chart.getData();
        expect(got.layers[0]!.label).toBe('A');
        expect(got.panels[0]!.values[0]![0]).toBe(1);

        got.layers[0]!.label = 'x';
        expect(chart.getData().layers[0]!.label).toBe('A');

        const layout = chart.getLayout()!;
        layout.order.push(42);
        layout.xs[0] = -1;
        expect(chart.getLayout()!.order).not.toContain(42);
        expect(chart.getLayout()!.xs[0]).not.toBe(-1);
    });

    it('DepthChart book', () => {
        const chart = keep(new DepthChart(host(), {bids: [{price: 9, quantity: 1}], asks: [{price: 11, quantity: 2}]}));
        const book = chart.getBook();

        book.bids[0]!.quantity = 100;
        book.asks.length = 0;
        expect(chart.getBook().bids[0]!.quantity).toBe(1);
        expect(chart.getBook().asks).toHaveLength(1);
    });

    it('BarChart panels and AreaChart series', () => {
        const bar = keep(new BarChart(host(), {categories: ['a'], series: [{values: [1]}]}));
        bar.getData().panels[0]!.series[0]!.values[0] = 50;
        expect(bar.getData().panels[0]!.series[0]!.values[0]).toBe(1);

        const area = keep(new AreaChart(host(), {x: [0, 1], series: [{name: 's', values: [1, 2]}]}));
        area.getData().series[0]!.values[0] = 50;
        expect(area.getData().series[0]!.values[0]).toBe(1);
    });

    it('LineChart, WaterfallChart, TimeSeriesChart and UnitHistogram series', () => {
        const line = keep(new LineChart(host(), {series: [{y: [1, 2]}]}));
        (line.getSeries()[0]!.y as number[])[0] = 9;
        expect(line.getSeries()[0]!.y[0]).toBe(1);

        const fall = keep(new WaterfallChart(host(), {series: [{y: [1, 2]}]}));
        (fall.getSeries()[0]!.y as number[])[0] = 9;
        expect(fall.getSeries()[0]!.y[0]).toBe(1);

        const time = keep(new TimeSeriesChart(host(), {series: [{t: [0, 1000], values: [1, 2]}]}));
        time.getSeries()[0]!.values[0] = 9;
        expect(time.getSeries()[0]!.values[0]).toBe(1);
        const r = time.getRange();
        r.min = -5;
        expect(time.getRange().min).not.toBe(-5);

        const units = [{value: 1}];
        const hist = keep(new UnitHistogram(host(), {units}));
        units[0]!.value = 7;
        expect(hist.getUnits()[0]!.value).toBe(1);
    });

    it('RadarChart series and value range', () => {
        const series = [{name: 'a', values: [1, 2, 3]}];
        const chart = keep(new RadarChart(host(), {categories: ['x', 'y', 'z'], series, valueRange: {min: 0, max: 10}}));

        (series[0]!.values as number[])[0] = 9;
        expect(chart.getSeries()[0]!.values[0]).toBe(1);

        const r = chart.valueRange;
        r.max = 99;
        expect(chart.valueRange).toEqual({min: 0, max: 10});

        chart.setValueRange({min: 0, max: 5});
        expect(chart.valueRange.max).toBe(5);
        chart.setRange({min: 0, max: 7});           // deprecated alias
        expect(chart.range.max).toBe(7);
        chart.setValueRange(null);
        expect(chart.valueRange.max).toBeGreaterThanOrEqual(3);

        const legacy = keep(new RadarChart(host(), {categories: ['x'], range: {min: 0, max: 4}}));
        expect(legacy.valueRange.max).toBe(4);
    });

    it('RadarScope targets', () => {
        const targets: ScopeTarget[] = [{id: 't', bearing: 10, range: 5}];
        const scope = keep(new RadarScope(host(), {targets}));

        targets[0]!.bearing = 200;
        expect(scope.getTargets()[0]!.bearing).toBe(10);
        (scope.getTargets()[0] as ScopeTarget).range = 1;
        expect(scope.getTargets()[0]!.range).toBe(5);
    });

    it('HoloTable scene', () => {
        const scene: Partial<HoloScene> = {panels: [{id: 'p', x: 0, y: 0, w: 10, h: 10}]};
        const table = keep(new HoloTable(host(), {scene}));

        scene.panels![0]!.w = 99;
        expect(table.getScene().panels[0]!.w).toBe(10);
        table.getScene().panels.push({id: 'q', x: 0, y: 0, w: 1, h: 1});
        expect(table.getScene().panels).toHaveLength(1);

        const update: Partial<HoloScene> = {panels: [{id: 'r', x: 1, y: 1, w: 2, h: 2}]};
        table.setScene(update);
        update.panels![0]!.x = 50;
        expect(table.getScene().panels[0]!.x).toBe(1);
    });

    it('PhaseRing series', () => {
        const series: PhaseSeries[] = [{name: 's', values: [1, 2, 3, 4]}];
        const ring = keep(new PhaseRing(host(), {series}));

        series[0]!.values[0] = 40;
        expect(ring.getSeries()[0]!.values[0]).toBe(1);

        const next: PhaseSeries[] = [{name: 'n', values: [5, 6, 7, 8]}];
        ring.setSeries(next, {animate: false});
        next[0]!.name = 'changed';
        expect(ring.getSeries()[0]!.name).toBe('n');
    });

    it('OutcomeBurst items', () => {
        const items: BurstItem[] = [{id: 'a', group: 'g', label: 'l', count: 10, probability: 0.8}];
        const burst = keep(new OutcomeBurst(host(), {items}));

        items[0]!.count = 1000;
        expect(burst.getVisible()[0]!.count).toBe(10);
        burst.getVisible()[0]!.count = 5;
        expect(burst.getVisible()[0]!.count).toBe(10);
    });

    it('EncounterRose encounters', () => {
        const enc: EncounterData[] = [{id: 'e', category: 'c', fixes: [{t: 0, x: 0, y: 0}, {t: 10, x: 5, y: 5}]}];
        const rose = keep(new EncounterRose(host(), {encounters: enc, categories: [{id: 'c', name: 'C', color: '#f00'}]}));

        enc[0]!.fixes[1]!.x = 500;
        enc[0]!.label = 'changed';
        const got = rose.getVisible()[0]!.encounter;
        expect(got.fixes[1]!.x).toBe(5);
        expect(got.label).toBeUndefined();
        got.fixes[1]!.x = 1;
        expect(rose.getVisible()[0]!.encounter.fixes[1]!.x).toBe(5);
    });

    it('AssociationSky units, info and encounters', () => {
        const sky = keep(new AssociationSky(host(), {
            individuals: [{id: 'a', category: 'c'}, {id: 'b', category: 'c'}],
            categories: [{id: 'c', name: 'C', color: '#fff'}],
            encounters: [{t: 1, ids: ['a', 'b']}, {t: 2, ids: ['a', 'b']}],
            unitHwi: 0.5
        }));

        sky.getUnits()[0]?.members.push('x');
        expect(sky.getUnits()[0]?.members).not.toContain('x');
        sky.getEncounters()[0]!.ids = [];
        expect(sky.getEncounters()[0]!.ids).toEqual(['a', 'b']);
        const info = sky.getInfo('a')!;
        info.individual.category = 'z';
        info.tally.sightings = 0;
        expect(sky.getInfo('a')!.individual.category).toBe('c');
        expect(sky.getInfo('a')!.tally.sightings).toBe(2);
    });

    it('VolumeView channels: setChannelVisible no longer writes into the caller object', () => {
        const channels: VolumeChannel[] = [{name: 'a', color: '#fff'}];
        const view = keep(new VolumeView(host(), {channels}));

        view.setChannelVisible(0, false);
        expect(channels[0]!.visible).toBeUndefined();
    });

    it('StorylineChart layout', () => {
        const chart = keep(new StorylineChart(host(), {data: {
            events: [{id: 'e1', label: 'E1', time: 1}, {id: 'e2', label: 'E2', time: 2}],
            entities: [{id: 'a', label: 'A'}, {id: 'b', label: 'B'}],
            appearances: [{entity: 'a', event: 'e1'}, {entity: 'b', event: 'e1'}, {entity: 'a', event: 'e2'}]
        }}));

        const layout = chart.getLayout()!;
        layout.events.clear();
        expect(chart.getLayout()!.events.size).toBe(2);
    });
});

describe('boolean state getters', () => {
    it('EncounterRose.playing (isPlaying stays as an alias)', () => {
        const rose = keep(new EncounterRose(host(), {encounters: [{id: 'e', category: 'c', fixes: [{t: 0, x: 0, y: 0}, {t: 10, x: 1, y: 1}]}]}));

        expect(rose.playing).toBe(false);
        rose.play();
        expect(rose.playing).toBe(true);
        expect(rose.isPlaying()).toBe(true);
        rose.pause();
        expect(rose.playing).toBe(false);
    });

    it('VolumeView.supported (isSupported stays as an alias)', () => {
        const view = keep(new VolumeView(host()));

        expect(view.supported).toBe(view.isSupported());
        expect(view.supported).toBe(false);       // no WebGL2 under happy-dom
    });

    it('HoloTable / RadarScope paused', () => {
        const table = keep(new HoloTable(host()));
        const scope = keep(new RadarScope(host()));

        expect(table.paused).toBe(false);
        table.setPaused(true);
        expect(table.paused).toBe(true);
        scope.setPaused(true);
        expect(scope.paused).toBe(true);
    });
});

describe('resetView everywhere', () => {
    it('StreamChart: resetView (and the deprecated resetZoom) show everything', () => {
        const chart = keep(new StreamChart(host(), {data: {x: [0, 1, 2, 3], layers: [{id: 'a', label: 'A'}], panels: [{values: [[1, 2, 3, 4]]}]}, animate: false}));
        const range = vi.fn();
        chart.on('rangeChange', range);

        chart.setRange({min: 1, max: 2});
        chart.resetView();
        expect(range).toHaveBeenLastCalledWith(chart.getLayout()!.domain);
        chart.setRange({min: 1, max: 2});
        chart.resetZoom();
        expect(range).toHaveBeenLastCalledWith(chart.getLayout()!.domain);
    });

    it('WaterfallChart and DepthChart reset their x range', () => {
        const fall = keep(new WaterfallChart(host(), {series: [{y: [1, 2, 3, 4]}]}));
        fall.setXRange({min: 1, max: 2});
        fall.resetView();
        expect(fall.xVisible).toEqual({min: 0, max: 3});

        const depth = keep(new DepthChart(host(), {bids: [{price: 9, quantity: 1}], asks: [{price: 11, quantity: 2}]}));
        const range = vi.fn();
        depth.on('rangeChange', range);
        depth.setRange({min: 10, max: 10.5});
        depth.resetView();
        expect(range.mock.calls[range.mock.calls.length - 1]![0]).not.toEqual({min: 10, max: 10.5});
    });

    it('PhaseRing, Lineage, Roots, Storyline, TimeSeries and EncounterRose have one', () => {
        const ring = keep(new PhaseRing(host(), {series: [{name: 's', values: [1, 2]}], yaw: 10, tilt: 30}));
        ring.setView({yaw: 90, tilt: 50});
        ring.resetView();
        const r = ring as unknown as {yaw: number; tilt: number};
        expect([r.yaw, r.tilt]).toEqual([10, 30]);

        for (const chart of [
            keep(new LineageChart(host())), keep(new RootsChart(host())), keep(new StorylineChart(host())),
            keep(new TimeSeriesChart(host())), keep(new EncounterRose(host()))
        ]) {
            expect(() => chart.resetView()).not.toThrow();
        }
    });
});

describe('pointercancel ends a drag without a click', () => {
    const cases: Array<[string, () => ChartSurface<Record<string, unknown>> & {destroy(): void}]> = [
        ['LineageChart', () => new LineageChart(host()) as never],
        ['RootsChart', () => new RootsChart(host()) as never],
        ['AssociationSky', () => new AssociationSky(host()) as never],
        ['VolumeView', () => new VolumeView(host()) as never]
    ];

    for (const [name, make] of cases) {
        it(name, () => {
            const chart = keep(make());
            const canvas = (chart as unknown as {canvas: HTMLCanvasElement}).canvas;
            const click = vi.fn();
            chart.on('click', click);

            canvas.dispatchEvent(pointer('pointerdown'));
            canvas.dispatchEvent(pointer('pointercancel'));
            expect(click).not.toHaveBeenCalled();
            expect((chart as unknown as {drag: unknown}).drag).toBeNull();

            canvas.dispatchEvent(pointer('pointerdown'));
            canvas.dispatchEvent(pointer('pointerup'));
            expect(click).toHaveBeenCalledTimes(1);
        });
    }

    it('HoloTable and PhaseRing clear the drag', () => {
        for (const chart of [keep(new HoloTable(host())), keep(new PhaseRing(host()))]) {
            const root = chart.element;
            root.dispatchEvent(pointer('pointerdown'));
            expect((chart as unknown as {drag: unknown}).drag).not.toBeNull();
            root.dispatchEvent(pointer('pointercancel'));
            expect((chart as unknown as {drag: unknown}).drag).toBeNull();
        }
    });

    it('TimeSeriesChart and DepthChart clear the press', () => {
        const time = keep(new TimeSeriesChart(host(), {series: [{t: [0, 1000], values: [1, 2]}]}));
        const depth = keep(new DepthChart(host(), {bids: [{price: 9, quantity: 1}], asks: [{price: 11, quantity: 2}]}));

        for (const chart of [time, depth]) {
            const internals = chart as unknown as {press: unknown; canvas: HTMLCanvasElement};
            internals.press = {x: 0, view: {min: 0, max: 1}, mode: 'pan', moved: false};
            internals.canvas.dispatchEvent(pointer('pointercancel'));
            expect(internals.press).toBeNull();
        }
    });

    it('StreamChart: no layerClick on pointercancel', () => {
        const chart = keep(new StreamChart(host()));
        const click = vi.fn();
        chart.on('layerClick', click);
        const internals = chart as unknown as {press: unknown; hitAt: () => unknown};
        internals.hitAt = () => ({layer: 0, panel: 0});
        internals.press = {x: 0, range: {min: 0, max: 1}, moved: false};

        chart.element.dispatchEvent(pointer('pointercancel'));
        expect(click).not.toHaveBeenCalled();
    });
});

describe('destroy removes the canvas listeners', () => {
    it('OutcomeBurst and RootsFans', () => {
        for (const chart of [new OutcomeBurst(host()), new RootsFans(host())]) {
            const canvas = (chart as unknown as {canvas: HTMLCanvasElement}).canvas;
            const removed = vi.spyOn(canvas, 'removeEventListener');
            chart.destroy();
            const types = removed.mock.calls.map((c) => c[0]);
            expect(types).toEqual(expect.arrayContaining(['pointermove', 'pointerleave', 'click']));
        }
    });
});
