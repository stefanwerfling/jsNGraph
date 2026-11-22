import { NetHead, NetMeasurements, NetTrace, NetTraceBlock } from './NetTypes';

/**
 * Pure compression and measurement of a model trace: the residual stream of
 * thousands of dimensions folded into a few dozen bins, the strongest bins
 * per block (the "active path"), attention focus, and summary numbers. No DOM.
 */
export class NetCompress {

    /**
     * Fold a residual vector into `count` bins. Each bin keeps the signed
     * value of its largest-magnitude dimension — a single strong dimension
     * stays visible instead of averaging away.
     */
    public static bins(values: ArrayLike<number>, count: number): Float32Array {
        const n = values.length;
        const out = new Float32Array(Math.max(1, count));

        if (n === 0) {
            return out;
        }

        for (let b = 0; b < out.length; b++) {
            const from = Math.floor((b * n) / out.length);
            const to = Math.max(from + 1, Math.floor(((b + 1) * n) / out.length));
            let best = 0;

            for (let i = from; i < to && i < n; i++) {
                const v = values[i]!;

                if (Number.isFinite(v) && Math.abs(v) > Math.abs(best)) {
                    best = v;
                }
            }
            out[b] = best;
        }

        return out;
    }

    /** Bins from only the strongest dimensions (when the raw vector was not exported). */
    public static binsFromTop(top: readonly {dim: number; value: number}[], hidden: number, count: number): Float32Array {
        const out = new Float32Array(Math.max(1, count));

        for (const {dim, value} of top) {
            if (dim < 0 || dim >= hidden || !Number.isFinite(value)) {
                continue;
            }

            const b = Math.min(out.length - 1, Math.floor((dim * out.length) / hidden));

            if (Math.abs(value) > Math.abs(out[b]!)) {
                out[b] = value;
            }
        }

        return out;
    }

    /** The bins of one trace block, from its raw values or its top dimensions (null: neither). */
    public static blockBins(block: NetTraceBlock, hidden: number, count: number): Float32Array | null {
        if (block.values !== undefined && block.values.length > 0) {
            return NetCompress.bins(block.values, count);
        }
        if (block.topDims !== undefined && block.topDims.length > 0) {
            return NetCompress.binsFromTop(block.topDims, hidden, count);
        }

        return null;
    }

    /**
     * Scale bins to -1..1 by how far they stand out: the median magnitude
     * maps to 0, a high percentile to 1. Every bin is the maximum of many
     * noisy dimensions, so all of them are "large" — only the excess over the
     * typical bin carries meaning. Outlier dimensions saturate at ±1 instead
     * of darkening everything else.
     */
    public static normalize(bins: Float32Array, percentile = 0.95): Float32Array {
        const mags = Array.from(bins, (v) => Math.abs(v)).sort((a, b) => a - b);
        const at = (q: number): number => mags[Math.min(mags.length - 1, Math.floor(q * (mags.length - 1)))] ?? 0;
        const low = at(0.5);
        let high = at(percentile);

        if (high <= low) {
            high = mags[mags.length - 1] ?? 0;
        }

        const out = new Float32Array(bins.length);

        if (high <= low) {
            // Flat vector: every non-zero bin stands out equally.
            for (let i = 0; i < bins.length; i++) {
                out[i] = Math.sign(bins[i]!) * (high > 0 ? 1 : 0);
            }
            return out;
        }
        for (let i = 0; i < bins.length; i++) {
            const v = bins[i]!;

            out[i] = Math.sign(v) * Math.max(0, Math.min(1, (Math.abs(v) - low) / (high - low)));
        }

        return out;
    }

    /** Indices of the `k` strongest bins, strongest first. */
    public static strongest(bins: Float32Array, k: number): number[] {
        return Array.from(bins, (v, i) => ({i, m: Math.abs(v)}))
            .filter((x) => x.m > 0)
            .sort((a, b) => b.m - a.m || a.i - b.i)
            .slice(0, Math.max(0, k))
            .map((x) => x.i);
    }

    /**
     * How focused a head is: 1 − entropy / ln(context). 1 = all weight on one
     * token, 0 = spread evenly. Without an entropy, the top weight stands in.
     */
    public static focus(head: NetHead, context: number): number {
        if (head.entropy !== undefined && context > 1) {
            return Math.max(0, Math.min(1, 1 - (head.entropy / Math.log(context))));
        }

        return Math.max(0, Math.min(1, head.top?.[0]?.weight ?? 0));
    }

    /** Summary numbers of a trace — where the answer settles, how the stream grows, how focused attention is. */
    public static measure(trace: NetTrace): NetMeasurements {
        const blocks = [...trace.blocks].sort((a, b) => a.block - b.block);
        const final = trace.prediction?.piece ?? blocks[blocks.length - 1]?.lens?.top[0]?.piece;
        const lensBlocks = blocks.filter((b) => b.lens !== undefined && b.lens.top.length > 0);
        let settle: number | null = null;

        for (let i = lensBlocks.length - 1; i >= 0; i--) {
            if (final !== undefined && lensBlocks[i]!.lens!.top[0]!.piece === final) {
                settle = lensBlocks[i]!.block;
            } else {
                break;
            }
        }

        const firstSeen = final === undefined ? undefined
            : lensBlocks.find((b) => b.lens!.top.some((t) => t.piece === final) || (b.lens!.finalRank ?? Infinity) < b.lens!.top.length);
        const withUpdate = blocks.filter((b) => b.update !== undefined);
        const peak = withUpdate.length === 0 ? null : withUpdate.reduce((m, b) => (b.update! > m.update! ? b : m)).block;
        const ent = lensBlocks.filter((b) => b.lens!.entropy !== undefined);
        const norms = blocks.filter((b) => b.l2 !== undefined && b.l2 > 0);
        const context = Math.max(2, (trace.position ?? (trace.tokens?.length ?? 2) - 1) + 1);
        const foci = blocks.flatMap((b) => (b.heads ?? []).map((h) => NetCompress.focus(h, context)));
        const experts = new Set(blocks.flatMap((b) => (b.experts ?? []).map((e) => e.expert)));
        const hasExperts = blocks.some((b) => b.experts !== undefined);

        return {
            blocks: blocks.length,
            settleBlock: settle,
            firstSeenBlock: firstSeen?.block ?? null,
            peakUpdateBlock: peak,
            entropyStart: ent[0]?.lens!.entropy ?? null,
            entropyEnd: ent[ent.length - 1]?.lens!.entropy ?? null,
            normGrowth: norms.length >= 2 ? norms[norms.length - 1]!.l2! / norms[0]!.l2! : null,
            meanFocus: foci.length === 0 ? null : foci.reduce((a, b) => a + b, 0) / foci.length,
            distinctExperts: hasExperts ? experts.size : null
        };
    }

}
