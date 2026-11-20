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

    it('back-and-forth sweeps reduce crossings a single forward pass leaves', () => {
        // A 4-column DAG whose crossing-minimal arrangement needs structure
        // from the right columns propagated leftward: one forward pass (the
        // first column never gets reordered) settles at 6 crossings, the
        // alternating sweeps bring it down to 3.
        const ring: Record<string, number> = {};
        for (let i = 0; i < 4; i++) ring['n' + i] = 0;
        for (let i = 4; i < 8; i++) ring['n' + i] = 1;
        for (let i = 8; i < 12; i++) ring['n' + i] = 2;
        for (let i = 12; i < 15; i++) ring['n' + i] = 3;

        const wiring: [string, string][] = [
            ['n0', 'n5'], ['n1', 'n7'], ['n1', 'n6'], ['n2', 'n5'], ['n3', 'n4'],
            ['n3', 'n7'], ['n4', 'n9'], ['n5', 'n10'], ['n5', 'n8'], ['n6', 'n9'],
            ['n6', 'n11'], ['n7', 'n11'], ['n8', 'n12'], ['n9', 'n12'], ['n10', 'n13'],
            ['n10', 'n14'], ['n11', 'n12'], ['n11', 'n13']
        ];

        const crossingsAfter = (sweeps: number): number => {
            const byId = new Map<string, GraphNode>();

            for (const id of Object.keys(ring)) {
                byId.set(id, makeNode(id, ring[id] ?? 0));
            }

            const edges = wiring.map(([s, t], i) =>
                makeEdge('e' + i, byId.get(s ?? '') as GraphNode, byId.get(t ?? '') as GraphNode));

            settle(new LayeredLayout({sweeps: sweeps}), [...byId.values()], edges);

            let count = 0;

            for (let i = 0; i < edges.length; i++) {
                for (let j = i + 1; j < edges.length; j++) {
                    const a = edges[i] as GraphEdge;
                    const b = edges[j] as GraphEdge;
                    const aSpan = [Math.min(a.source.ring, a.target.ring), Math.max(a.source.ring, a.target.ring)];
                    const bSpan = [Math.min(b.source.ring, b.target.ring), Math.max(b.source.ring, b.target.ring)];

                    if (aSpan[0] !== bSpan[0] || aSpan[1] !== bSpan[1]) {
                        continue;
                    }

                    const aLeft = a.source.ring < a.target.ring ? a.source : a.target;
                    const aRight = a.source.ring < a.target.ring ? a.target : a.source;
                    const bLeft = b.source.ring < b.target.ring ? b.source : b.target;
                    const bRight = b.source.ring < b.target.ring ? b.target : b.source;

                    if ((aLeft.y - bLeft.y) * (aRight.y - bRight.y) < 0) {
                        count++;
                    }
                }
            }

            return count;
        };

        const single = crossingsAfter(1);
        const standard = crossingsAfter(4);

        expect(single).toBe(6);
        expect(standard).toBe(3);
        expect(standard).toBeLessThan(single);
        // Converged: extra sweeps never make it worse.
        expect(crossingsAfter(12)).toBe(standard);
    });

    it('minSpacing and minColumnGap let a big graph grow past the canvas instead of overlapping', () => {
        const column = Array.from({length: 20}, (_, i) => makeNode(`n${i}`, 0));
        const far = Array.from({length: 6}, (_, i) => makeNode(`c${i}`, i + 1));
        const plain = new LayeredLayout();
        const spaced = new LayeredLayout({minSpacing: 56, minColumnGap: 260});
        const copy = (nodes: GraphNode[]): GraphNode[] => nodes.map((n) => makeNode(n.id, n.ring));
        const a = [...copy(column), ...copy(far)];
        const b = [...copy(column), ...copy(far)];

        settle(plain, a, [], 800, 400);
        settle(spaced, b, [], 800, 400);

        const gapY = (nodes: GraphNode[]): number => {
            const ys = nodes.filter((n) => n.ring === 0).map((n) => n.y).sort((p, q) => p - q);
            return (ys[1] ?? 0) - (ys[0] ?? 0);
        };
        const gapX = (nodes: GraphNode[]): number => (nodes.find((n) => n.id === 'c1')?.x ?? 0) - (nodes.find((n) => n.id === 'c0')?.x ?? 0);

        expect(gapY(a)).toBeLessThan(20);
        expect(gapY(b)).toBeCloseTo(56, 0);
        expect(gapX(a)).toBeLessThan(110);
        expect(gapX(b)).toBeCloseTo(260, 0);
        // Still centred on the canvas.
        const xs = b.map((n) => n.x);
        expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(400, 0);
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
