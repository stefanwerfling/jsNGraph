import { paletteColor, svgEl, Tween, Widget, WidgetOptions } from './WidgetBase';
import { WidgetGeometry } from './WidgetGeometry';

/** One slice of a `DonutChart`. */
export interface DonutSlice {
    label: string;
    value: number;
    /** Any CSS colour; default a palette colour by position. */
    color?: string;
}

export interface DonutChartOptions extends WidgetOptions {
    slices?: DonutSlice[];
    /** Ring thickness in view units, the dial being 200 wide (default 28). */
    thickness?: number;
    /** Gap between slices in degrees (default 2). */
    pad?: number;
    /** Where the first slice starts, degrees clockwise from the top (default 0). */
    startAngle?: number;
    /** Text under the total in the middle (default none); the total itself shows unless `center: false`. */
    centerLabel?: string;
    center?: boolean;
    /** Value text (default: rounded, grouped number). */
    format?: (value: number) => string;
    /** HTML legend with value and share: 'right' (default), 'below' or 'none'. */
    legend?: 'right' | 'below' | 'none';
    /** Maximum width of the dial in px (default 220). */
    size?: number;
}

export interface DonutChartEvents extends Record<string, unknown> {
    /** The slice under the pointer (dial or legend); null when it leaves. */
    segmentHover: {slice: DonutSlice; index: number; share: number} | null;
    segmentClick: {slice: DonutSlice; index: number; share: number; originalEvent: MouseEvent};
}

const VIEW = 200;

/**
 * Shares as a ring of slices with small gaps, the total in the middle and an
 * HTML legend (value + percent). Hovering a slice or its legend row lifts it,
 * dims the others and shows it in the middle; values ease on `setValues`
 * (new slices grow from nothing). SVG, zero dependencies.
 *
 *     const d = new DonutChart(el, {slices: [{label: 'TS', value: 40}, {label: 'Go', value: 12}]});
 */
export class DonutChart extends Widget<DonutChartEvents> {

    private slices: DonutSlice[] = [];
    private readonly thickness: number;
    private readonly pad: number;
    private readonly start: number;
    private readonly centerLabel: string;
    private readonly showCenter: boolean;
    private readonly format: (value: number) => string;
    private readonly svg: SVGSVGElement;
    private readonly legendBox: HTMLDivElement;
    private readonly valueText: SVGTextElement;
    private readonly labelText: SVGTextElement;
    private arcs: SVGPathElement[] = [];
    private rows: HTMLDivElement[] = [];
    private shown: number[] = [];
    private hover: number | null = null;
    private external: number | null = null;
    private readonly tween: Tween;

    public constructor(container: HTMLElement, options: DonutChartOptions = {}) {
        super(container, 'wg-donut', options);
        this.thickness = options.thickness ?? 28;
        this.pad = options.pad ?? 2;
        this.start = options.startAngle ?? 0;
        this.centerLabel = options.centerLabel ?? '';
        this.showCenter = options.center ?? true;
        this.format = options.format ?? ((v) => Math.round(v).toLocaleString());
        this.root.classList.add(`wg-donut-${options.legend ?? 'right'}`);

        this.svg = svgEl('svg', {viewBox: `0 0 ${VIEW} ${VIEW}`, class: 'wg-svg wg-donut-svg', role: 'img'});
        this.svg.style.maxWidth = `${options.size ?? 220}px`;
        this.valueText = svgEl('text', {x: VIEW / 2, y: VIEW / 2 - 2, class: 'wg-donut-value'});
        this.labelText = svgEl('text', {x: VIEW / 2, y: VIEW / 2 + 20, class: 'wg-muted wg-donut-label'});
        this.legendBox = document.createElement('div');
        this.legendBox.className = 'wg-donut-legend';
        if (options.legend === 'none') {
            this.legendBox.style.display = 'none';
        }
        this.root.append(this.svg, this.legendBox);

        this.svg.addEventListener('pointerover', this.onOver);
        this.svg.addEventListener('pointerleave', this.onLeave);
        this.svg.addEventListener('click', this.onClick);
        this.legendBox.addEventListener('pointerover', this.onOver);
        this.legendBox.addEventListener('pointerleave', this.onLeave);
        this.legendBox.addEventListener('click', this.onClick);
        this.tween = new Tween((v) => this.paint(v), this.duration);
        this.setSlices(options.slices ?? []);
    }

    /** Replace the slices; slices with the same labels morph, new ones grow in. */
    public setSlices(slices: readonly DonutSlice[], animate = this.animate): void {
        const before = this.slices.map((s) => s.label).join('\u0000');
        this.slices = slices.map((s) => ({...s}));
        if (before !== this.slices.map((s) => s.label).join('\u0000')) {
            this.build();
        }
        this.tween.set(this.slices.map((s) => s.value), animate);
    }

    /** New values for the existing slices, in order. */
    public setValues(values: readonly number[], animate = this.animate): void {
        values.forEach((v, i) => {
            const s = this.slices[i];
            if (s !== undefined) {
                s.value = v;
            }
        });
        this.tween.set(this.slices.map((s) => s.value), animate);
    }

    public getSlices(): ReadonlyArray<Readonly<DonutSlice>> {
        return this.slices;
    }

    /** Lift a slice by label from outside (null clears); hover wins. */
    public highlight(label: string | null): void {
        const i = label === null ? -1 : this.slices.findIndex((s) => s.label === label);
        this.external = i < 0 ? null : i;
        this.applyFocus();
    }

    public override destroy(): void {
        this.tween.stop();
        this.svg.removeEventListener('pointerover', this.onOver);
        this.svg.removeEventListener('pointerleave', this.onLeave);
        this.svg.removeEventListener('click', this.onClick);
        this.legendBox.removeEventListener('pointerover', this.onOver);
        this.legendBox.removeEventListener('pointerleave', this.onLeave);
        this.legendBox.removeEventListener('click', this.onClick);
        super.destroy();
    }

    private color(i: number): string {
        return this.slices[i]?.color ?? paletteColor(i);
    }

    private build(): void {
        this.svg.replaceChildren();
        this.legendBox.replaceChildren();
        this.arcs = this.slices.map((s, i) => {
            const p = svgEl('path', {class: 'wg-donut-slice', 'stroke-width': this.thickness, 'data-wg-slice': i});
            p.style.stroke = this.color(i);
            const t = svgEl('title');
            t.textContent = s.label;
            p.appendChild(t);
            return p;
        });
        this.svg.append(...this.arcs, this.valueText, this.labelText);
        this.rows = this.slices.map((s, i) => {
            const row = document.createElement('div');
            row.className = 'wg-donut-row';
            row.dataset['wgSlice'] = String(i);
            const sw = document.createElement('span');
            sw.className = 'wg-donut-swatch';
            sw.style.background = this.color(i);
            const name = document.createElement('span');
            name.className = 'wg-donut-name';
            name.textContent = s.label;
            const val = document.createElement('span');
            val.className = 'wg-donut-num';
            const pct = document.createElement('span');
            pct.className = 'wg-donut-pct';
            row.append(sw, name, val, pct);
            return row;
        });
        this.legendBox.append(...this.rows);
        this.applyFocus();
    }

    private paint(values: readonly number[]): void {
        this.shown = [...values];
        const r = VIEW / 2 - 2 - this.thickness / 2 - 4;
        const spans = WidgetGeometry.donut(values, this.pad, this.start);
        spans.forEach((sp, i) => {
            this.arcs[i]?.setAttribute('d', WidgetGeometry.arcPath(VIEW / 2, VIEW / 2, r, sp.from, sp.to));
            const row = this.rows[i];
            if (row !== undefined) {
                row.children[2]!.textContent = this.format(values[i] ?? 0);
                row.children[3]!.textContent = `${Math.round(sp.share * 100)}%`;
            }
        });
        this.writeCenter();
    }

    private writeCenter(): void {
        if (!this.showCenter) {
            this.valueText.textContent = '';
            this.labelText.textContent = '';
            return;
        }
        const f = this.hover ?? this.external;
        const total = this.shown.reduce((a, v) => a + Math.max(0, v), 0);
        if (f !== null && this.slices[f] !== undefined) {
            const v = Math.max(0, this.shown[f] ?? 0);
            this.valueText.textContent = `${total > 0 ? Math.round(v / total * 100) : 0}%`;
            this.labelText.textContent = this.slices[f]!.label;
            this.valueText.style.fill = this.color(f);
        } else {
            this.valueText.textContent = this.format(total);
            this.labelText.textContent = this.centerLabel;
            this.valueText.style.fill = '';
        }
    }

    private applyFocus(): void {
        const f = this.hover ?? this.external;
        this.root.classList.toggle('wg-donut-focus', f !== null);
        this.arcs.forEach((a, i) => a.classList.toggle('wg-donut-on', i === f));
        this.rows.forEach((r, i) => r.classList.toggle('wg-donut-on', i === f));
        this.writeCenter();
    }

    private indexOf(target: EventTarget | null): number | null {
        const el = target instanceof Element ? target.closest<HTMLElement | SVGElement>('[data-wg-slice]') : null;
        const i = el?.dataset['wgSlice'];

        return i === undefined ? null : Number(i);
    }

    private payload(i: number): {slice: DonutSlice; index: number; share: number} {
        const total = this.shown.reduce((a, v) => a + Math.max(0, v), 0);

        return {slice: this.slices[i]!, index: i, share: total > 0 ? Math.max(0, this.shown[i] ?? 0) / total : 0};
    }

    private readonly onOver = (e: PointerEvent): void => {
        const i = this.indexOf(e.target);
        if (i !== this.hover) {
            this.hover = i;
            this.applyFocus();
            this.events.emit('segmentHover', i === null ? null : this.payload(i));
        }
    };

    private readonly onLeave = (): void => {
        if (this.hover !== null) {
            this.hover = null;
            this.applyFocus();
            this.events.emit('segmentHover', null);
        }
    };

    private readonly onClick = (e: MouseEvent): void => {
        const i = this.indexOf(e.target);
        if (i !== null) {
            this.events.emit('segmentClick', {...this.payload(i), originalEvent: e});
        }
    };

}
