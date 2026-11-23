import { paletteColor, setAttrs, svgEl, Tween, Widget, WidgetOptions } from './WidgetBase';
import { WidgetGeometry } from './WidgetGeometry';

/** One row of `ProgressBars`. */
export interface ProgressRow {
    label: string;
    value: number;
    color?: string;
}

export interface ProgressBarsOptions extends WidgetOptions {
    rows?: ProgressRow[];
    /** Scale of the bars (default 0…100). */
    min?: number;
    max?: number;
    /**
     * Labels under the axis: strings spread evenly from min to max (e.g. months),
     * a tick count for nice numbers (default 5), or false for none.
     */
    axis?: string[] | number | false;
    /** Vertical grid lines at the axis labels (default true). */
    grid?: boolean;
    /** Drag a bar to change it (`change` while dragging, `commit` on release). Default false. */
    editable?: boolean;
    /** Snap dragged values to this step (default 1; 0 = free). */
    step?: number;
    format?: (value: number) => string;
}

export interface ProgressBarsEvents extends Record<string, unknown> {
    change: {index: number; row: ProgressRow; value: number};
    commit: {index: number; row: ProgressRow; value: number};
    rowClick: {index: number; row: ProgressRow; originalEvent: MouseEvent};
}

const LABEL_W = 46;
const RIGHT = 12;
const ROW_H = 32;
const AXIS_H = 22;
const BAR = 7;
const KNOB = 7;

/**
 * Horizontal progress bars with a knob at the tip, on a shared axis — the
 * "slider" bars of a dashboard. Optionally editable (drag a bar). SVG, zero
 * dependencies; values ease when they change.
 */
export class ProgressBars extends Widget<ProgressBarsEvents> {

    private rows: ProgressRow[] = [];
    private readonly min: number;
    private readonly max: number;
    private readonly axis: string[] | number | false;
    private readonly grid: boolean;
    private readonly editable: boolean;
    private readonly step: number;
    private readonly format: (value: number) => string;
    private readonly svg: SVGSVGElement;
    private bars: SVGLineElement[] = [];
    private knobs: SVGCircleElement[] = [];
    private titles: SVGTitleElement[] = [];
    private dragging = -1;
    private readonly tween: Tween;
    /** Layout width in px (follows the container). */
    private width = 400;

    public constructor(container: HTMLElement, options: ProgressBarsOptions = {}) {
        super(container, `wg-progress${options.editable === true ? ' wg-pb-editable' : ''}`, options);
        this.min = options.min ?? 0;
        this.max = options.max ?? 100;
        this.axis = options.axis ?? 5;
        this.grid = options.grid ?? true;
        this.editable = options.editable ?? false;
        this.step = options.step ?? 1;
        this.format = options.format ?? ((v) => String(Math.round(v)));
        this.svg = svgEl('svg', {class: 'wg-svg', role: 'img'});
        this.root.appendChild(this.svg);
        this.root.addEventListener('pointerdown', this.onDown);
        this.root.addEventListener('click', this.onClick);
        this.tween = new Tween((v) => this.paint(v), this.duration);
        this.watchWidth((w) => {
            this.width = w;
            this.build();
            this.paint([...this.tween.values]);
        });
        this.setRows(options.rows ?? []);
    }

    public setRows(rows: readonly ProgressRow[], animate = this.animate): void {
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

    public getRows(): ReadonlyArray<Readonly<ProgressRow>> {
        return this.rows;
    }

    public override destroy(): void {
        this.tween.stop();
        this.root.removeEventListener('pointerdown', this.onDown);
        this.root.removeEventListener('click', this.onClick);
        window.removeEventListener('pointermove', this.onMove);
        window.removeEventListener('pointerup', this.onUp);
        super.destroy();
    }

    private get x0(): number {
        return LABEL_W + KNOB;
    }

    private get x1(): number {
        return this.width - RIGHT - KNOB;
    }

    private xOf(value: number): number {
        return this.x0 + (WidgetGeometry.fraction(value, this.max, this.min) * (this.x1 - this.x0));
    }

    private build(): void {
        const hasAxis = this.axis !== false;
        const plotH = this.rows.length * ROW_H;
        const h = plotH + (hasAxis ? AXIS_H : 0);

        this.svg.setAttribute('viewBox', `0 0 ${this.width} ${Math.max(1, h)}`);
        this.svg.replaceChildren();
        this.bars = [];
        this.knobs = [];
        this.titles = [];

        // axis + grid
        const ticks: {x: number; label: string}[] = [];
        if (Array.isArray(this.axis)) {
            const n = this.axis.length;
            this.axis.forEach((label, i) => {
                ticks.push({x: this.x0 + (n > 1 ? (i / (n - 1)) * (this.x1 - this.x0) : 0), label});
            });
        } else if (typeof this.axis === 'number') {
            for (const v of WidgetGeometry.ticks(this.min, this.max, this.axis)) {
                ticks.push({x: this.xOf(v), label: this.format(v)});
            }
        }
        for (const t of ticks) {
            if (this.grid) {
                this.svg.appendChild(svgEl('line', {x1: t.x, y1: 0, x2: t.x, y2: plotH, class: 'wg-grid'}));
            }
            const label = svgEl('text', {x: t.x, y: plotH + 15, class: 'wg-axis', 'text-anchor': 'middle'});
            label.textContent = t.label;
            this.svg.appendChild(label);
        }

        this.rows.forEach((row, i) => {
            const y = (i + 0.5) * ROW_H;
            const color = row.color ?? paletteColor(i);
            const g = svgEl('g', {class: 'wg-pb-row', 'data-wg-row': i});
            const title = svgEl('title');
            const label = svgEl('text', {x: 0, y, class: 'wg-muted', 'font-size': 11, 'dominant-baseline': 'central'});
            const bar = svgEl('line', {x1: this.x0, y1: y, x2: this.x0, y2: y, 'stroke-width': BAR, 'stroke-linecap': 'round'});
            const knob = svgEl('circle', {cx: this.x0, cy: y, r: KNOB, class: 'wg-pb-knob'});

            label.textContent = row.label;
            bar.style.stroke = color;
            knob.style.fill = color;
            g.append(
                title,
                svgEl('rect', {x: 0, y: y - (ROW_H / 2), width: this.width, height: ROW_H, fill: 'transparent'}),
                label,
                svgEl('line', {x1: this.x0, y1: y, x2: this.x1, y2: y, class: 'wg-track', 'stroke-width': 2, 'stroke-linecap': 'round'}),
                bar,
                knob
            );
            this.svg.appendChild(g);
            this.bars.push(bar);
            this.knobs.push(knob);
            this.titles.push(title);
        });
    }

    private paint(values: number[]): void {
        this.rows.forEach((row, i) => {
            const x = this.xOf(values[i] ?? this.min);
            const bar = this.bars[i];
            const knob = this.knobs[i];
            const title = this.titles[i];

            if (bar !== undefined) {
                setAttrs(bar, {x2: x});
            }
            if (knob !== undefined) {
                setAttrs(knob, {cx: x});
            }
            if (title !== undefined) {
                title.textContent = `${row.label}: ${this.format(row.value)}`;
            }
        });
        this.svg.setAttribute('aria-label', this.rows.map((r) => `${r.label} ${this.format(r.value)}`).join(', '));
    }

    private rowAt(target: EventTarget | null): number {
        const g = target instanceof Element ? target.closest('[data-wg-row]') : null;

        return g === null ? -1 : Number(g.getAttribute('data-wg-row'));
    }

    private valueFromEvent(e: PointerEvent): number {
        const m = this.svg.getScreenCTM();

        if (m === null) {
            return this.min;
        }

        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());

        return WidgetGeometry.valueAt(p.x, this.x0, this.x1, this.min, this.max, this.step);
    }

    private applyDrag(e: PointerEvent, kind: 'change' | 'commit'): void {
        const row = this.rows[this.dragging];

        if (row === undefined) {
            return;
        }

        const value = this.valueFromEvent(e);

        if (kind === 'change' && value === row.value) {
            return;
        }
        row.value = value;
        this.tween.set(this.rows.map((r) => r.value), false);
        this.events.emit(kind, {index: this.dragging, row, value});
    }

    private readonly onDown = (e: PointerEvent): void => {
        if (!this.editable || e.button !== 0) {
            return;
        }

        const index = this.rowAt(e.target);

        if (index < 0) {
            return;
        }
        e.preventDefault();
        this.dragging = index;
        this.applyDrag(e, 'change');
        window.addEventListener('pointermove', this.onMove);
        window.addEventListener('pointerup', this.onUp);
    };

    private readonly onMove = (e: PointerEvent): void => {
        this.applyDrag(e, 'change');
    };

    private readonly onUp = (e: PointerEvent): void => {
        this.applyDrag(e, 'commit');
        this.dragging = -1;
        window.removeEventListener('pointermove', this.onMove);
        window.removeEventListener('pointerup', this.onUp);
    };

    private readonly onClick = (e: MouseEvent): void => {
        const index = this.rowAt(e.target);
        const row = this.rows[index];

        if (row !== undefined) {
            this.events.emit('rowClick', {index, row, originalEvent: e});
        }
    };

}
