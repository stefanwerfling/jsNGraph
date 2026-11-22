import { ChartRange, ChartRect, ChartScale } from './ChartScale';

/** One trace of a waterfall: y values, with x values or (without) the index as x. Sorted by x. */
export interface ChartSeriesData {
    x?: ArrayLike<number>;
    y: ArrayLike<number>;
}

/**
 * Where the traces sit: the front one (index 0) fills `plot`; trace `i` is
 * the same plot moved by `i · step` — right and up, so the stack recedes
 * into the back-right corner.
 */
export interface WaterfallLayout {
    plot: ChartRect;
    stepX: number;
    stepY: number;
}

/**
 * Pure geometry of the waterfall chart: stack layout, data → pixel per
 * trace, nearest index and the trace under the pointer. No DOM.
 */
export class WaterfallGeometry {

    /**
     * Split `area` into the front plot and the per-trace step: the back-most
     * trace is shifted by `depthX` of the width and `depthY` of the height.
     */
    public static layout(area: ChartRect, count: number, depthX: number, depthY: number): WaterfallLayout {
        const dx = area.w * depthX;
        const dy = area.h * depthY;
        const steps = Math.max(1, count - 1);

        return {
            plot: {x: area.x, y: area.y + dy, w: area.w - dx, h: area.h - dy},
            stepX: count > 1 ? dx / steps : 0,
            stepY: count > 1 ? -dy / steps : 0
        };
    }

    public static xAt(series: ChartSeriesData, i: number): number {
        return series.x !== undefined ? series.x[i] ?? i : i;
    }

    /** Index whose x is nearest to `x` (binary search; x ascending). -1 for an empty trace. */
    public static nearestIndex(series: ChartSeriesData, x: number): number {
        const n = series.y.length;

        if (n === 0) {
            return -1;
        }

        let lo = 0;
        let hi = n - 1;

        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;

            if (WaterfallGeometry.xAt(series, mid) <= x) {
                lo = mid;
            } else {
                hi = mid;
            }
        }

        return Math.abs(WaterfallGeometry.xAt(series, hi) - x) < Math.abs(WaterfallGeometry.xAt(series, lo) - x) ? hi : lo;
    }

    /** Pixel position of one data point of trace `s`. */
    public static point(layout: WaterfallLayout, s: number, x: number, y: number, xRange: ChartRange, yRange: ChartRange): {x: number; y: number} {
        const {plot} = layout;

        return {
            x: ChartScale.toPx(x, xRange, plot.x, plot.x + plot.w) + s * layout.stepX,
            y: ChartScale.toPx(y, yRange, plot.y + plot.h, plot.y) + s * layout.stepY
        };
    }

    /** Trace `s`'s y (linearly interpolated) at data x, or null outside its data. */
    public static valueAt(series: ChartSeriesData, x: number): number | null {
        const n = series.y.length;

        if (n === 0 || x < WaterfallGeometry.xAt(series, 0) || x > WaterfallGeometry.xAt(series, n - 1)) {
            return null;
        }

        let i = WaterfallGeometry.nearestIndex(series, x);

        if (WaterfallGeometry.xAt(series, i) > x) {
            i--;
        }
        if (i >= n - 1) {
            return series.y[n - 1] ?? null;
        }

        const x0 = WaterfallGeometry.xAt(series, i);
        const x1 = WaterfallGeometry.xAt(series, i + 1);
        const y0 = series.y[i] ?? 0;
        const y1 = series.y[i + 1] ?? 0;

        return x1 === x0 ? y0 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }

    /**
     * The trace whose line passes closest to the pointer (distance to its
     * segments around the pointer's x), within `radius` px; front traces win
     * ties. null when none is near.
     */
    public static hit(layout: WaterfallLayout, series: ReadonlyArray<ChartSeriesData>, px: number, py: number,
        xRange: ChartRange, yRange: ChartRange, radius = 6): number | null {
        const {plot} = layout;
        let best: number | null = null;
        let bestDist = radius;

        for (let s = 0; s < series.length; s++) {
            const data = series[s]!;
            const localX = px - s * layout.stepX;
            const n = data.y.length;

            if (n === 0 || localX < plot.x - radius || localX > plot.x + plot.w + radius) {
                continue;
            }

            // Segments within `radius` px of the pointer's x, in data units.
            const x0 = ChartScale.fromPx(localX - radius, xRange, plot.x, plot.x + plot.w);
            const x1 = ChartScale.fromPx(localX + radius, xRange, plot.x, plot.x + plot.w);
            const from = Math.max(0, WaterfallGeometry.nearestIndex(data, x0) - 1);
            const to = Math.min(n - 1, WaterfallGeometry.nearestIndex(data, x1) + 1);
            let prev = WaterfallGeometry.point(layout, s, WaterfallGeometry.xAt(data, from), data.y[from] ?? 0, xRange, yRange);

            for (let i = from + 1; i <= to; i++) {
                const next = WaterfallGeometry.point(layout, s, WaterfallGeometry.xAt(data, i), data.y[i] ?? 0, xRange, yRange);
                const dist = WaterfallGeometry.segmentDistance(px, py, prev, next);

                if (dist < bestDist) {
                    bestDist = dist;
                    best = s;
                }
                prev = next;
            }
        }

        return best;
    }

    private static segmentDistance(px: number, py: number, a: {x: number; y: number}, b: {x: number; y: number}): number {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = dx * dx + dy * dy;
        const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len));

        return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
    }

}
