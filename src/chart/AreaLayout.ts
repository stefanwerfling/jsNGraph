import { ChartRange } from './ChartScale';

/** How the series of an area chart pile up. */
export type AreaStack = 'none' | 'zero' | 'expand';

export interface AreaBand {
    lower: number[];
    upper: number[];
}

/**
 * Pure part of `AreaChart`: lower/upper edge per series and point. 'none'
 * draws every series from 0 (overlapping), 'zero' stacks them, 'expand'
 * stacks shares of the total (0 … 1). Missing or negative values count as 0
 * when stacking.
 */
export class AreaLayout {

    public static stack(values: readonly (readonly number[])[], n: number, mode: AreaStack): AreaBand[] {
        const bands: AreaBand[] = values.map(() => ({lower: new Array<number>(n).fill(0), upper: new Array<number>(n).fill(0)}));

        for (let i = 0; i < n; i++) {
            let total = 0;

            if (mode === 'expand') {
                for (const v of values) {
                    total += AreaLayout.clean(v[i]);
                }
            }

            let base = 0;

            values.forEach((v, s) => {
                const band = bands[s]!;
                const raw = v[i];

                if (mode === 'none') {
                    band.upper[i] = Number.isFinite(raw) ? raw! : 0;
                    return;
                }

                const value = mode === 'expand' ? (total > 0 ? AreaLayout.clean(raw) / total : 0) : AreaLayout.clean(raw);

                band.lower[i] = base;
                base += value;
                band.upper[i] = base;
            });
        }

        return bands;
    }

    /** Value range covered by the bands (0 included). */
    public static range(bands: readonly AreaBand[]): ChartRange {
        let min = 0;
        let max = 0;

        for (const b of bands) {
            for (const v of b.upper) {
                min = Math.min(min, v);
                max = Math.max(max, v);
            }
        }

        return {min, max: max > min ? max : min + 1};
    }

    private static clean(v: number | undefined): number {
        return v !== undefined && Number.isFinite(v) && v > 0 ? v : 0;
    }

}
