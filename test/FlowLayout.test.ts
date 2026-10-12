import { describe, expect, it } from 'vitest';
import { FlowLayout } from '../src/modelview/FlowLayout';
import { ModelNode } from '../src/modelview/ModelNode';
import { ModelModuleData } from '../src/modelview/ModelTypes';

function node(id: string, extra: Partial<ModelModuleData> = {}): ModelNode {
    return new ModelNode({id: id, label: id, ...extra});
}

describe('FlowLayout', () => {
    it('ranks modules by longest path so a residual edge does not pull its target up', () => {
        // emb -> attn -> mlp -> head, plus a residual emb -> head that skips
        // two ranks. Longest-path ranking must keep head at rank 3, not 1.
        const nodes = [node('emb'), node('attn'), node('mlp'), node('head')];
        const flows = [
            {source: 'emb', target: 'attn'},
            {source: 'attn', target: 'mlp'},
            {source: 'mlp', target: 'head'},
            {source: 'emb', target: 'head', kind: 'residual' as const}
        ];

        const ranks = FlowLayout.computeRanks(nodes, flows);

        expect(ranks.get('emb')).toBe(0);
        expect(ranks.get('attn')).toBe(1);
        expect(ranks.get('mlp')).toBe(2);
        expect(ranks.get('head')).toBe(3);
    });

    it('stacks ranks top-down and spreads same-rank blocks horizontally', () => {
        const hub = node('hub');
        const a = node('a');
        const b = node('b');
        const flows = [
            {source: 'hub', target: 'a'},
            {source: 'hub', target: 'b'}
        ];

        new FlowLayout().apply([hub, a, b], flows);

        // hub (rank 0) sits above a and b (rank 1)
        expect(hub.y).toBeLessThan(a.y);
        expect(a.y).toBeCloseTo(b.y, 5);
        // a and b share a rank, so they are side by side and centered on 0
        expect(a.x).not.toBeCloseTo(b.x, 1);
        expect((a.x + b.x) / 2).toBeCloseTo(0, 5);
    });

    it('leaves pinned modules where the caller put them', () => {
        const pinned = node('p', {x: 500, y: 900});
        const free = node('q');

        new FlowLayout().apply([pinned, free], [{source: 'p', target: 'q'}]);

        expect(pinned.x).toBe(500);
        expect(pinned.y).toBe(900);
    });

    it('terminates on a feedback cycle instead of looping forever', () => {
        const nodes = [node('a'), node('b'), node('c')];
        const flows = [
            {source: 'a', target: 'b'},
            {source: 'b', target: 'c'},
            {source: 'c', target: 'a'}
        ];

        // Relaxation is capped at V iterations, so this returns instead of
        // looping forever; the point is every node gets a finite rank.
        const ranks = FlowLayout.computeRanks(nodes, flows);

        for (const n of nodes) {
            const rank = ranks.get(n.id);

            expect(Number.isFinite(rank)).toBe(true);
            expect(rank).toBeGreaterThanOrEqual(0);
        }
    });

    it('is deterministic across runs', () => {
        const run = (): number[] => {
            const nodes = [node('emb'), node('a'), node('b'), node('head')];
            const flows = [
                {source: 'emb', target: 'a'},
                {source: 'emb', target: 'b'},
                {source: 'a', target: 'head'},
                {source: 'b', target: 'head'}
            ];

            new FlowLayout().apply(nodes, flows);

            return nodes.flatMap((n) => [n.x, n.y]);
        };

        const first = run();
        const second = run();

        for (let i = 0; i < first.length; i++) {
            expect(first[i]).toBeCloseTo(second[i] ?? NaN, 5);
        }
    });
});
