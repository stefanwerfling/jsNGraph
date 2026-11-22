import { describe, expect, it } from 'vitest';
import { GraphEdge } from '../src/model/GraphEdge';
import { GraphNode } from '../src/model/GraphNode';
import { GraphQuery } from '../src/model/GraphQuery';
import { LayeredLayout } from '../src/layout/LayeredLayout';
import { CanvasRenderer } from '../src/render/CanvasRenderer';
import { ColumnHeaders } from '../src/render/ColumnHeaders';
import { StyleResolver } from '../src/render/StyleResolver';
import { Theme } from '../src/render/Theme';

function node(id: string, ring = 0, extra: Record<string, unknown> = {}): GraphNode {
    return new GraphNode({id, label: id, ring, ...extra}, 10, 10);
}

function edge(source: GraphNode, target: GraphNode): GraphEdge {
    return new GraphEdge({id: `${source.id}-${target.id}`, source: source.id, target: target.id}, source, target);
}

function settle(layout: LayeredLayout, nodes: GraphNode[], edges: GraphEdge[] = []): void {
    for (let i = 0; i < 300; i++) {
        layout.tick(nodes, edges, 1200, 600);
    }
}

describe('LayeredLayout grid layers', () => {
    it('packs a layer into rows × sub-columns', () => {
        const bits = Array.from({length: 12}, (_, i) => node(`b${i}`, 1));
        const root = node('root', 0);
        const layout = new LayeredLayout({grid: {1: 3}, gridGap: 20});

        settle(layout, [root, ...bits]);

        const xs = [...new Set(bits.map((b) => Math.round(b.x)))].sort((a, b) => a - b);
        const ys = [...new Set(bits.map((b) => Math.round(b.y)))];

        expect(xs).toHaveLength(3);
        expect(xs[1]! - xs[0]!).toBe(20);
        expect(ys).toHaveLength(4);
        const column = layout.columns.find((c) => c.ring === 1)!;
        expect(column.count).toBe(12);
        expect(column.halfWidth).toBe(20);
        expect(Math.abs(column.pos - xs[1]!)).toBeLessThan(1);
    });

    it('reports every layer in ring order', () => {
        const layout = new LayeredLayout();
        settle(layout, [node('a', 2), node('b', 0), node('c', 0)]);
        expect(layout.columns.map((c) => [c.ring, c.count])).toEqual([[0, 2], [2, 1]]);
    });
});

describe('GraphQuery.lineage', () => {
    it('follows a node up- and downstream without spilling into sibling branches', () => {
        const r = node('r');
        const a = node('a');
        const b = node('b');
        const a1 = node('a1');
        const b1 = node('b1');
        const join = node('join');
        const edges = [edge(r, a), edge(r, b), edge(a, a1), edge(b, b1), edge(a1, join), edge(b1, join)];

        expect([...GraphQuery.lineage('a', edges)].sort()).toEqual(['a', 'a1', 'join', 'r']);
        expect(GraphQuery.neighborhood('a', edges, Infinity, 'both').has('b')).toBe(true);
        expect(GraphQuery.lineage('x', edges, new Set(['a']))).toEqual(new Set());
    });
});

describe('ColumnHeaders.spans', () => {
    it('splits halfway between neighbours and mirrors the gap at the ends', () => {
        const spans = ColumnHeaders.spans([
            {ring: 0, pos: 100, halfWidth: 0, count: 1},
            {ring: 1, pos: 300, halfWidth: 0, count: 3},
            {ring: 2, pos: 400, halfWidth: 0, count: 9}
        ], (x) => x);

        expect(spans.map((s) => [s.left, s.right])).toEqual([[0, 200], [200, 350], [350, 450]]);
        expect(spans[1]!.count).toBe(3);
    });
});

describe('Flow look styles', () => {
    it('colours edges by the source or target accent, edge colour wins', () => {
        const a = node('a', 0, {color: '#ff0000'});
        const b = node('b', 1, {color: '#00ff00'});
        const e = edge(a, b);
        const styles = new StyleResolver(Theme.dark);

        expect(styles.edge(e).color).not.toBe('#ff0000');
        styles.setDefaults({edgeColor: 'source'});
        expect(styles.edge(e).color).toBe('#ff0000');
        styles.setDefaults({edgeColor: 'target'});
        expect(styles.edge(e).color).toBe('#00ff00');

        const own = new GraphEdge({id: 'o', source: 'a', target: 'b', color: '#0000ff'}, a, b);
        expect(styles.edge(own).color).toBe('#0000ff');
    });

    it('applies graph-wide glow and label position, per-node styles win', () => {
        const n = node('n');
        const styles = new StyleResolver(Theme.dark, {}, (x) => (x.id === 'n' ? {glow: 4, labelPosition: 'left'} : null));
        styles.setDefaults({nodeGlow: 12, edgeGlow: 6, labelPosition: 'right'});

        expect(styles.node(node('m'))).toMatchObject({glow: 12, labelPosition: 'right'});
        expect(styles.node(n)).toMatchObject({glow: 4, labelPosition: 'left'});
        expect(styles.edge(edge(n, node('m'))).glow).toBe(6);
    });

    it('anchors labels beside, above or below the node', () => {
        const n = node('n');
        n.x = 100;
        n.y = 50;
        const style = {...new StyleResolver(Theme.dark).node(n), radius: 10, labelSize: 11};
        const offset = 10 + 11 + 3;

        expect(CanvasRenderer.labelAnchor(n, {...style, labelPosition: 'below'}, offset)).toEqual({x: 100, y: 74, align: 'center'});
        const right = CanvasRenderer.labelAnchor(n, {...style, labelPosition: 'right'}, offset);
        expect(right.align).toBe('left');
        expect(right.x).toBe(116);
        expect(CanvasRenderer.labelAnchor(n, {...style, labelPosition: 'left'}, offset)).toMatchObject({x: 84, align: 'right'});
        expect(CanvasRenderer.labelAnchor(n, {...style, labelPosition: 'above'}, offset).y).toBeLessThan(40);
    });
});
