import { Point } from '../util/Geometry';

/** What an overlay can ask about the current frame. */
export interface OverlayContext {
    /** Same clock as the render loop (ms). */
    timeMs: number;
    /** Camera scale: divide screen px by it to get world px. */
    scale: number;
    /** Live world position of a node, or null if it does not exist / is filtered out. */
    nodePosition(id: string): Point | null;
    /** Drawn radius of a node in world px, or null. */
    nodeRadius(id: string): number | null;
}

/**
 * A drawing hook (J8). `draw` runs every frame in WORLD coordinates (the
 * camera transform is applied); return true while something animates so
 * the render loop keeps going, false/undefined lets it go idle.
 */
export interface NGraphOverlay {
    /** 'under': above hulls, below edges. 'over' (default): above nodes and labels. */
    layer?: 'under' | 'over';
    draw(ctx: CanvasRenderingContext2D, info: OverlayContext): boolean | void;
}

export interface PulseOptions {
    /** Default 1400 ms. */
    durationMs?: number;
}

export interface TrailOptions {
    /** Default 2200 ms. */
    durationMs?: number;
    /** Sideways bend of the arc in screen px. Default 28. */
    curve?: number;
}

export interface RippleOptions {
    /** Per wave. Default 1100 ms. */
    durationMs?: number;
    /** Final radius in screen px. Default 140. */
    endRadius?: number;
    /** Number of waves. Default 2. */
    waves?: number;
    /** Gap between waves. Default 220 ms. */
    delayMs?: number;
}

interface Effect {
    kind: 'pulse' | 'trail' | 'ripple';
    ids: [string, string?];
    color: string;
    durationMs: number;
    delayMs: number;
    /** Set on the first frame that sees the effect (render-loop clock). */
    startedAt: number | null;
    curve: number;
    endRadius: number;
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * Short-lived activity animations anchored to nodes: a pulse ring on a
 * node, a fading arc travelling between two nodes, ripples spreading from
 * a node. They follow their nodes while those move and remove themselves
 * when done. Sizes are in screen px so they read the same at any zoom.
 */
export class Effects implements NGraphOverlay {

    public readonly layer = 'over' as const;
    private effects: Effect[] = [];

    public get active(): number {
        return this.effects.length;
    }

    public pulse(ids: Iterable<string>, color: string, options: PulseOptions = {}): void {
        for (const id of ids) {
            this.effects.push(Effects.make('pulse', [id], color, options.durationMs ?? 1400));
        }
    }

    public trail(fromId: string, toId: string, color: string, options: TrailOptions = {}): void {
        if (fromId === toId) {
            return;
        }

        const effect = Effects.make('trail', [fromId, toId], color, options.durationMs ?? 2200);
        effect.curve = options.curve ?? 28;
        this.effects.push(effect);
    }

    public ripple(id: string, color: string, options: RippleOptions = {}): void {
        const waves = options.waves ?? 2;

        for (let i = 0; i < waves; i++) {
            const effect = Effects.make('ripple', [id], color, options.durationMs ?? 1100);
            effect.delayMs = i * (options.delayMs ?? 220);
            effect.endRadius = options.endRadius ?? 140;
            this.effects.push(effect);
        }
    }

    public clear(): void {
        this.effects = [];
    }

    public draw(ctx: CanvasRenderingContext2D, info: OverlayContext): boolean {
        if (this.effects.length === 0) {
            return false;
        }

        const survivors: Effect[] = [];

        for (const effect of this.effects) {
            effect.startedAt ??= info.timeMs;
            const elapsed = info.timeMs - effect.startedAt - effect.delayMs;

            if (elapsed >= effect.durationMs) {
                continue;
            }

            survivors.push(effect);

            if (elapsed < 0) {
                continue;
            }

            const t = elapsed / effect.durationMs;

            ctx.save();

            if (effect.kind === 'pulse') {
                this.drawPulse(ctx, info, effect, t);
            } else if (effect.kind === 'trail') {
                this.drawTrail(ctx, info, effect, t);
            } else {
                this.drawRipple(ctx, info, effect, t);
            }

            ctx.restore();
        }

        this.effects = survivors;
        return survivors.length > 0;
    }

    /** Ring that grows from the node and fades (an "accessed" flash). */
    private drawPulse(ctx: CanvasRenderingContext2D, info: OverlayContext, effect: Effect, t: number): void {
        const id = effect.ids[0];
        const at = info.nodePosition(id);

        if (at === null) {
            return;
        }

        const r = info.nodeRadius(id) ?? 6;
        const grow = easeOutCubic(t);

        ctx.fillStyle = effect.color;
        ctx.globalAlpha = 0.45 * (1 - t);
        ctx.beginPath();
        ctx.arc(at.x, at.y, r + (6 + grow * 14) / info.scale, 0, Math.PI * 2);
        ctx.fill();
    }

    /** Arc between two nodes; opacity holds, then fades. */
    private drawTrail(ctx: CanvasRenderingContext2D, info: OverlayContext, effect: Effect, t: number): void {
        const a = info.nodePosition(effect.ids[0]);
        const b = info.nodePosition(effect.ids[1] as string);

        if (a === null || b === null) {
            return;
        }

        const control = Effects.bend(a, b, effect.curve / info.scale);

        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 2.4 / info.scale;
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.95 * (t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6);
        ctx.shadowColor = effect.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(control.x, control.y, b.x, b.y);
        ctx.stroke();
    }

    /** Thin circle spreading out from a node ("focus here"). */
    private drawRipple(ctx: CanvasRenderingContext2D, info: OverlayContext, effect: Effect, t: number): void {
        const id = effect.ids[0];
        const at = info.nodePosition(id);

        if (at === null) {
            return;
        }

        const start = Math.max(8 / info.scale, info.nodeRadius(id) ?? 0);
        const end = effect.endRadius / info.scale;

        ctx.strokeStyle = effect.color;
        ctx.lineWidth = (1.2 + (1 - t) * 2.4) / info.scale;
        ctx.globalAlpha = 0.95 * (1 - t);
        ctx.shadowColor = effect.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(at.x, at.y, start + (end - start) * easeOutCubic(t), 0, Math.PI * 2);
        ctx.stroke();
    }

    /** Control point `offset` to the left of the a→b midpoint. */
    public static bend(a: Point, b: Point, offset: number): Point {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);

        if (len === 0) {
            return {x: mx, y: my};
        }

        return {x: mx - (dy / len) * offset, y: my + (dx / len) * offset};
    }

    private static make(kind: Effect['kind'], ids: [string, string?], color: string, durationMs: number): Effect {
        return {kind: kind, ids: ids, color: color, durationMs: durationMs, delayMs: 0, startedAt: null, curve: 0, endRadius: 0};
    }

}
