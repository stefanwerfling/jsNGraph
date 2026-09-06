import { describe, expect, it } from 'vitest';
import { GraphNode } from '../src/model/GraphNode';
import { RadialLayout } from '../src/layout/RadialLayout';

function makeNode(id: string, ring: number, fixed = false): GraphNode {
    return new GraphNode({id: id, label: id, kind: 'agent', ring: ring, fixed: fixed}, 10, 10);
}

function settle(layout: RadialLayout, nodes: GraphNode[], width = 600, height = 600, ticks = 300): void {
    for (let i = 0; i < ticks; i++) {
        layout.tick(nodes, [], width, height);
    }
}

describe('RadialLayout', () => {
    it('places a single ring-0 hub at the canvas center', () => {
        const hub = makeNode('hub', 0);
        const layout = new RadialLayout();

        settle(layout, [hub]);

        expect(hub.x).toBeCloseTo(300, 0);
        expect(hub.y).toBeCloseTo(300, 0);
    });

    it('places ring members equidistant on a square canvas, inner ring closer than outer', () => {
        const hub = makeNode('hub', 0);
        const inner = ['a', 'b', 'c', 'd'].map((id) => makeNode(id, 1));
        const outer = ['x', 'y'].map((id) => makeNode(id, 2));
        const layout = new RadialLayout();

        settle(layout, [hub, ...inner, ...outer]);

        const dist = (n: GraphNode): number => Math.hypot(n.x - 300, n.y - 300);
        const innerRadii = inner.map(dist);
        const outerRadii = outer.map(dist);
        const innerAvg = innerRadii.reduce((s, r) => s + r, 0) / innerRadii.length;

        for (const r of innerRadii) {
            expect(Math.abs(r - innerAvg)).toBeLessThan(1);
        }

        for (const r of outerRadii) {
            expect(r).toBeGreaterThan(innerAvg + 40);
        }
    });

    it('spreads rings elliptically on a wide canvas — wider than tall', () => {
        const hub = makeNode('hub', 0);
        const members = Array.from({length: 8}, (_, i) => makeNode(`m${i}`, 1));
        const layout = new RadialLayout();

        settle(layout, [hub, ...members], 1200, 400);

        const spreadX = Math.max(...members.map((n) => Math.abs(n.x - 600)));
        const spreadY = Math.max(...members.map((n) => Math.abs(n.y - 200)));

        expect(spreadX).toBeGreaterThan(spreadY * 1.5);
    });

    it('widens a crowded ring until every member has room', () => {
        const many = Array.from({length: 16}, (_, i) => makeNode(`n${i}`, 1));
        const layout = new RadialLayout();

        // Small canvas: the naive ring radius would be far too tight for 16 nodes.
        settle(layout, [makeNode('hub', 0), ...many], 900, 300);

        let minPairDist = Number.POSITIVE_INFINITY;

        for (let i = 0; i < many.length; i++) {
            for (let j = i + 1; j < many.length; j++) {
                const a = many[i];
                const b = many[j];

                if (a === undefined || b === undefined) {
                    continue;
                }

                minPairDist = Math.min(minPairDist, Math.hypot(a.x - b.x, a.y - b.y));
            }
        }

        expect(minPairDist).toBeGreaterThan(30);
    });

    it('is deterministic — same input order, same slots every run', () => {
        const run = (): Array<{x: number; y: number}> => {
            const nodes = [makeNode('hub', 0), makeNode('a', 1), makeNode('b', 1), makeNode('c', 1)];
            const layout = new RadialLayout();

            settle(layout, nodes);

            return nodes.map((n) => ({x: n.x, y: n.y}));
        };

        const first = run();
        const second = run();

        for (let i = 0; i < first.length; i++) {
            expect(first[i]?.x).toBeCloseTo(second[i]?.x ?? NaN, 5);
            expect(first[i]?.y).toBeCloseTo(second[i]?.y ?? NaN, 5);
        }
    });

    it('never moves fixed (dragged/pinned) nodes', () => {
        const pinned = makeNode('pinned', 1, true);

        pinned.x = 123;
        pinned.y = 456;

        const layout = new RadialLayout();

        settle(layout, [pinned, makeNode('free', 1)]);

        expect(pinned.x).toBe(123);
        expect(pinned.y).toBe(456);
    });

    it('keeps positions finite for degenerate input (all nodes ring 0)', () => {
        const nodes = ['a', 'b', 'c'].map((id) => makeNode(id, 0));
        const layout = new RadialLayout();

        settle(layout, nodes);

        for (const node of nodes) {
            expect(Number.isFinite(node.x)).toBe(true);
            expect(Number.isFinite(node.y)).toBe(true);
        }
    });
});
