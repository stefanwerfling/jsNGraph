import { describe, expect, it } from 'vitest';
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
});
