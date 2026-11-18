import { describe, expect, it } from 'vitest';
import { CanvasRenderer, RenderCluster } from '../src/render/CanvasRenderer';
import { ClusterMember, ClusterResolver } from '../src/render/ClusterResolver';

const members: Record<string, ClusterMember> = {
    a: {x: 0, y: 0, radius: 2},
    b: {x: 10, y: 0, radius: 2},
    c: {x: 100, y: 100, radius: 3}
};
const lookup = (id: string): ClusterMember | null => members[id] ?? null;
const color = (id: string): string => `color-${id}`;

describe('ClusterResolver', () => {
    it('places a cluster without x/y at the centroid of its visible members', () => {
        const {discs} = ClusterResolver.resolve([{id: 'k', nodeIds: ['a', 'b', 'gone']}], [], lookup, color);

        expect(discs).toHaveLength(1);
        expect(discs[0]).toMatchObject({id: 'k', x: 5, y: 0, size: 3, color: 'color-k', label: null});
        // farthest member (5 px away) plus its radius
        expect(discs[0]?.radius).toBe(7);
    });

    it('keeps explicit position, size, radius, color and label', () => {
        const {discs} = ClusterResolver.resolve(
            [{id: 'k', x: 50, y: 60, size: 900, radius: 40, color: '#abc', label: 'Projects', nodeIds: ['a']}],
            [], lookup, color);

        expect(discs[0]).toEqual({id: 'k', x: 50, y: 60, size: 900, radius: 40, color: '#abc', label: 'Projects'});
    });

    it('has no extent limit without radius and members', () => {
        const {discs} = ClusterResolver.resolve([{id: 'k', x: 0, y: 0, size: 4}], [], lookup, color);

        expect(discs[0]?.radius).toBe(Infinity);
    });

    it('drops clusters with neither a position nor a visible member, and their edges', () => {
        const result = ClusterResolver.resolve(
            [{id: 'k', nodeIds: ['a']}, {id: 'empty', nodeIds: ['gone']}, {id: 'm', nodeIds: ['c']}],
            [{source: 'k', target: 'm', weight: 5}, {source: 'k', target: 'empty'}, {source: 'm', target: 'm'}],
            lookup, color);

        expect(result.discs.map((d) => d.id)).toEqual(['k', 'm']);
        expect(result.edges).toHaveLength(1);
        expect(result.edges[0]?.weight).toBe(5);
        expect(result.edges[0]?.source.id).toBe('k');
    });

    it('orders discs biggest first, so small ones are drawn on top', () => {
        const {discs} = ClusterResolver.resolve(
            [{id: 's', x: 0, y: 0, size: 2}, {id: 'l', x: 0, y: 0, size: 50}, {id: 'm', x: 0, y: 0, size: 10}],
            [], lookup, color);

        expect(discs.map((d) => d.id)).toEqual(['l', 'm', 's']);
    });
});

describe('CanvasRenderer.clusterRadiusPx', () => {
    const disc = (size: number, radius: number): RenderCluster =>
        ({id: 'x', x: 0, y: 0, size: size, radius: radius, color: '#000', label: null});

    it('grows with the member count up to a cap', () => {
        const small = CanvasRenderer.clusterRadiusPx(disc(4, Infinity), 1);
        const big = CanvasRenderer.clusterRadiusPx(disc(400, Infinity), 1);

        expect(big).toBeGreaterThan(small);
        expect(CanvasRenderer.clusterRadiusPx(disc(1e9, Infinity), 1)).toBe(64);
    });

    it('stays inside the cluster extent on screen, but at least 3 px', () => {
        expect(CanvasRenderer.clusterRadiusPx(disc(400, 100), 0.1)).toBe(10);
        expect(CanvasRenderer.clusterRadiusPx(disc(400, 100), 0.001)).toBe(3);
    });
});
