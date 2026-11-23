/** One day cell of a month grid. */
export interface CalendarCell {
    date: Date;
    row: number;
    /** Column 0…6, counted from the week start. */
    col: number;
    /** Weekday 0 (Sunday) … 6. */
    weekday: number;
    inMonth: boolean;
}

/** A stretch of a selected range on one grid row. */
export interface CalendarRun {
    row: number;
    from: number;
    to: number;
    /** The range really starts / ends here (round cap), rather than wrapping to another row. */
    startCap: boolean;
    endCap: boolean;
}

/** Pure date-grid maths of `MonthCalendar` (local time, no DOM). */
export class CalendarGeometry {

    /** Midnight of the given day. */
    public static day(d: Date): Date {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    /** Whole days from a to b (DST-safe). */
    public static daysBetween(a: Date, b: Date): number {
        const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
        const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());

        return Math.round((ub - ua) / 86400000);
    }

    public static sameDay(a: Date, b: Date): boolean {
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    /**
     * The grid of `month` (0-based): whole weeks from the week containing the
     * 1st to the week containing the last day; 4–6 rows.
     */
    public static grid(year: number, month: number, weekStart = 1): CalendarCell[] {
        const first = new Date(year, month, 1);
        const lead = (first.getDay() - weekStart + 7) % 7;
        const days = new Date(year, month + 1, 0).getDate();
        const rows = Math.ceil((lead + days) / 7);
        const cells: CalendarCell[] = [];

        for (let i = 0; i < rows * 7; i++) {
            const date = new Date(year, month, 1 - lead + i);

            cells.push({
                date,
                row: Math.floor(i / 7),
                col: i % 7,
                weekday: date.getDay(),
                inMonth: date.getMonth() === month
            });
        }

        return cells;
    }

    /** Weekdays in column order, 0 = Sunday. */
    public static weekdays(weekStart = 1): number[] {
        return Array.from({length: 7}, (_, i) => (weekStart + i) % 7);
    }

    /**
     * The parts of the range start…end (either order, inclusive) that fall
     * into `cells`, one run per grid row.
     */
    public static runs(cells: readonly CalendarCell[], start: Date, end: Date): CalendarRun[] {
        const [a, b] = CalendarGeometry.daysBetween(start, end) >= 0 ? [start, end] : [end, start];
        const runs: CalendarRun[] = [];

        for (const cell of cells) {
            const fromStart = CalendarGeometry.daysBetween(a, cell.date);
            const toEnd = CalendarGeometry.daysBetween(cell.date, b);

            if (fromStart < 0 || toEnd < 0) {
                continue;
            }

            const last = runs[runs.length - 1];

            if (last !== undefined && last.row === cell.row && last.to === cell.col - 1) {
                last.to = cell.col;
                last.endCap = toEnd === 0;
            } else {
                runs.push({row: cell.row, from: cell.col, to: cell.col, startCap: fromStart === 0, endCap: toEnd === 0});
            }
        }

        return runs;
    }

    /** Year and month shifted by `delta` months. */
    public static shift(year: number, month: number, delta: number): {year: number; month: number} {
        const d = new Date(year, month + delta, 1);

        return {year: d.getFullYear(), month: d.getMonth()};
    }

}
