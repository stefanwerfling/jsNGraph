// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NGraph } from '../src/NGraph';
import { ForceLayout } from '../src/layout/ForceLayout';
import { FakeCanvas } from './support/FakeCanvas';

beforeAll(() => FakeCanvas.install());

const graphs: NGraph[] = [];

const make = (options: ConstructorParameters<typeof NGraph>[1] = {}): {graph: NGraph; canvas: HTMLCanvasElement} => {
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', {value: 400});
    Object.defineProperty(host, 'clientHeight', {value: 300});
    document.body.appendChild(host);
    const graph = new NGraph(host, options);
    graphs.push(graph);
    return {graph: graph, canvas: host.querySelector('canvas') as HTMLCanvasElement};
};

afterEach(() => {
    graphs.splice(0).forEach((g) => g.destroy());
    vi.restoreAllMocks();
});

describe('NGraph camera moves', () => {
    it('does not reheat the layout when the view is zoomed', () => {
        const {graph, canvas} = make({panZoom: true});
        graph.setData([{id: 'a', label: 'A', kind: 'server'}, {id: 'b', label: 'B', kind: 'server'}],
            [{id: 'e', source: 'a', target: 'b'}]);
        const reheat = vi.spyOn(ForceLayout.prototype, 'reheat');
        const viewport = vi.fn();
        graph.on('viewportChange', viewport);

        canvas.dispatchEvent(new WheelEvent('wheel', {deltaY: -100, clientX: 200, clientY: 150, cancelable: true}));

        expect(viewport).toHaveBeenCalledTimes(1);
        expect(reheat).not.toHaveBeenCalled();
    });
});

describe('NGraph re-adding a node id', () => {
    it('moves the edges to the new node and keeps its position', () => {
        const {graph} = make();
        graph.setData([{id: 'a', label: 'A', x: 10, y: 20, fixed: true}, {id: 'b', label: 'B', x: 100, y: 20, fixed: true}],
            [{id: 'e', source: 'a', target: 'b'}]);

        graph.addNode({id: 'a', label: 'A2', status: 'down'});

        const edges = (graph as unknown as {edges: Map<string, {source: {label: string; x: number; y: number}}>}).edges;
        const source = edges.get('e')!.source;
        expect(source.label).toBe('A2');
        expect(source.x).toBe(10);
        expect(source.y).toBe(20);
    });
});

describe('NGraph pause', () => {
    const setHidden = (hidden: boolean): void => {
        Object.defineProperty(document, 'hidden', {value: hidden, configurable: true});
        document.dispatchEvent(new Event('visibilitychange'));
    };

    afterEach(() => setHidden(false));

    it('stays paused when the tab comes back', () => {
        const {graph} = make();
        const loop = (graph as unknown as {loop: {isPaused: boolean}}).loop;

        graph.pause();
        setHidden(true);
        setHidden(false);
        expect(loop.isPaused).toBe(true);

        graph.resume();
        expect(loop.isPaused).toBe(false);
    });

    it('does not start drawing again after destroy', () => {
        const {graph} = make();
        const loop = (graph as unknown as {loop: {isPaused: boolean; isRunning: boolean}}).loop;

        graph.destroy();
        graph.resume();
        expect(loop.isPaused).toBe(true);
        expect(loop.isRunning).toBe(false);
    });
});

describe('NGraph in a CSS-scaled container', () => {
    it('reports the context-menu world point in layout px', () => {
        const {graph, canvas} = make();
        Object.defineProperty(canvas, 'clientWidth', {value: 400});
        Object.defineProperty(canvas, 'clientHeight', {value: 300});
        canvas.getBoundingClientRect = () => ({left: 0, top: 0, width: 800, height: 600}) as DOMRect;
        const menu = vi.fn();
        graph.on('contextMenu', menu);

        canvas.dispatchEvent(new MouseEvent('contextmenu', {clientX: 400, clientY: 300, cancelable: true}));

        expect(menu.mock.calls[0]![0].world).toEqual({x: 200, y: 150});
    });
});

describe('NGraph stale hover / selection / panel', () => {
    interface Internals {
        nodes: Map<string, unknown>;
        edges: Map<string, unknown>;
        hoveredEdgeId: string | null;
        selectedId: string | null;
        handleClick(node: unknown, edge: unknown, x: number, y: number, mods: {additive: boolean}): void;
        handleEdgeHover(edge: unknown, at: {x: number; y: number}): void;
    }

    const nodes = [{id: 'a', label: 'A', x: 50, y: 50, fixed: true}, {id: 'b', label: 'B', x: 200, y: 50, fixed: true}];
    const panelOf = (host: HTMLElement): HTMLElement =>
        [...host.querySelectorAll('div')].find((d) => d.querySelector('[data-close]') !== null) as HTMLElement;

    const openPanel = (graph: NGraph, id: string): Internals => {
        const g = graph as unknown as Internals;
        g.handleClick(g.nodes.get(id), null, 50, 50, {additive: false});
        return g;
    };

    it('closes the panel when setData drops the selected node, and follows a replaced one', () => {
        const {graph, canvas} = make();
        const host = canvas.parentElement!;
        graph.setData(nodes, []);
        const g = openPanel(graph, 'a');
        expect(panelOf(host).style.display).toBe('block');

        graph.setData([{...nodes[0]!, status: 'down'}, nodes[1]!], []);
        expect(panelOf(host).style.display).toBe('block');
        expect(panelOf(host).textContent).toContain('down');

        graph.setData([nodes[1]!], []);
        expect(panelOf(host).style.display).toBe('none');
        expect(g.selectedId).toBeNull();
    });

    it('updates an open panel on updateNode and escapes the status', () => {
        const {graph, canvas} = make();
        graph.setData(nodes, []);
        openPanel(graph, 'a');

        graph.updateNode('a', {status: '<b>x</b>' as never});

        const panel = panelOf(canvas.parentElement!);
        expect(panel.querySelector('b')).toBeNull();
        expect(panel.textContent).toContain('<b>x</b>');
    });

    it('forgets the hovered edge when it is removed', () => {
        const {graph, canvas} = make();
        graph.setData(nodes, [{id: 'e', source: 'a', target: 'b', label: 'link'}]);
        const g = graph as unknown as Internals;
        g.handleEdgeHover(g.edges.get('e'), {x: 120, y: 50});
        expect(g.hoveredEdgeId).toBe('e');
        const tooltip = [...canvas.parentElement!.children].find((el) => el.textContent?.includes('link')) as HTMLElement;
        expect(tooltip.style.display).not.toBe('none');

        graph.removeEdge('e');

        expect(g.hoveredEdgeId).toBeNull();
        expect(tooltip.style.display).toBe('none');
    });
});
