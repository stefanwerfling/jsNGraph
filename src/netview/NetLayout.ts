import { NetModel } from './NetTypes';

export interface NetRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface NetLayoutOptions {
    /** Residual bins per block column. Default 48. */
    bins?: number;
    /** Horizontal distance between block columns. Default 58. */
    spacing?: number;
}

/** What a world point hits (see `NetLayout.hit`). */
export type NetHit =
    | {kind: 'bin'; block: number; index: number}
    | {kind: 'head'; block: number; index: number}
    | {kind: 'expert'; block: number; index: number}
    | {kind: 'block'; block: number}
    | {kind: 'input'; index: number}
    | {kind: 'output'; index: number};

const CELL = 9;
const GAP = 1;
const COL_W = 40;
const HEAD_COLS = 4;
const EXPERT_COLS = 8;
const EXPERT_CELL = 5;
const SECTION = 14;
const IO_W = 96;
const IO_ROW = 16;

/**
 * Pure world geometry of a NetView: one column per block with the residual
 * bins on top, attention heads and MoE experts below, lens label and the
 * measurement strip under it; the prompt tokens left, the prediction right.
 */
export class NetLayout {

    public readonly bins: number;
    public readonly spacing: number;
    public readonly headRows: number;
    public readonly expertRows: number;
    /** Top of each section (world y). */
    public readonly binTop = 0;
    public readonly headTop: number;
    public readonly expertTop: number;
    public readonly lensTop: number;
    public readonly chartTop: number;
    public readonly chartHeight = 70;
    public readonly firstX: number;
    public readonly ioRows: number;

    public constructor(public readonly model: NetModel, options: NetLayoutOptions = {}, ioRows = 0) {
        this.bins = Math.max(4, Math.floor(options.bins ?? 48));
        this.spacing = Math.max(COL_W + 6, options.spacing ?? 58);
        this.headRows = Math.ceil(Math.max(0, model.heads) / HEAD_COLS);
        this.expertRows = Math.ceil(Math.max(0, model.experts ?? 0) / EXPERT_COLS);
        this.headTop = this.bins * (CELL + GAP) + SECTION;
        this.expertTop = this.headTop + this.headRows * (CELL + GAP) + (this.headRows > 0 ? SECTION : 0);
        this.lensTop = this.expertTop + this.expertRows * EXPERT_CELL + (this.expertRows > 0 ? SECTION : 0);
        this.chartTop = this.lensTop + 34;
        this.firstX = IO_W + 70;
        this.ioRows = ioRows;
    }

    public static readonly COL_W = COL_W;
    public static readonly IO_W = IO_W;

    public columnX(block: number): number {
        return this.firstX + block * this.spacing;
    }

    /** Left edge of the output column. */
    public get outputX(): number {
        return this.columnX(Math.max(0, this.model.blocks - 1)) + COL_W + 70;
    }

    public binRect(block: number, index: number): NetRect {
        return {x: this.columnX(block), y: this.binTop + index * (CELL + GAP), w: COL_W, h: CELL};
    }

    /** Centre of a bin's left (side 'in') or right (side 'out') edge — where path curves attach. */
    public binPort(block: number, index: number, side: 'in' | 'out'): {x: number; y: number} {
        const r = this.binRect(block, index);

        return {x: side === 'in' ? r.x : r.x + r.w, y: r.y + r.h / 2};
    }

    public headRect(block: number, head: number): NetRect {
        const w = (COL_W - (HEAD_COLS - 1) * GAP) / HEAD_COLS;

        return {
            x: this.columnX(block) + (head % HEAD_COLS) * (w + GAP),
            y: this.headTop + Math.floor(head / HEAD_COLS) * (CELL + GAP),
            w,
            h: CELL
        };
    }

    public expertRect(block: number, expert: number): NetRect {
        return {
            x: this.columnX(block) + (expert % EXPERT_COLS) * EXPERT_CELL,
            y: this.expertTop + Math.floor(expert / EXPERT_COLS) * EXPERT_CELL,
            w: EXPERT_CELL - 1,
            h: EXPERT_CELL - 1
        };
    }

    /** The whole block column, bins to lens label. */
    public columnRect(block: number): NetRect {
        return {x: this.columnX(block), y: this.binTop, w: COL_W, h: this.lensTop + 26};
    }

    /** Prompt token row (input column, centred vertically on the bins). */
    public inputRect(index: number): NetRect {
        return {x: 0, y: this.ioTop(this.ioRows) + index * IO_ROW, w: IO_W, h: IO_ROW - 2};
    }

    /** Prediction row (output column). */
    public outputRect(index: number, rows: number): NetRect {
        return {x: this.outputX, y: this.ioTop(rows) + index * IO_ROW, w: IO_W + 30, h: IO_ROW - 2};
    }

    /** Points of the measurement strip are at x = column centre, y in [chartTop, chartTop + chartHeight]. */
    public chartY(value: number, max: number): number {
        const v = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;

        return this.chartTop + this.chartHeight - v * this.chartHeight;
    }

    public bounds(): {minX: number; minY: number; maxX: number; maxY: number} {
        return {minX: -8, minY: -28, maxX: this.outputX + IO_W + 40, maxY: this.chartTop + this.chartHeight + 24};
    }

    /** What the world point (x, y) hits, most specific first; null = nothing. */
    public hit(x: number, y: number, outputRows = 0): NetHit | null {
        const inside = (r: NetRect): boolean => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

        for (let i = 0; i < this.ioRows; i++) {
            if (inside(this.inputRect(i))) {
                return {kind: 'input', index: i};
            }
        }
        for (let i = 0; i < outputRows; i++) {
            if (inside(this.outputRect(i, outputRows))) {
                return {kind: 'output', index: i};
            }
        }

        const block = Math.floor((x - this.firstX) / this.spacing);

        if (block < 0 || block >= this.model.blocks || x - this.columnX(block) > COL_W) {
            return null;
        }

        const dx = x - this.columnX(block);

        if (y >= this.binTop && y < this.binTop + this.bins * (CELL + GAP)) {
            return {kind: 'bin', block, index: Math.floor((y - this.binTop) / (CELL + GAP))};
        }
        if (y >= this.headTop && y < this.headTop + this.headRows * (CELL + GAP)) {
            const w = (COL_W - (HEAD_COLS - 1) * GAP) / HEAD_COLS;
            const index = Math.floor((y - this.headTop) / (CELL + GAP)) * HEAD_COLS + Math.min(HEAD_COLS - 1, Math.floor(dx / (w + GAP)));

            if (index < this.model.heads) {
                return {kind: 'head', block, index};
            }
        }
        if (y >= this.expertTop && y < this.expertTop + this.expertRows * EXPERT_CELL) {
            const index = Math.floor((y - this.expertTop) / EXPERT_CELL) * EXPERT_COLS + Math.min(EXPERT_COLS - 1, Math.floor(dx / EXPERT_CELL));

            if (index < (this.model.experts ?? 0)) {
                return {kind: 'expert', block, index};
            }
        }
        if (y >= this.binTop && y <= this.chartTop + this.chartHeight) {
            return {kind: 'block', block};
        }

        return null;
    }

    /** Which residual dimensions a bin covers: [from, to). */
    public binDims(index: number): [number, number] {
        const n = this.model.hidden;

        return [Math.floor((index * n) / this.bins), Math.max(Math.floor((index * n) / this.bins) + 1, Math.floor(((index + 1) * n) / this.bins))];
    }

    private ioTop(rows: number): number {
        const binsH = this.bins * (CELL + GAP);

        return Math.max(0, (binsH - rows * IO_ROW) / 2);
    }

}
