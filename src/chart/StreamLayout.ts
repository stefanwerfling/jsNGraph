/** One layer (stream) — the same layers run through every panel. */
export interface StreamLayer {
    id: string;
    label: string;
    /** Any CSS colour; default a palette colour. */
    color?: string;
    /** Layers with the same group share one legend entry (e.g. two shades of one person). */
    group?: string;
}

/** One panel (small multiple): `values[layer][i]` belongs to `x[i]`. */
export interface StreamPanel {
    id?: string;
    label?: string;
    values: ReadonlyArray<ArrayLike<number>>;
}

export interface StreamData {
    /** Shared, increasing x positions. */
    x: ArrayLike<number>;
    layers: StreamLayer[];
    panels: StreamPanel[];
}

/** Where the stack sits: centred, least wiggle, on zero, or stretched to 100 %. */
export type StreamOffset = 'silhouette' | 'wiggle' | 'zero' | 'expand';
/** Stacking order: as given, reversed, or big early layers inside, later ones outside. */
export type StreamOrder = 'given' | 'reverse' | 'insideOut';

export interface StreamLayoutOptions {
    offset?: StreamOffset;
    order?: StreamOrder;
    /**
     * Gaussian smoothing bandwidth in x units (default 1.2 × the median x step;
     * 0 = none, straight lines between the points).
     */
    bandwidth?: number;
    /** Let the streams run out to zero beyond the first/last x (default true when smoothing). */
    taper?: boolean;
    /** Samples per original x step (default 4, at most 1200 samples). */
    resolution?: number;
    /** Layers treated as zero (hidden), by id. */
    hidden?: ReadonlySet<string>;
}

export interface StreamPanelResult {
    /** Per layer (data order): lower and upper edge at every sample. */
    lower: Float64Array[];
    upper: Float64Array[];
    /** Smoothed value per layer and sample (upper − lower before `expand`). */
    value: Float64Array[];
    /** y extent of the panel. */
    min: number;
    max: number;
}

export interface StreamResult {
    /** Sample positions (x units), extended by the taper. */
    xs: Float64Array;
    /** Stacking order, bottom to top, as layer indices. */
    order: number[];
    panels: StreamPanelResult[];
    /** Full x extent including the taper. */
    domain: {min: number; max: number};
}

/**
 * Pure layout of a streamgraph (no DOM): resample and smooth every layer
 * (a Gaussian kernel convolution — outside the data the streams fall to zero,
 * so they taper), order the layers once for all panels, stack them and move
 * the stack's baseline per the offset. `wiggle` is Byron & Wattenberg's
 * minimum-wiggle baseline (as in d3.stackOffsetWiggle), re-centred.
 */
export class StreamLayout {

    private readonly options: StreamLayoutOptions;

    public constructor(options: StreamLayoutOptions = {}) {
        this.options = options;
    }

    /** Median distance between neighbouring x values (1 for fewer than two). */
    public static medianStep(x: ArrayLike<number>): number {
        const d: number[] = [];

        for (let i = 1; i < x.length; i++) {
            d.push((x[i] ?? 0) - (x[i - 1] ?? 0));
        }
        if (d.length === 0) {
            return 1;
        }
        d.sort((a, b) => a - b);

        return d[Math.floor(d.length / 2)]! || 1;
    }

    /**
     * Value of one series at the sample positions. bandwidth 0: linear
     * interpolation (0 outside). Otherwise Σ vᵢ·K(x−xᵢ)·Δᵢ — a smoothed density
     * that keeps the level of dense data and falls to 0 beyond it.
     */
    public static smooth(x: ArrayLike<number>, v: ArrayLike<number>, xs: ArrayLike<number>, bandwidth: number): Float64Array {
        const n = x.length;
        const out = new Float64Array(xs.length);

        if (n === 0) {
            return out;
        }
        if (bandwidth <= 0) {
            let j = 0;

            for (let s = 0; s < xs.length; s++) {
                const at = xs[s]!;

                if (at < x[0]! || at > x[n - 1]!) {
                    continue;
                }
                while (j < n - 2 && x[j + 1]! < at) {
                    j++;
                }

                const x0 = x[j]!;
                const x1 = x[Math.min(n - 1, j + 1)]!;
                const t = x1 > x0 ? (at - x0) / (x1 - x0) : 0;

                out[s] = Math.max(0, ((v[j] ?? 0) * (1 - t)) + ((v[Math.min(n - 1, j + 1)] ?? 0) * t));
            }

            return out;
        }

        // spacing weight Δᵢ: half the distance to both neighbours (edges mirror theirs)
        const w = new Float64Array(n);

        for (let i = 0; i < n; i++) {
            const left = i > 0 ? x[i]! - x[i - 1]! : (n > 1 ? x[1]! - x[0]! : 1);
            const right = i < n - 1 ? x[i + 1]! - x[i]! : left;

            w[i] = (left + right) / 2;
        }

        const norm = 1 / (bandwidth * Math.sqrt(2 * Math.PI));
        const reach = bandwidth * 4;
        let first = 0;

        for (let s = 0; s < xs.length; s++) {
            const at = xs[s]!;
            let sum = 0;

            while (first < n && x[first]! < at - reach) {
                first++;
            }
            for (let i = first; i < n && x[i]! <= at + reach; i++) {
                const d = (at - x[i]!) / bandwidth;
                sum += Math.max(0, v[i] ?? 0) * w[i]! * Math.exp(-0.5 * d * d);
            }
            out[s] = sum * norm;
        }

        return out;
    }

    /**
     * Inside-out order (d3.stackOrderInsideOut): layers sorted by where they
     * peak, then dealt to the top or the bottom, whichever is lighter — early
     * peaks end up in the middle, the stream looks balanced.
     */
    public static insideOut(series: readonly ArrayLike<number>[]): number[] {
        const peak = series.map((s) => {
            let best = 0;
            for (let i = 1; i < s.length; i++) {
                if ((s[i] ?? 0) > (s[best] ?? 0)) {
                    best = i;
                }
            }
            return best;
        });
        const sums = series.map((s) => {
            let t = 0;
            for (let i = 0; i < s.length; i++) {
                t += s[i] ?? 0;
            }
            return t;
        });
        const byPeak = series.map((_, i) => i).sort((a, b) => peak[a]! - peak[b]! || a - b);
        const tops: number[] = [];
        const bottoms: number[] = [];
        let top = 0;
        let bottom = 0;

        for (const i of byPeak) {
            if (top < bottom) {
                top += sums[i]!;
                tops.push(i);
            } else {
                bottom += sums[i]!;
                bottoms.push(i);
            }
        }

        return bottoms.reverse().concat(tops);
    }

    public layout(data: StreamData): StreamResult {
        const x = data.x;
        const n = x.length;
        const step = StreamLayout.medianStep(x);
        const bandwidth = Math.max(0, this.options.bandwidth ?? step * 1.2);
        const taper = (this.options.taper ?? true) && bandwidth > 0;
        const pad = taper ? bandwidth * 3 : 0;
        const x0 = n > 0 ? x[0]! - pad : 0;
        const x1 = n > 0 ? x[n - 1]! + pad : 1;
        const samples = Math.max(2, Math.min(1200, Math.round(((x1 - x0) / step) * (this.options.resolution ?? 4)) + 1));
        const xs = new Float64Array(samples);
        const hidden = this.options.hidden ?? new Set<string>();

        for (let s = 0; s < samples; s++) {
            xs[s] = x0 + ((x1 - x0) * s / (samples - 1));
        }

        // smoothed values per panel and layer (hidden layers = 0, so shapes morph instead of jump)
        const smoothed = data.panels.map((panel) => data.layers.map((layer, li) => hidden.has(layer.id)
            ? new Float64Array(samples)
            : StreamLayout.smooth(x, panel.values[li] ?? [], xs, bandwidth)));

        // one order for all panels, from the layers' totals over every panel
        const totals = data.layers.map((_, li) => {
            const t = new Float64Array(samples);
            for (const p of smoothed) {
                const v = p[li]!;
                for (let s = 0; s < samples; s++) {
                    t[s] = t[s]! + v[s]!;
                }
            }
            return t;
        });
        const given = data.layers.map((_, i) => i);
        const order = this.options.order === 'insideOut' ? StreamLayout.insideOut(totals)
            : this.options.order === 'reverse' ? given.reverse() : given;

        const panels = smoothed.map((values) => StreamLayout.stack(values, order, xs, this.options.offset ?? 'silhouette'));

        return {xs, order, panels, domain: {min: x0, max: x1}};
    }

    /** Stack `values` (layer → samples) in `order` and apply the offset. */
    public static stack(values: Float64Array[], order: readonly number[], xs: ArrayLike<number>, offset: StreamOffset): StreamPanelResult {
        const m = xs.length;
        const L = values.length;
        const lower = values.map(() => new Float64Array(m));
        const upper = values.map(() => new Float64Array(m));
        const base = new Float64Array(m);
        const total = new Float64Array(m);

        for (let s = 0; s < m; s++) {
            for (let k = 0; k < L; k++) {
                total[s] = total[s]! + values[k]![s]!;
            }
        }

        if (offset === 'silhouette') {
            for (let s = 0; s < m; s++) {
                base[s] = -total[s]! / 2;
            }
        } else if (offset === 'wiggle' && L > 0) {
            // d3.stackOffsetWiggle: g₀' = −Σᵢ (Σ_{j<i} f_j' + f_i'/2) f_i / Σ f
            let y = 0;

            for (let s = 1; s < m; s++) {
                let s1 = 0;
                let s2 = 0;

                for (let k = 0; k < L; k++) {
                    const li = order[k]!;
                    const fi = values[li]![s]!;
                    const dfi = fi - values[li]![s - 1]!;
                    let below = 0;

                    for (let j = 0; j < k; j++) {
                        const lj = order[j]!;
                        below += values[lj]![s]! - values[lj]![s - 1]!;
                    }
                    s1 += fi;
                    s2 += (below + (dfi / 2)) * fi;
                }
                if (s1 > 0) {
                    y -= s2 / s1;
                }
                base[s] = y;
            }
            // re-centre: the mean midline at 0
            let mid = 0;
            for (let s = 0; s < m; s++) {
                mid += base[s]! + (total[s]! / 2);
            }
            mid /= m;
            for (let s = 0; s < m; s++) {
                base[s] = base[s]! - mid;
            }
        }

        let min = Infinity;
        let max = -Infinity;

        for (let s = 0; s < m; s++) {
            const scale = offset === 'expand' ? (total[s]! > 0 ? 1 / total[s]! : 0) : 1;
            let y = base[s]!;

            for (const li of order) {
                lower[li]![s] = y;
                y += values[li]![s]! * scale;
                upper[li]![s] = y;
            }
            min = Math.min(min, base[s]!);
            max = Math.max(max, y);
        }

        if (!Number.isFinite(min)) {
            min = 0;
            max = 1;
        }
        if (offset === 'expand') {
            min = 0;
            max = 1;
        }
        if (max - min < 1e-9) {
            max = min + 1;
        }

        return {lower, upper, value: values, min, max};
    }

    /** Fractional sample index of x (clamped). */
    public static sampleAt(xs: ArrayLike<number>, x: number): number {
        const m = xs.length;

        if (m < 2) {
            return 0;
        }

        const t = (x - xs[0]!) / (xs[m - 1]! - xs[0]!);

        return Math.max(0, Math.min(m - 1, t * (m - 1)));
    }

    /** Interpolated value of an edge array at a fractional sample index. */
    public static at(a: ArrayLike<number>, f: number): number {
        const i = Math.floor(f);
        const t = f - i;

        return ((a[i] ?? 0) * (1 - t)) + ((a[Math.min(a.length - 1, i + 1)] ?? 0) * t);
    }

    /** Layer (index) whose band contains y at x, or -1. Zero-thickness bands never hit. */
    public static layerAt(result: StreamResult, panel: number, x: number, y: number): number {
        const p = result.panels[panel];

        if (p === undefined) {
            return -1;
        }

        const f = StreamLayout.sampleAt(result.xs, x);

        for (const li of result.order) {
            const lo = StreamLayout.at(p.lower[li]!, f);
            const hi = StreamLayout.at(p.upper[li]!, f);

            if (hi - lo > 1e-9 && y >= lo && y <= hi) {
                return li;
            }
        }

        return -1;
    }

    /** Index of the data x nearest to `x`. */
    public static nearest(x: ArrayLike<number>, at: number): number {
        let best = 0;

        for (let i = 1; i < x.length; i++) {
            if (Math.abs(x[i]! - at) < Math.abs(x[best]! - at)) {
                best = i;
            }
        }

        return best;
    }

}
