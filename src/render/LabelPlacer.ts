/** Screen-space rectangle of a label. */
export interface LabelBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Greedy label collision avoidance in screen space: labels are offered in
 * priority order and each is accepted only if it does not overlap one
 * already accepted. A uniform grid of buckets keeps each test to the few
 * labels nearby, so a frame with thousands of candidates stays linear.
 */
export class LabelPlacer {

    private readonly buckets = new Map<number, LabelBox[]>();

    public constructor(private readonly cell = 64, private readonly margin = 2) {
    }

    public reset(): void {
        this.buckets.clear();
    }

    /** Accept the box when it is free (and reserve it); false = would overlap. */
    public tryPlace(box: LabelBox): boolean {
        const m = this.margin;
        const x0 = Math.floor((box.x - m) / this.cell);
        const x1 = Math.floor((box.x + box.w + m) / this.cell);
        const y0 = Math.floor((box.y - m) / this.cell);
        const y1 = Math.floor((box.y + box.h + m) / this.cell);

        for (let cx = x0; cx <= x1; cx++) {
            for (let cy = y0; cy <= y1; cy++) {
                for (const other of this.buckets.get(LabelPlacer.key(cx, cy)) ?? []) {
                    if (box.x - m < other.x + other.w && box.x + box.w + m > other.x
                        && box.y - m < other.y + other.h && box.y + box.h + m > other.y) {
                        return false;
                    }
                }
            }
        }

        for (let cx = x0; cx <= x1; cx++) {
            for (let cy = y0; cy <= y1; cy++) {
                const key = LabelPlacer.key(cx, cy);
                const bucket = this.buckets.get(key);

                if (bucket === undefined) {
                    this.buckets.set(key, [box]);
                } else {
                    bucket.push(box);
                }
            }
        }

        return true;
    }

    /** Cell coordinates packed into one number (screens stay far below 2^20 cells). */
    private static key(cx: number, cy: number): number {
        return (cx + 0x80000) * 0x100000 + (cy + 0x80000);
    }

}
