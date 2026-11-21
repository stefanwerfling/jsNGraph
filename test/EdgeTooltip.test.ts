import { describe, expect, it } from 'vitest';
import { NGraph } from '../src/NGraph';
import { GraphNode } from '../src/model/GraphNode';
import { GraphEdge } from '../src/model/GraphEdge';

describe('NGraph.defaultEdgeTooltip', () => {
    const a = new GraphNode({id: 'a', label: 'Router'}, 0, 0);
    const b = new GraphNode({id: 'b', label: 'Server'}, 10, 0);

    it('shows both ends and the load', () => {
        expect(NGraph.defaultEdgeTooltip(new GraphEdge({id: 'e', source: 'a', target: 'b', load: 0.634}, a, b)))
            .toBe('Router ↔ Server · 63% load');
    });

    it('uses an arrow for directed edges and the label instead of the load', () => {
        const e = new GraphEdge({id: 'e', source: 'a', target: 'b', load: 0.2, label: '10 Gbit/s'}, a, b);
        expect(NGraph.defaultEdgeTooltip(e, true)).toBe('Router → Server · 10 Gbit/s');
        expect(NGraph.defaultEdgeTooltip(new GraphEdge({id: 'd', source: 'a', target: 'b', directed: true}, a, b)))
            .toBe('Router → Server · 0% load');
    });
});
