import { describe, expect, it } from 'vitest';
import { Effects, OverlayContext } from '../src/render/Effects';
import { Point } from '../src/util/Geometry';

/** Canvas stub that records arcs and curves with the alpha they were drawn at. */
class Ctx {

    public globalAlpha = 1;
    public fillStyle = '';
    public strokeStyle = '';
    public lineWidth = 1;
    public lineCap = '';
    public shadowColor = '';
    public shadowBlur = 0;
    public readonly arcs: Array<{x: number; y: number; r: number; alpha: number}> = [];
    public readonly curves: Array<{from: Point; to: Point; alpha: number}> = [];
    private cursor: Point = {x: 0, y: 0};

    public save(): void {}
    public restore(): void {}
    public beginPath(): void {}
    public fill(): void {}
    public stroke(): void {}
    public moveTo(x: number, y: number): void { this.cursor = {x: x, y: y}; }
    public arc(x: number, y: number, r: number): void { this.arcs.push({x: x, y: y, r: r, alpha: this.globalAlpha}); }
    public quadraticCurveTo(_cx: number, _cy: number, x: number, y: number): void {
        this.curves.push({from: this.cursor, to: {x: x, y: y}, alpha: this.globalAlpha});
    }

}

const context = (positions: Record<string, Point>, timeMs: number, scale = 1): OverlayContext => ({
    timeMs: timeMs,
    scale: scale,
    nodePosition: (id) => positions[id] ?? null,
    nodeRadius: (id) => (positions[id] !== undefined ? 7 : null)
});

const run = (effects: Effects, positions: Record<string, Point>, timeMs: number, scale = 1): {ctx: Ctx; animating: boolean} => {
    const ctx = new Ctx();
    const animating = effects.draw(ctx as unknown as CanvasRenderingContext2D, context(positions, timeMs, scale));
    return {ctx: ctx, animating: animating};
};

describe('Effects', () => {
    it('a pulse grows, fades and removes itself after its duration', () => {
        const effects = new Effects();
        const at = {a: {x: 10, y: 20}};

        effects.pulse(['a'], '#0f0', {durationMs: 1000});

        const first = run(effects, at, 5000);
        const mid = run(effects, at, 5500);

        expect(first.animating).toBe(true);
        expect(mid.ctx.arcs[0]!.r).toBeGreaterThan(first.ctx.arcs[0]!.r);
        expect(mid.ctx.arcs[0]!.alpha).toBeLessThan(first.ctx.arcs[0]!.alpha);

        expect(run(effects, at, 6000).animating).toBe(false);
        expect(effects.active).toBe(0);
    });

    it('a trail follows its nodes while they move', () => {
        const effects = new Effects();

        effects.trail('a', 'b', '#f00');
        const before = run(effects, {a: {x: 0, y: 0}, b: {x: 100, y: 0}}, 0).ctx.curves[0]!;
        const after = run(effects, {a: {x: 0, y: 0}, b: {x: 300, y: 50}}, 100).ctx.curves[0]!;

        expect(before.to).toEqual({x: 100, y: 0});
        expect(after.to).toEqual({x: 300, y: 50});
    });

    it('ignores a trail onto itself and skips nodes that are gone', () => {
        const effects = new Effects();

        effects.trail('a', 'a', '#f00');
        expect(effects.active).toBe(0);

        effects.pulse(['missing'], '#f00');
        const frame = run(effects, {}, 0);
        expect(frame.ctx.arcs).toHaveLength(0);
        expect(frame.animating).toBe(true);
    });

    it('staggers ripple waves and keeps their size constant on screen', () => {
        const effects = new Effects();

        effects.ripple('a', '#ff0', {waves: 2, delayMs: 200, durationMs: 1000, endRadius: 100});
        const at = {a: {x: 0, y: 0}};

        expect(run(effects, at, 0).ctx.arcs).toHaveLength(1);
        expect(run(effects, at, 300).ctx.arcs).toHaveLength(2);

        // At zoom 2 the world radius halves, so the on-screen radius stays the same.
        const zoomed = new Effects();
        zoomed.ripple('a', '#ff0', {waves: 1, durationMs: 1000, endRadius: 100});
        run(zoomed, at, 0, 2);
        const late = run(zoomed, at, 999, 2).ctx.arcs[0]!;
        expect(late.r).toBeCloseTo(50, 0);
    });

    it('bends a trail to the left of its direction', () => {
        expect(Effects.bend({x: 0, y: 0}, {x: 100, y: 0}, 10)).toEqual({x: 50, y: 10});
    });
});
