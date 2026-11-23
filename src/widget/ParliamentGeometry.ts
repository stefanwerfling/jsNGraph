/** A seat of a hemicycle in unit coordinates (outer radius 1, centre 0,0, y up). */
export interface Seat {
    x: number;
    y: number;
    /** Angle in radians, π = far left, 0 = far right. */
    angle: number;
    row: number;
}

/**
 * Pure maths of `ParliamentChart`: seats on concentric half rings, as many
 * rows as needed so neighbouring seats keep the same spacing in every row,
 * then ordered left → right by angle so parties fill wedges.
 */
export class ParliamentGeometry {

    /** Seats per row for `rows` rows between `inner` and 1 (capacity at the row spacing). */
    public static capacity(rows: number, inner: number): number[] {
        const radii = ParliamentGeometry.radii(rows, inner);
        const spacing = rows > 1 ? (1 - inner) / (rows - 1) : (1 - inner);

        return radii.map((r) => Math.floor(Math.PI * r / spacing) + 1);
    }

    public static radii(rows: number, inner: number): number[] {
        return Array.from({length: rows}, (_, i) => rows > 1 ? inner + (1 - inner) * i / (rows - 1) : 1);
    }

    /** Fewest rows that hold `total` seats. */
    public static rowsFor(total: number, inner: number): number {
        let rows = 1;

        while (rows < 60 && ParliamentGeometry.capacity(rows, inner).reduce((a, b) => a + b, 0) < total) {
            rows++;
        }

        return rows;
    }

    /**
     * `total` seats in hemicycle order (left → right; at equal angles the inner
     * row first) and the seat radius in unit coordinates.
     */
    public static seats(total: number, options: {rows?: number; inner?: number} = {}): {seats: Seat[]; radius: number; rows: number} {
        const inner = Math.max(0.05, Math.min(0.9, options.inner ?? 0.4));

        if (total <= 0) {
            return {seats: [], radius: 0, rows: 0};
        }

        const rows = Math.max(1, options.rows ?? ParliamentGeometry.rowsFor(total, inner));
        const radii = ParliamentGeometry.radii(rows, inner);
        const cap = ParliamentGeometry.capacity(rows, inner);
        const sumR = radii.reduce((a, b) => a + b, 0);
        // seats per row ∝ radius, largest remainder, never above a row's capacity
        const exact = radii.map((r) => total * r / sumR);
        const counts = exact.map((e, i) => Math.min(cap[i]!, Math.floor(e)));
        let left = total - counts.reduce((a, b) => a + b, 0);
        const order = exact.map((e, i) => ({i, rest: e - Math.floor(e)})).sort((a, b) => b.rest - a.rest || b.i - a.i);

        while (left > 0) {
            let placed = false;

            for (const {i} of order) {
                if (left > 0 && counts[i]! < cap[i]!) {
                    counts[i]!++;
                    left--;
                    placed = true;
                }
            }
            if (!placed) {
                // every row full at its spacing: squeeze the rest into the outer row
                counts[rows - 1]! += left;
                left = 0;
            }
        }

        const seats: Seat[] = [];

        counts.forEach((n, row) => {
            const r = radii[row]!;

            for (let j = 0; j < n; j++) {
                const angle = n === 1 ? Math.PI / 2 : Math.PI * (1 - j / (n - 1));
                seats.push({x: r * Math.cos(angle), y: r * Math.sin(angle), angle, row});
            }
        });
        seats.sort((a, b) => b.angle - a.angle || a.row - b.row);

        const spacing = rows > 1 ? (1 - inner) / (rows - 1) : Math.PI / Math.max(1, total);
        const arcGap = Math.min(...counts.map((n, i) => n > 1 ? Math.PI * radii[i]! / (n - 1) : Infinity));

        return {seats, radius: Math.min(spacing, arcGap) * 0.42, rows};
    }

    /** Party index per seat for the counts (in seat order), -1 for unfilled seats. */
    public static assign(counts: readonly number[], total: number): number[] {
        const out: number[] = [];

        counts.forEach((n, p) => {
            for (let i = 0; i < n && out.length < total; i++) {
                out.push(p);
            }
        });
        while (out.length < total) {
            out.push(-1);
        }

        return out;
    }

}
