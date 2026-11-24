// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { RecordGraph } from '../src/records/RecordGraph';
import { RecordGraphData, RecordPort } from '../src/records/RecordTypes';
import { FakeCanvas } from './support/FakeCanvas';

beforeAll(() => {
    FakeCanvas.install();
    // happy-dom has no pointer capture.
    HTMLElement.prototype.hasPointerCapture ??= () => false;
});

const data: RecordGraphData = {
    nodes: [
        {id: 'a', title: 'A', rows: [{id: 'r', label: 'r', value: 1}]},
        {id: 'b', title: 'B', rows: [{id: 'r', label: 'r', value: 1}]}
    ],
    links: [{from: {node: 'a', row: 'r'}, to: {node: 'b', row: 'r'}}]
};

interface Internals {
    lineage: unknown;
    press: unknown;
    hit(x: number, y: number): unknown;
    onUp(e: {type: string; pointerId: number; clientX: number; clientY: number}): void;
}

/** A click that lands on `port` (hit-testing stubbed: this is about what the click does). */
const clickRow = (graph: RecordGraph, port: RecordPort): void => {
    const g = graph as unknown as Internals;
    g.hit = () => ({kind: 'row', port: port, plus: false});
    g.press = {x: 0, y: 0, moved: false};
    g.onUp({type: 'pointerup', pointerId: 1, clientX: 0, clientY: 0});
};

describe('RecordGraph row highlight', () => {
    it('a click on the previously highlighted row lights it again after setData', () => {
        const graph = new RecordGraph(document.body.appendChild(document.createElement('div')), {data: data});
        const g = graph as unknown as Internals;
        const port = {node: 'a', row: 'r'};

        clickRow(graph, port);
        expect(g.lineage).not.toBeNull();

        graph.setData(data);
        expect(g.lineage).toBeNull();

        clickRow(graph, port);
        expect(g.lineage).not.toBeNull();

        clickRow(graph, port);           // and a second click still toggles it off
        expect(g.lineage).toBeNull();
        graph.destroy();
    });
});
