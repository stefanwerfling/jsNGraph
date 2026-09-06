import { describe, expect, it } from 'vitest';
import { GraphEdge } from '../src/model/GraphEdge';
import { GraphNode } from '../src/model/GraphNode';
import { LayeredLayout } from '../src/layout/LayeredLayout';

function makeNode(id: string, ring: number): GraphNode {
    return new GraphNode({id: id, label: id, kind: 'agent', ring: ring}, 10, 10);
}

function makeEdge(id: string, source: GraphNode, target: GraphNode): GraphEdge {
    return new GraphEdge({id: id, source: source.id, target: target.id}, source, target);
}

function settle(layout: LayeredLayout, nodes: GraphNode[], edges: GraphEdge[] = [],
    width = 1200, height = 500, ticks = 300): void {
    for (let i = 0; i < ticks; i++) {
        layout.tick(nodes, edges, width, height);
    }
}

describe('LayeredLayout', () => {
    it('spreads columns left-to-right by ring and stacks members vertically', () => {
        const hub = makeNode('hub', 0);
        const mid = ['a', 'b', 'c'].map((id) => makeNode(id, 1));
        const right = makeNode('infra', 2);
        const layout = new LayeredLayout();

        settle(layout, [hub, ...mid, right]);

        expect(hub.x).toBeLessThan(mid[0]?.x ?? 0);
        expect(mid[0]?.x ?? 0).toBeLessThan(right.x);
        expect(Math.abs((mid[0]?.x ?? 0) - (mid[2]?.x ?? 1))).toBeLessThan(1);

        const ys = mid.map((n) => n.y).sort((a, b) => a - b);
        expect((ys[1] ?? 0) - (ys[0] ?? 0)).toBeGreaterThan(30);
        expect((ys[2] ?? 0) - (ys[1] ?? 0)).toBeGreaterThan(30);
    });

    it('reduces crossings: barycenter aligns a column with its neighbors', () => {
        // hub0 connects to y, hub1 connects to x — input order (x, y) would
        // cross; barycenter ordering must flip them to (y, x).
        const hub0 = makeNode('hub0', 0);
        const hub1 = makeNode('hub1', 0);
        const x = makeNode('x', 1);
        const y = makeNode('y', 1);
        const edges = [makeEdge('e1', hub0, y), makeEdge('e2', hub1, x)];
        const layout = new LayeredLayout();

        settle(layout, [hub0, hub1, x, y], edges);

        expect(y.y).toBeLessThan(x.y);
        expect(hub0.y).toBeLessThan(hub1.y);
    });

    it('is deterministic across runs', () => {
        const run = (): number[] => {
            const nodes = [makeNode('h', 0), makeNode('a', 1), makeNode('b', 1), makeNode('i', 2)];
            const layout = new LayeredLayout();

            settle(layout, nodes);

            return nodes.flatMap((n) => [n.x, n.y]);
        };

        const first = run();
        const second = run();

        for (let i = 0; i < first.length; i++) {
            expect(first[i]).toBeCloseTo(second[i] ?? NaN, 5);
        }
    });

    it('never moves fixed nodes', () => {
        const pinned = makeNode('p', 1);

        pinned.fixed = true;
        pinned.x = 77;
        pinned.y = 88;

        settle(new LayeredLayout(), [pinned, makeNode('q', 1)]);

        expect(pinned.x).toBe(77);
        expect(pinned.y).toBe(88);
    });
});
