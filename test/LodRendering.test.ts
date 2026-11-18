import { describe, expect, it } from 'vitest';
import { StaticLayout } from '../src/layout/StaticLayout';
import { GraphNode } from '../src/model/GraphNode';
import { EdgeBatcher } from '../src/render/EdgeBatcher';
import { LabelPlacer } from '../src/render/LabelPlacer';
import { StyleResolver } from '../src/render/StyleResolver';
import { Theme } from '../src/render/Theme';

/** Records the canvas calls EdgeBatcher makes. */
class RecordingContext {

    public readonly calls: string[] = [];
    public globalAlpha = 1;
    public strokeStyle = '';
    public fillStyle = '';
    public lineWidth = 1;

    public save(): void { this.calls.push('save'); }
    public restore(): void { this.calls.push('restore'); }
    public beginPath(): void { this.calls.push('beginPath'); }
    public moveTo(): void { this.calls.push('moveTo'); }
    public lineTo(): void { this.calls.push('lineTo'); }
    public closePath(): void { this.calls.push('closePath'); }
    public stroke(): void { this.calls.push(`stroke:${this.strokeStyle}:${this.lineWidth}:${this.globalAlpha}`); }
    public fill(): void { this.calls.push(`fill:${this.fillStyle}`); }

}

describe('LabelPlacer', () => {
    it('accepts free boxes and rejects overlapping ones', () => {
        const placer = new LabelPlacer(64, 0);

        expect(placer.tryPlace({x: 0, y: 0, w: 50, h: 12})).toBe(true);
        expect(placer.tryPlace({x: 40, y: 5, w: 50, h: 12})).toBe(false);
        expect(placer.tryPlace({x: 60, y: 0, w: 50, h: 12})).toBe(true);
        expect(placer.tryPlace({x: 0, y: 20, w: 50, h: 12})).toBe(true);
    });

    it('finds overlaps across bucket borders and with negative coordinates', () => {
        const placer = new LabelPlacer(16, 0);

        expect(placer.tryPlace({x: -30, y: -30, w: 100, h: 40})).toBe(true);
        expect(placer.tryPlace({x: 60, y: 0, w: 5, h: 5})).toBe(false);
        expect(placer.tryPlace({x: 71, y: 0, w: 5, h: 5})).toBe(true);
    });

    it('starts empty after reset', () => {
        const placer = new LabelPlacer();

        placer.tryPlace({x: 0, y: 0, w: 10, h: 10});
        placer.reset();
        expect(placer.tryPlace({x: 0, y: 0, w: 10, h: 10})).toBe(true);
    });
});

describe('EdgeBatcher', () => {
    it('strokes one path per distinct look and fills arrowheads in the same group', () => {
        const batcher = new EdgeBatcher();
        const ctx = new RecordingContext();

        for (let i = 0; i < 100; i++) {
            batcher.add('#333', 1, 0.85, {from: {x: i, y: 0}, to: {x: i, y: 10}, arrow: i % 2 === 0 ? 6 : 0});
        }

        batcher.add('#f00', 2, 0.85, {from: {x: 0, y: 0}, to: {x: 1, y: 1}, arrow: 0});
        expect(batcher.size).toBe(2);

        batcher.flush(ctx as unknown as CanvasRenderingContext2D);

        const strokes = ctx.calls.filter((c) => c.startsWith('stroke'));
        expect(strokes).toEqual(['stroke:#333:1:0.85', 'stroke:#f00:2:0.85']);
        expect(ctx.calls.filter((c) => c.startsWith('fill'))).toEqual(['fill:#333']);
        expect(ctx.calls.filter((c) => c === 'closePath')).toHaveLength(50);
        expect(batcher.size).toBe(0);
    });

    it('keeps dimmed edges in their own group', () => {
        const batcher = new EdgeBatcher();

        batcher.add('#333', 1, 0.85, {from: {x: 0, y: 0}, to: {x: 1, y: 0}, arrow: 0});
        batcher.add('#333', 1, 0.85 * 0.15, {from: {x: 0, y: 0}, to: {x: 1, y: 0}, arrow: 0});
        expect(batcher.size).toBe(2);
    });
});

describe('StaticLayout', () => {
    it('never moves nodes', () => {
        const node = new GraphNode({id: 'a', label: 'A'}, 12, 34);
        const layout = new StaticLayout();

        layout.reheat(1);
        layout.tick([node], [], 800, 600);
        expect([node.x, node.y]).toEqual([12, 34]);
    });
});

describe('NodeStyle.ring', () => {
    it('resolves a ring with defaults and keeps none by default', () => {
        const node = new GraphNode({id: 'a', label: 'A', shape: 'dot'}, 0, 0);

        expect(new StyleResolver(Theme.dark).node(node).ring).toBeNull();

        const styled = new StyleResolver(Theme.dark, {}, () => ({ring: {color: '#ffd166', opacity: 3}})).node(node);
        expect(styled.ring).toEqual({color: '#ffd166', width: 2, opacity: 1});
    });
});
