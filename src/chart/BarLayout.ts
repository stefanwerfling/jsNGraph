import { ChartRange, ChartRect, ChartScale } from './ChartScale';

/** One series of bars: a value per category. */
export interface BarSeries {
    id?: string;
    name?: string;
    /** Any CSS colour (default: the palette). */
    color?: string;
    values: number[];
}

/** One panel of a small-multiple bar chart. */
export interface BarPanel {
    id?: string;
    title?: string;
    series: BarSeries[];
}

/** A placed bar in chart pixels. */
export interface PlacedBar {
    panel: number;
    series: number;
    category: number;
    value: number;
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Pure maths of `BarChart`: the shared value range of all panels (0 always
 * included, rounded up to a nice tick), and bar rectangles for grouped or
 * stacked bars inside a panel rect. No DOM.
 */
export class BarLayout {

    /** Range of all panels; stacked sums positives and negatives separately. */
    public static range(panels: readonly BarPanel[], mode: 'grouped' | 'stacked', categories: number, maxTicks = 5): ChartRange {
        let min = 0;
        let max = 0;

        for (const p of panels) {
            for (let c = 0; c < categories; c++) {
                let pos = 0;
                let neg = 0;

                for (const s of p.series) {
                    const v = s.values[c] ?? 0;

                    if (!Number.isFinite(v)) {
                        continue;
                    }
                    if (mode === 'stacked') {
                        if (v >= 0) {
                            pos += v;
                        } else {
                            neg += v;
                        }
                    } else {
                        pos = Math.max(pos, v);
                        neg = Math.min(neg, v);
                    }
                }
                max = Math.max(max, pos);
                min = Math.min(min, neg);
            }
        }

        if (max === min) {
            max = 1;
        }

        const step = ChartScale.niceStep(max - min, maxTicks);

        return {min: min < 0 ? Math.floor(min / step) * step : 0, max: max > 0 ? Math.ceil(max / step) * step : 0};
    }

    /** Category band: left edge and width of category `c` of `n` in `rect`. */
    public static band(rect: ChartRect, n: number, c: number): {x: number; w: number} {
        const w = rect.w / Math.max(1, n);

        return {x: rect.x + c * w, w};
    }

    /**
     * Bars of one panel. `fraction` is the share of a band the bars of one
     * category fill (the rest is the gap between categories).
     */
    public static bars(panel: BarPanel, panelIndex: number, categories: number, rect: ChartRect, range: ChartRange,
        mode: 'grouped' | 'stacked', fraction = 0.8): PlacedBar[] {
        const out: PlacedBar[] = [];
        const ys = (v: number): number => ChartScale.toPx(v, range, rect.y + rect.h, rect.y);
        const zero = ys(0);
        const groups = mode === 'grouped' ? Math.max(1, panel.series.length) : 1;
        const inner = 1;

        for (let c = 0; c < categories; c++) {
            const band = BarLayout.band(rect, categories, c);
            const full = band.w * fraction;
            const x0 = band.x + (band.w - full) / 2;
            const w = (full - inner * (groups - 1)) / groups;
            let pos = 0;
            let neg = 0;

            panel.series.forEach((s, si) => {
                const v = s.values[c] ?? 0;

                if (!Number.isFinite(v)) {
                    return;
                }

                let a: number;
                let b: number;
                let x: number;

                if (mode === 'stacked') {
                    const base = v >= 0 ? pos : neg;

                    a = ys(base);
                    b = ys(base + v);
                    if (v >= 0) {
                        pos += v;
                    } else {
                        neg += v;
                    }
                    x = x0;
                } else {
                    a = zero;
                    b = ys(v);
                    x = x0 + si * (w + inner);
                }

                out.push({
                    panel: panelIndex, series: si, category: c, value: v,
                    x, y: Math.min(a, b), w: Math.max(0.5, w), h: Math.abs(b - a)
                });
            });
        }

        return out;
    }

    /** The bar under a point (a thin bar is hit within 3 px); null when none. */
    public static hit(bars: readonly PlacedBar[], px: number, py: number): PlacedBar | null {
        for (let i = bars.length - 1; i >= 0; i--) {
            const b = bars[i]!;
            const pad = b.h < 3 ? 3 : 0;

            if (px >= b.x && px <= b.x + b.w && py >= b.y - pad && py <= b.y + b.h + pad) {
                return b;
            }
        }

        return null;
    }

}
