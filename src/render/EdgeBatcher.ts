import { Point } from '../util/Geometry';

/** One straight segment of a plain edge, with an optional arrowhead. */
export interface BatchedSegment {
    from: Point;
    to: Point;
    /** Arrowhead size in world px, 0 = none. */
    arrow: number;
}

interface Batch {
    color: string;
    width: number;
    alpha: number;
    segments: BatchedSegment[];
}

/**
 * Collects plain edges (straight, solid, unlabelled, not animated) grouped
 * by color, width and opacity, and strokes each group as ONE path. Per-edge
 * save/stroke/restore was the main frame cost on graphs with thousands of
 * edges; a vault graph typically has one or two distinct edge looks.
 */
export class EdgeBatcher {

    /** Arrowheads per fill() call. */
    public static readonly ARROW_CHUNK = 64;

    private readonly batches = new Map<string, Batch>();

    public add(color: string, width: number, alpha: number, segment: BatchedSegment): void {
        // Quantize alpha so near-identical dimming does not split batches.
        const a = Math.round(alpha * 100) / 100;
        const key = `${color}|${width}|${a}`;
        let batch = this.batches.get(key);

        if (batch === undefined) {
            batch = {color: color, width: width, alpha: a, segments: []};
            this.batches.set(key, batch);
        }

        batch.segments.push(segment);
    }

    /** Number of groups (= stroke calls) collected so far. */
    public get size(): number {
        return this.batches.size;
    }

    public flush(ctx: CanvasRenderingContext2D): void {
        for (const batch of this.batches.values()) {
            ctx.save();
            ctx.globalAlpha = batch.alpha;
            ctx.strokeStyle = batch.color;
            ctx.fillStyle = batch.color;
            ctx.lineWidth = batch.width;
            ctx.beginPath();

            for (const s of batch.segments) {
                ctx.moveTo(s.from.x, s.from.y);
                ctx.lineTo(s.to.x, s.to.y);
            }

            ctx.stroke();

            // Filling one path with thousands of closed sub-paths is
            // superlinear in Chrome (5 000 heads: ~250 ms as one path, ~8 ms
            // in chunks of 64), so the heads are filled in chunks.
            let pending = 0;
            ctx.beginPath();

            for (const s of batch.segments) {
                if (s.arrow <= 0) {
                    continue;
                }

                const angle = Math.atan2(s.to.y - s.from.y, s.to.x - s.from.x);

                ctx.moveTo(s.to.x, s.to.y);
                ctx.lineTo(s.to.x - Math.cos(angle - 0.42) * s.arrow, s.to.y - Math.sin(angle - 0.42) * s.arrow);
                ctx.lineTo(s.to.x - Math.cos(angle + 0.42) * s.arrow, s.to.y - Math.sin(angle + 0.42) * s.arrow);
                ctx.closePath();

                if (++pending === EdgeBatcher.ARROW_CHUNK) {
                    ctx.fill();
                    ctx.beginPath();
                    pending = 0;
                }
            }

            if (pending > 0) {
                ctx.fill();
            }

            ctx.restore();
        }

        this.batches.clear();
    }

}
