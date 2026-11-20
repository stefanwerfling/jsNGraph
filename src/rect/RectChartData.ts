/**
 * Pure geometry for the data mode of the rect-kit charts: scales, bar
 * rectangles and line points from real values. No DOM, so the maths is
 * unit-testable; BarStrip / Sparkline / Timeline turn the result into SVG.
 */

export interface BarRect {
    index: number;
    x: number;
    y: number;
    width: number;
    height: number;
    value: number;
}

export interface LinePoint {
    x: number;
    y: number;
    /** The data point this came from. */
    dx: number;
    dy: number;
}

export interface Domain {
    min: number;
    max: number;
}

export class RectChartData {

    /** Min/max over finite numbers, widened so that min < max. */
    public static domain(values: ReadonlyArray<number>, fixed: Partial<Domain> = {}): Domain {
        const finite = values.filter((v) => Number.isFinite(v));
        let min = fixed.min ?? (finite.length > 0 ? Math.min(...finite) : 0);
        let max = fixed.max ?? (finite.length > 0 ? Math.max(...finite) : 1);

        if (min === max) {
            // A flat series: centre it instead of dividing by zero.
            min -= 1;
            max += 1;
        }

        return {min, max};
    }

    /**
     * Vertical bars along the width, bottom-aligned, height proportional to
     * |value| / max (bars never go below 1 px for a non-zero value, so a
     * tiny value stays visible next to a big one).
     */
    public static bars(values: ReadonlyArray<number>, width: number, height: number, gap: number, max?: number): BarRect[] {
        const count = values.length;

        if (count === 0) {
            return [];
        }

        const top = max ?? Math.max(...values.map((v) => Math.abs(v)), 0);
        const slot = width / count;
        const barWidth = Math.max(1, slot - gap);

        return values.map((value, index) => {
            const ratio = top > 0 ? Math.min(1, Math.abs(value) / top) : 0;
            const h = value === 0 ? 0 : Math.max(1, ratio * height);

            return {index, x: index * slot + (slot - barWidth) / 2, y: height - h, width: barWidth, height: h, value};
        });
    }

    /**
     * Points of every series in one shared x/y space. `x` defaults to the
     * index; y grows upward; `pad` keeps dots off the edges.
     */
    public static lines(
        series: ReadonlyArray<ReadonlyArray<{x?: number; y: number}>>,
        width: number,
        height: number,
        pad: number,
        fixedY: Partial<Domain> = {}
    ): LinePoint[][] {
        const withX = series.map((points) => points.map((p, i) => ({x: p.x ?? i, y: p.y})));
        const all = withX.flat();

        if (all.length === 0) {
            return withX.map(() => []);
        }

        const xs = RectChartData.domain(all.map((p) => p.x));
        const ys = RectChartData.domain(all.map((p) => p.y), fixedY);
        const singleX = all.every((p) => p.x === all[0]?.x);
        const sx = (x: number): number => singleX ? width / 2 : pad + ((x - xs.min) / (xs.max - xs.min)) * (width - 2 * pad);
        const sy = (y: number): number => height - pad - ((y - ys.min) / (ys.max - ys.min)) * (height - 2 * pad);

        return withX.map((points) => points.map((p) => ({x: sx(p.x), y: sy(p.y), dx: p.x, dy: p.y})));
    }

    /** 0..1 intensity of each value against the largest one (Timeline cells). */
    public static intensities(values: ReadonlyArray<number>, max?: number): number[] {
        const top = max ?? Math.max(...values.map((v) => Math.abs(v)), 0);

        return values.map((v) => (top > 0 ? Math.min(1, Math.abs(v) / top) : 0));
    }

}
