/** One counted thing of a unit histogram (a candidate, a ship, a match …). */
export interface Unit {
    value: number;
    /** Category id (stack order and colour); default the first category. */
    category?: string;
    /** Panel id (default the first panel). */
    panel?: string;
    id?: string;
    label?: string;
}

/** A category of units, stacked bottom → top in the given order. */
export interface UnitCategory {
    id: string;
    label: string;
    /** Default colour (a panel may override it). */
    color?: string;
}

/** One panel of stacked units; all panels share the x and the count scale. */
export interface UnitPanel {
    id: string;
    label?: string;
    /** Colour per category id in this panel (e.g. blue tones here, red ones there). */
    colors?: Record<string, string>;
}

/** A unit placed in its bin. */
export interface UnitCell {
    /** Index into the units array. */
    unit: number;
    panel: number;
    category: number;
    /** Bin index; the bin covers [origin + bin·width, origin + (bin+1)·width). */
    bin: number;
    /** Position in the bin's stack, 0 = bottom. */
    stack: number;
}

export interface UnitResult {
    cells: UnitCell[];
    /** Highest stack of any bin in any panel. */
    maxStack: number;
    /** Lowest / highest bin index with units. */
    minBin: number;
    maxBin: number;
}

/**
 * Pure part of `UnitHistogram`: puts every unit into its bin and gives it a
 * stack position — bins are stacked by category order first, then by value,
 * so a column reads "won" below "lost" like a stacked bar made of units.
 */
export class UnitLayout {

    public static binOf(value: number, width: number, origin = 0): number {
        return Math.floor((value - origin) / width + 1e-9);
    }

    public static place(units: readonly Unit[], options: {binWidth: number; origin?: number; categories: readonly UnitCategory[];
        panels: readonly UnitPanel[]}): UnitResult {
        const origin = options.origin ?? 0;
        const width = options.binWidth > 0 ? options.binWidth : 1;
        const catIndex = new Map(options.categories.map((c, i) => [c.id, i]));
        const panelIndex = new Map(options.panels.map((p, i) => [p.id, i]));
        const groups = new Map<string, number[]>();

        units.forEach((u, i) => {
            if (!Number.isFinite(u.value)) {
                return;
            }

            const p = u.panel === undefined ? 0 : panelIndex.get(u.panel) ?? -1;

            if (p < 0) {
                return;
            }

            const key = `${p}\u0000${UnitLayout.binOf(u.value, width, origin)}`;
            const list = groups.get(key);

            if (list === undefined) {
                groups.set(key, [i]);
            } else {
                list.push(i);
            }
        });

        const cells: UnitCell[] = [];
        let maxStack = 0;
        let minBin = Infinity;
        let maxBin = -Infinity;
        const cat = (u: Unit): number => u.category === undefined ? 0 : catIndex.get(u.category) ?? options.categories.length;

        for (const [key, list] of groups) {
            const [ps, bs] = key.split('\u0000');
            const panel = Number(ps);
            const bin = Number(bs);

            list.sort((a, b) => cat(units[a]!) - cat(units[b]!) || units[a]!.value - units[b]!.value || a - b);
            list.forEach((ui, stack) => {
                cells.push({unit: ui, panel, category: cat(units[ui]!), bin, stack});
            });
            maxStack = Math.max(maxStack, list.length);
            minBin = Math.min(minBin, bin);
            maxBin = Math.max(maxBin, bin);
        }

        return {cells, maxStack, minBin: Number.isFinite(minBin) ? minBin : 0, maxBin: Number.isFinite(maxBin) ? maxBin : 0};
    }

}
