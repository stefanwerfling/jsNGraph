// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NGraph } from '../src/NGraph';
import { Camera } from '../src/view/Camera';
import { RectBoard } from '../src/rect/RectBoard';
import { RectBoardGeometry, DEFAULT_CURVE, RECT_SIDES } from '../src/rect/RectBoardGeometry';
import { RectElbow, RectLoop } from '../src/rect/RectConnectors';
import { ModelView } from '../src/modelview/ModelView';
import { RecordGraph } from '../src/records/RecordGraph';
import { RecordGraphData } from '../src/records/RecordTypes';
import { NetView } from '../src/netview/NetView';
import { NetTrace } from '../src/netview/NetTypes';
import { GraphNode } from '../src/model/GraphNode';
import { StyleResolver } from '../src/render/StyleResolver';
import { Theme } from '../src/render/Theme';
import { BulkBuffers, LINE_STRIDE } from '../src/render/BulkBuffers';
import { FakeCanvas } from './support/FakeCanvas';

beforeAll(() => {
    FakeCanvas.install();
    HTMLElement.prototype.hasPointerCapture ??= () => false;
});

const cleanup: Array<{destroy(): void}> = [];

const host = (): HTMLDivElement => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', {value: 400});
    Object.defineProperty(el, 'clientHeight', {value: 300});
    document.body.appendChild(el);
    return el;
};

afterEach(() => {
    cleanup.splice(0).forEach((c) => c.destroy());
    vi.restoreAllMocks();
});

describe('Camera', () => {
    it('exposes scale/offset read-only', () => {
        const cam = new Camera();
        cam.setState({scale: 2, offsetX: 10, offsetY: 20});
        expect([cam.scale, cam.offsetX, cam.offsetY]).toEqual([2, 10, 20]);
        expect(() => {
            (cam as unknown as {scale: number}).scale = 5;
        }).toThrow(TypeError);
        expect(cam.scale).toBe(2);
    });

    it('ignores non-finite values and keeps the previous pose', () => {
        const cam = new Camera();
        cam.setState({scale: 2, offsetX: 10, offsetY: 20});
        cam.setState({scale: NaN, offsetX: Infinity, offsetY: 30});
        expect(cam.getState()).toEqual({scale: 2, offsetX: 10, offsetY: 30});

        cam.zoomAt(100, 100, Infinity);
        expect(cam.getState()).toEqual({scale: 2, offsetX: 10, offsetY: 30});
        cam.zoomAt(NaN, 0, 2);
        cam.panBy(NaN, 5);
        expect(cam.getState()).toEqual({scale: 2, offsetX: 10, offsetY: 35});

        cam.flyTo({scale: NaN, offsetX: NaN, offsetY: 0}, 0);
        expect(cam.getState()).toEqual({scale: 2, offsetX: 10, offsetY: 0});
    });
});

describe('on/off chain and return this', () => {
    it('NGraph', () => {
        const graph = new NGraph(host());
        cleanup.push(graph);
        const fn = vi.fn();
        expect(graph.on('nodeClick', fn)).toBe(graph);
        expect(graph.off('nodeClick', fn)).toBe(graph);
    });

    it('ModelView, and destroy drops its listeners', () => {
        const view = new ModelView(host());
        const fn = vi.fn();
        expect(view.on('moduleClick', fn)).toBe(view);
        expect(view.off('moduleClick', fn)).toBe(view);
        view.on('moduleHover', fn);
        view.destroy();
        const events = (view as unknown as {events: {has(e: string): boolean}}).events;
        expect(events.has('moduleHover')).toBe(false);
    });

    it('RecordGraph and NetView', () => {
        const records = new RecordGraph(host());
        cleanup.push(records);
        const net = new NetView(host());
        cleanup.push(net);
        const fn = vi.fn();
        expect(records.on('rowClick', fn).off('rowClick', fn)).toBe(records);
        expect(net.on('hover', fn).off('hover', fn)).toBe(net);
    });

    it('RectBoard has off; destroy clears handlers', () => {
        const board = new RectBoard(host(), {editable: true});
        const a = document.createElement('div');
        const b = document.createElement('div');
        board.add(a, 0, 0, 'a').add(b, 100, 0, 'b');
        const fn = vi.fn();
        expect(board.on('select', fn)).toBe(board);
        board.select(['a'], true);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(board.off('select', fn)).toBe(board);
        board.select(['b'], true);
        expect(fn).toHaveBeenCalledTimes(1);

        const other = vi.fn();
        board.on('select', other);
        board.destroy();
        board.select(['a'], true);
        expect(other).not.toHaveBeenCalled();
    });
});

describe('NGraph state getters and copies', () => {
    it('clustered / paused are getters; isClustered stays as a delegate', () => {
        const graph = new NGraph(host());
        cleanup.push(graph);
        expect(graph.clustered).toBe(false);
        expect(graph.isClustered()).toBe(false);
        graph.setClusters([{id: 'c', nodeIds: []}]);
        graph.setViewport({scale: 0.2, offsetX: 0, offsetY: 0});
        expect(graph.clustered).toBe(graph.isClustered());

        expect(graph.paused).toBe(false);
        graph.pause();
        expect(graph.paused).toBe(true);
        graph.resume();
        expect(graph.paused).toBe(false);
    });

    it('stores copies of hulls and clusters', () => {
        const graph = new NGraph(host());
        cleanup.push(graph);
        const hull = {id: 'h', nodeIds: ['a'], label: 'before'};
        graph.setHulls([hull]);
        hull.label = 'after';
        expect((graph as unknown as {hulls: Array<{label: string}>}).hulls[0]!.label).toBe('before');
    });

    it('GraphNode copies meta and badges', () => {
        const meta = {owner: 'x'};
        const badges = [{text: '1'}];
        const node = new GraphNode({id: 'n', label: 'N', meta, badges}, 0, 0);
        meta.owner = 'y';
        badges[0]!.text = '2';
        expect(node.meta).toEqual({owner: 'x'});
        expect(node.badges?.[0]?.text).toBe('1');

        const patch = {owner: 'z'};
        node.updateFrom({meta: patch});
        patch.owner = 'w';
        expect(node.meta).toEqual({owner: 'z'});
    });

    it('StyleResolver copies the edge-kind table', () => {
        const kinds = {k: {width: 1}};
        const styles = new StyleResolver(Theme.dark, kinds);
        kinds.k.width = 9;
        const internal = (styles as unknown as {edgeKinds: Record<string, {width: number}>}).edgeKinds;
        expect(internal.k!.width).toBe(1);
    });
});

describe('RecordGraph copies', () => {
    const data: RecordGraphData = {
        nodes: [
            {id: 'a', title: 'A', icon: (ctx) => ctx.beginPath(), rows: [{id: 'r', label: 'r', value: 1}]},
            {id: 'b', title: 'B', rows: [{id: 'r', label: 'r', value: 1}]}
        ],
        links: [{from: {node: 'a', row: 'r'}, to: {node: 'b', row: 'r'}}]
    };

    it('getLayout returns a copy', () => {
        const graph = new RecordGraph(host(), {data});
        cleanup.push(graph);
        const first = graph.getLayout()!;
        first.records.get('a')!.x = 9999;
        first.links.length = 0;
        const second = graph.getLayout()!;
        expect(second.records.get('a')!.x).not.toBe(9999);
        expect(second.links.length).toBe(1);
    });

    it('getData keeps icon drawer functions', () => {
        const graph = new RecordGraph(host(), {data});
        cleanup.push(graph);
        const copy = graph.getData();
        expect(copy.nodes[0]!.icon).toBe(data.nodes[0]!.icon);
        expect(copy.nodes[0]).not.toBe(data.nodes[0]);
    });
});

describe('NetView trace copies', () => {
    it('copies the trace in and out', () => {
        const view = new NetView(host(), {animate: false});
        cleanup.push(view);
        view.setModel({hidden: 8, blocks: 2, heads: 2});
        const trace: NetTrace = {prompt: 'p', blocks: [{block: 0, values: [1, 2, 3, 4, 5, 6, 7, 8]}]};
        view.setTrace(trace);
        trace.prompt = 'changed';
        trace.blocks.push({block: 1});
        const out = view.getTrace()!;
        expect(out.prompt).toBe('p');
        expect(out.blocks.length).toBe(1);
        out.prompt = 'mutated';
        expect(view.getTrace()!.prompt).toBe('p');
    });
});

describe('statics replacing module helpers', () => {
    it('keeps the deprecated aliases equal to the statics', () => {
        expect(DEFAULT_CURVE).toBe(RectBoardGeometry.DEFAULT_CURVE);
        expect(RECT_SIDES).toBe(RectBoardGeometry.SIDES);
        expect(LINE_STRIDE).toBe(BulkBuffers.LINE_STRIDE);
    });

    it('rect connectors still draw through RectSvg', () => {
        const elbow = new RectElbow({from: 'left', to: 'bottom'}).render();
        expect(elbow.querySelector('path')).not.toBeNull();
        expect(elbow.querySelector('polygon')).not.toBeNull();
        const loop = new RectLoop({dots: true, label: 'again'}).render();
        expect(loop.querySelectorAll('circle').length).toBe(3);
        expect(loop.querySelector('text')?.textContent).toBe('again');
    });
});
