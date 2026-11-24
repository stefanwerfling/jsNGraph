import { Color, Rgba } from '../util/Color';
import { BatchedSegment } from './EdgeBatcher';

/**
 * Where the 2d renderer hands off the bulk of a frame: plain straight edges
 * (with their arrowheads) and plain dots. The canvas renderer strokes them
 * itself; the WebGL layer (J11) collects them into instance buffers.
 */
export interface BulkSink {
    /** A plain edge; same arguments as EdgeBatcher.add. */
    line(color: string, width: number, alpha: number, segment: BatchedSegment): void;
    /** A plain dot: filled disc with a 1 world-px rim. */
    disc(x: number, y: number, r: number, fill: string, stroke: string, alpha: number): void;
}

/** A growable Float32Array that is reused frame after frame. */
class FloatList {
    public data: Float32Array;
    public length = 0;

    public constructor(capacity: number) {
        this.data = new Float32Array(capacity);
    }

    public reserve(extra: number): Float32Array {
        const need = this.length + extra;

        if (need > this.data.length) {
            let size = this.data.length * 2;

            while (size < need) {
                size *= 2;
            }

            const next = new Float32Array(size);
            next.set(this.data.subarray(0, this.length));
            this.data = next;
        }

        return this.data;
    }
}

/**
 * Packs the bulk of a frame into flat float arrays, one instance per edge,
 * arrowhead and dot, ready for instanced drawing. Pure (no GL), so the
 * packing is unit-testable. Colors are 0..1 RGBA, straight (not
 * premultiplied); `alpha` multiplies into A.
 */
export class BulkBuffers implements BulkSink {

    /** Floats per line instance: ax ay bx by width r g b a. */
    public static readonly LINE_STRIDE = 9;
    /** Floats per arrow instance: tipX tipY dirX dirY size r g b a. */
    public static readonly ARROW_STRIDE = 9;
    /** Floats per disc instance: x y r  fill rgba  stroke rgba. */
    public static readonly DISC_STRIDE = 11;

    /** Unparseable colors draw grey rather than vanish. */
    private static readonly FALLBACK = {r: 128, g: 128, b: 128, a: 1};

    public readonly lines = new FloatList(BulkBuffers.LINE_STRIDE * 1024);
    public readonly arrows = new FloatList(BulkBuffers.ARROW_STRIDE * 256);
    public readonly discs = new FloatList(BulkBuffers.DISC_STRIDE * 1024);
    /** Exact-string color cache: a big frame repeats a handful of colors tens of thousands of times. */
    private readonly colors = new Map<string, Rgba>();

    public get lineCount(): number {
        return this.lines.length / BulkBuffers.LINE_STRIDE;
    }

    public get arrowCount(): number {
        return this.arrows.length / BulkBuffers.ARROW_STRIDE;
    }

    public get discCount(): number {
        return this.discs.length / BulkBuffers.DISC_STRIDE;
    }

    public reset(): void {
        this.lines.length = 0;
        this.arrows.length = 0;
        this.discs.length = 0;
    }

    public line(color: string, width: number, alpha: number, segment: BatchedSegment): void {
        const c = this.rgba(color);
        const a = c.a * alpha;

        if (a <= 0) {
            return;
        }

        const {from, to} = segment;
        const d = this.lines.reserve(BulkBuffers.LINE_STRIDE);
        let i = this.lines.length;

        d[i++] = from.x;
        d[i++] = from.y;
        d[i++] = to.x;
        d[i++] = to.y;
        d[i++] = width;
        d[i++] = c.r / 255;
        d[i++] = c.g / 255;
        d[i++] = c.b / 255;
        d[i++] = a;
        this.lines.length = i;

        if (segment.arrow <= 0) {
            return;
        }

        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy);

        if (len === 0) {
            return;
        }

        const h = this.arrows.reserve(BulkBuffers.ARROW_STRIDE);
        let j = this.arrows.length;

        h[j++] = to.x;
        h[j++] = to.y;
        h[j++] = dx / len;
        h[j++] = dy / len;
        h[j++] = segment.arrow;
        h[j++] = c.r / 255;
        h[j++] = c.g / 255;
        h[j++] = c.b / 255;
        h[j++] = a;
        this.arrows.length = j;
    }

    public disc(x: number, y: number, r: number, fill: string, stroke: string, alpha: number): void {
        if (alpha <= 0) {
            return;
        }

        const f = this.rgba(fill);
        const s = this.rgba(stroke);
        const d = this.discs.reserve(BulkBuffers.DISC_STRIDE);
        let i = this.discs.length;

        d[i++] = x;
        d[i++] = y;
        d[i++] = r;
        d[i++] = f.r / 255;
        d[i++] = f.g / 255;
        d[i++] = f.b / 255;
        d[i++] = f.a * alpha;
        d[i++] = s.r / 255;
        d[i++] = s.g / 255;
        d[i++] = s.b / 255;
        d[i++] = s.a * alpha;
        this.discs.length = i;
    }

    private rgba(css: string): Rgba {
        let c = this.colors.get(css);

        if (c === undefined) {
            if (this.colors.size > 1024) {
                this.colors.clear();
            }

            c = Color.parse(css) ?? BulkBuffers.FALLBACK;
            this.colors.set(css, c);
        }

        return c;
    }

}

/** @deprecated use BulkBuffers.LINE_STRIDE */
export const LINE_STRIDE = BulkBuffers.LINE_STRIDE;
/** @deprecated use BulkBuffers.ARROW_STRIDE */
export const ARROW_STRIDE = BulkBuffers.ARROW_STRIDE;
/** @deprecated use BulkBuffers.DISC_STRIDE */
export const DISC_STRIDE = BulkBuffers.DISC_STRIDE;
