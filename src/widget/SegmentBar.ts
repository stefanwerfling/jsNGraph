import { Tween, Widget, WidgetDom, WidgetOptions } from './WidgetBase';
import { WidgetGeometry } from './WidgetGeometry';

/** One row of a `SegmentBar`. */
export interface SegmentRow {
    label: string;
    value: number;
    /** Full bar (default the widget's `max`). */
    max?: number;
    color?: string;
}

export interface SegmentBarOptions extends WidgetOptions {
    rows?: SegmentRow[];
    /** Default full bar (default 100). */
    max?: number;
    /** Cells per bar (default 20). */
    segments?: number;
    /** Slant of each cell as a share of its height (default 0.35; 0 = upright). */
    skew?: number;
    /** Show the value right of the bar (default false). */
    showValue?: boolean;
    format?: (value: number, row: SegmentRow) => string;
}

/**
 * LED-style bars: each row a label over a strip of slanted cells, lit up to
 * its value in the row's colour. SVG, zero dependencies; values ease (the lit
 * cells count up) when they change.
 */
export class SegmentBar extends Widget<Record<string, never>> {

    private static readonly LABEL_H = 15;
    private static readonly BAR_H = 13;
    private static readonly ROW_GAP = 11;
    private static readonly VALUE_W = 40;

    private rows: SegmentRow[] = [];
    private readonly max: number;
    private readonly segments: number;
    private readonly skew: number;
    private readonly showValue: boolean;
    private readonly format: (value: number, row: SegmentRow) => string;
    private readonly svg: SVGSVGElement;
    private cells: SVGPolygonElement[][] = [];
    private values: SVGTextElement[] = [];
    private readonly tween: Tween;
    /** Layout width in px (follows the container). */
    private width = 300;

    public constructor(container: HTMLElement, options: SegmentBarOptions = {}) {
        super(container, 'wg-segment-bar', options);
        this.max = options.max ?? 100;
        this.segments = Math.max(2, Math.round(options.segments ?? 20));
        this.skew = options.skew ?? 0.35;
        this.showValue = options.showValue ?? false;
        this.format = options.format ?? ((v) => String(Math.round(v)));
        this.svg = WidgetDom.svg('svg', {class: 'wg-svg', role: 'img'});
        this.root.appendChild(this.svg);
        this.tween = new Tween((v) => this.paint(v), this.duration);
        this.watchWidth((w) => {
            this.width = w;
            this.build();
            this.paint([...this.tween.values]);
        });
        this.setRows(options.rows ?? []);
    }

    public setRows(rows: readonly SegmentRow[], animate = this.animate): void {
        const rebuild = rows.length !== this.rows.length || rows.some((r, i) => r.label !== this.rows[i]?.label);

        this.rows = rows.map((r) => ({...r}));
        if (rebuild) {
            this.build();
        }
        this.tween.set(this.rows.map((r) => r.value), animate);
    }

    public setValues(values: readonly number[], animate = this.animate): void {
        values.forEach((v, i) => {
            const r = this.rows[i];
            if (r !== undefined) {
                r.value = v;
            }
        });
        this.tween.set(this.rows.map((r) => r.value), animate);
    }

    public getRows(): ReadonlyArray<Readonly<SegmentRow>> {
        return this.rows.map((r) => ({...r}));
    }

    public override destroy(): void {
        this.tween.stop();
        super.destroy();
    }

    private build(): void {
        const rowH = SegmentBar.LABEL_H + SegmentBar.BAR_H + SegmentBar.ROW_GAP;
        const h = Math.max(1, (this.rows.length * rowH) - SegmentBar.ROW_GAP);
        const barW = this.width - (this.showValue ? SegmentBar.VALUE_W : 0);
        const slant = SegmentBar.BAR_H * this.skew;
        const pitch = (barW - slant) / this.segments;
        const cellW = pitch * 0.62;

        this.svg.setAttribute('viewBox', `0 0 ${this.width} ${h}`);
        this.svg.replaceChildren();
        this.cells = [];
        this.values = [];

        this.rows.forEach((row, i) => {
            const y = i * rowH;
            const label = WidgetDom.svg('text', {x: 0, y: y + 10, class: 'wg-seg-label'});
            const title = WidgetDom.svg('title');
            const cells: SVGPolygonElement[] = [];

            label.textContent = row.label;
            label.style.fill = row.color ?? Widget.paletteColor(i);
            title.textContent = row.label;
            this.svg.append(label);

            const g = WidgetDom.svg('g');
            g.appendChild(title);
            for (let k = 0; k < this.segments; k++) {
                const x = k * pitch;
                const top = y + SegmentBar.LABEL_H;
                const pts = `${x + slant},${top} ${x + slant + cellW},${top} ${x + cellW},${top + SegmentBar.BAR_H} ${x},${top + SegmentBar.BAR_H}`;
                const cell = WidgetDom.svg('polygon', {points: pts});

                g.appendChild(cell);
                cells.push(cell);
            }
            this.svg.appendChild(g);
            this.cells.push(cells);

            if (this.showValue) {
                const t = WidgetDom.svg('text', {x: this.width, y: y + SegmentBar.LABEL_H + (SegmentBar.BAR_H / 2), class: 'wg-text', 'text-anchor': 'end',
                    'dominant-baseline': 'central', 'font-size': 12, 'font-weight': 700});
                this.svg.appendChild(t);
                this.values.push(t);
            }
        });
    }

    private paint(values: number[]): void {
        this.rows.forEach((row, i) => {
            const v = values[i] ?? 0;
            const lit = WidgetGeometry.litCount(v, row.max ?? this.max, this.segments);
            const color = row.color ?? Widget.paletteColor(i);

            this.cells[i]?.forEach((cell, k) => {
                if (k < lit) {
                    cell.setAttribute('class', '');
                    cell.style.fill = color;
                } else {
                    cell.setAttribute('class', 'wg-seg-off');
                    cell.style.fill = '';
                }
            });

            const t = this.values[i];
            if (t !== undefined) {
                t.textContent = this.format(v, row);
            }

            const title = this.cells[i]?.[0]?.parentElement?.querySelector('title');
            if (title) {
                title.textContent = `${row.label}: ${this.format(row.value, row)}`;
            }
        });
    }

}
