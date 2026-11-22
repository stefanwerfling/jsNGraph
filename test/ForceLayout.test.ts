import { describe, expect, it, vi } from 'vitest';
import { GraphEdge } from '../src/model/GraphEdge';
import { GraphNode } from '../src/model/GraphNode';
import { ForceLayout } from '../src/layout/ForceLayout';

function makeNode(id: string, x: number, y: number, fixed = false): GraphNode {
    return new GraphNode({id: id, label: id, kind: 'generic', x: x, y: y, fixed: fixed}, x, y);
}

describe('ForceLayout', () => {
    it('never lets node positions diverge to non-finite values', () => {
        // Two nodes starting on top of each other is the case that used to
        // blow up the 1/d² repulsion term before the distance floor + speed clamp.
        const a = makeNode('a', 400, 300);
        const b = makeNode('b', 400.001, 300.001);
        const layout = new ForceLayout();

        for (let i = 0; i < 200; i++) {
            layout.tick([a, b], [], 800, 600);
        }

        expect(Number.isFinite(a.x)).toBe(true);
        expect(Number.isFinite(a.y)).toBe(true);
        expect(Number.isFinite(b.x)).toBe(true);
        expect(Number.isFinite(b.y)).toBe(true);
    });

    it('keeps a single tick from moving any node further than the speed cap', () => {
        const a = makeNode('a', 400, 300);
        const b = makeNode('b', 400.001, 300.001);
        const layout = new ForceLayout();

        layout.tick([a, b], [], 800, 600);

        expect(Math.abs(a.x - 400)).toBeLessThanOrEqual(40);
        expect(Math.abs(a.y - 300)).toBeLessThanOrEqual(40);
    });

    it('pushes coincident nodes apart in opposite directions, without chance', () => {
        // With random fallbacks drawn per node, both could go the same way
        // and the collision pass then moved them past the speed cap (the
        // test above failed about 1 run in 20). Pinning Math.random to one
        // value forces that case; the layout must not depend on it.
        const random = vi.spyOn(Math, 'random').mockReturnValue(0.9);
        try {
            const a = makeNode('a', 400, 300);
            const b = makeNode('b', 400, 300);
            new ForceLayout().tick([a, b], [], 800, 600);
            for (const n of [a, b]) {
                expect(Math.abs(n.x - 400)).toBeLessThanOrEqual(40);
                expect(Math.abs(n.y - 300)).toBeLessThanOrEqual(40);
            }
            // Opposite: the midpoint stays where they started.
            expect((a.x + b.x) / 2).toBeCloseTo(400, 6);
            expect((a.y + b.y) / 2).toBeCloseTo(300, 6);

            // A pile fans out: every node on its own spot.
            const pile = ['c', 'd', 'e', 'f'].map((id) => makeNode(id, 400, 300));
            new ForceLayout().tick(pile, [], 800, 600);
            expect(new Set(pile.map((n) => `${n.x.toFixed(3)},${n.y.toFixed(3)}`)).size).toBe(4);
        } finally {
            random.mockRestore();
        }
    });

    it('resolves overlap so two connected nodes end up at least radius apart', () => {
        const a = makeNode('a', 400, 300);
        const b = makeNode('b', 405, 300);
        const edge = new GraphEdge({id: 'e', source: 'a', target: 'b'}, a, b);
        const layout = new ForceLayout();

        for (let i = 0; i < 100; i++) {
            layout.tick([a, b], [edge], 800, 600);
        }

        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        expect(dist).toBeGreaterThanOrEqual(a.radius + b.radius);
    });

    it('never moves a fixed node', () => {
        const anchor = makeNode('anchor', 400, 300, true);
        const other = makeNode('other', 410, 300);
        const layout = new ForceLayout();

        for (let i = 0; i < 50; i++) {
            layout.tick([anchor, other], [], 800, 600);
        }

        expect(anchor.x).toBe(400);
        expect(anchor.y).toBe(300);
    });

    it('pulls a spring-connected pair toward the resting spring length', () => {
        const a = makeNode('a', 300, 300);
        const b = makeNode('b', 700, 300);
        const edge = new GraphEdge({id: 'e', source: 'a', target: 'b'}, a, b);
        const layout = new ForceLayout({repulsion: 0, centerStrength: 0, springLength: 140});

        for (let i = 0; i < 300; i++) {
            layout.tick([a, b], [edge], 1000, 600);
        }

        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        expect(dist).toBeGreaterThan(100);
        expect(dist).toBeLessThan(180);
    });

    it('cools down and stops moving, and reheat wakes it again', () => {
        const nodes = Array.from({length: 60}, (_, i) => makeNode('n' + i, 400 + (i % 8) * 3, 300 + Math.floor(i / 8) * 3));
        const edges = nodes.slice(1).map((n, i) => new GraphEdge({id: 'e' + i, source: nodes[i]!.id, target: n.id}, nodes[i]!, n));
        const layout = new ForceLayout();

        for (let i = 0; i < 400; i++) {
            layout.tick(nodes, edges, 800, 600);
        }

        const before = nodes.map((n) => [n.x, n.y]);
        layout.tick(nodes, edges, 800, 600);
        expect(nodes.every((n, i) => n.x === before[i]![0] && n.y === before[i]![1])).toBe(true);

        layout.reheat(1);
        nodes[0]!.x += 200;
        layout.tick(nodes, edges, 800, 600);
        expect(nodes.some((n, i) => i > 0 && (n.x !== before[i]![0] || n.y !== before[i]![1]))).toBe(true);
    });
});
