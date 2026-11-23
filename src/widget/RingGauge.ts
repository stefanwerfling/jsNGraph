import { paletteColor, setAttrs, svgEl, Tween, Widget, WidgetOptions } from './WidgetBase';
import { WidgetGeometry } from './WidgetGeometry';

/** One ring of a `RingGauge`, outermost first. */
export interface GaugeRing {
    value: number;
    /** Full ring (default 100). */
    max?: number;
    /** Any CSS colour; default a palette colour by position. */
    color?: string;
    label?: string;
}

export interface RingGaugeOptions extends WidgetOptions {
    rings?: GaugeRing[];
    /** Ring thickness in view units, the dial being 200 wide (default 16). */
    thickness?: number;
    /** Space between rings (default 7). */
    gap?: number;
    /** Where the rings start, degrees clockwise from the top (default 0). */
    startAngle?: number;
    /** How far a full ring goes (default 360; e.g. 270 for a horseshoe). */
    sweep?: number;
    /** Round line ends (default false — flat ends, like a pie). */
    rounded?: boolean;
    /** 'values' (default): every ring's value stacked in the middle, in its colour; 'none'; or a fixed text. */
    center?: 'values' | 'none' | string;
    /** Text of a value (default: rounded number). */
    format?: (value: number, ring: GaugeRing) => string;
    /** Maximum width in px (default 220). */
    size?: number;
}

export interface RingGaugeEvents extends Record<string, unknown> {
    ringClick: {ring: GaugeRing; index: number; originalEvent: MouseEvent};
}

const VIEW = 200;

/**
 * Concentric progress rings — the "30 / 45" donut of a dashboard: each ring
 * is a track with a value arc on it, values stacked in the centre. SVG, zero
 * dependencies; values ease when they change.
 *
 *     const g = new RingGauge(el, {rings: [{value: 30}, {value: 45}]});
 *     g.setValues([35, 50]);
 */
export class RingGauge extends Widget<RingGaugeEvents> {

    private rings: GaugeRing[] = [];
    private readonly thickness: number;
    private readonly gap: number;
    private readonly start: number;
    private readonly sweep: number;
    private readonly rounded: boolean;
    private readonly center: string;
    private readonly format: (value: number, ring: GaugeRing) => string;
    private readonly svg: SVGSVGElement;
    private arcs: SVGPathElement[] = [];
    private texts: SVGTextElement[] = [];
    private titles: SVGTitleElement[] = [];
    private readonly tween: Tween;

    public constructor(container: HTMLElement, options: RingGaugeOptions = {}) {
        super(container, 'wg-ring', options);
        this.thickness = options.thickness ?? 16;
        this.gap = options.gap ?? 7;
        this.start = options.startAngle ?? 0;
        this.sweep = Math.max(1, Math.min(360, options.sweep ?? 360));
        this.rounded = options.rounded ?? false;
        this.center = options.center ?? 'values';
        this.format = options.format ?? ((v) => String(Math.round(v)));
        this.svg = svgEl('svg', {viewBox: `0 0 ${VIEW} ${VIEW}`, class: 'wg-svg', role: 'img'});
        this.svg.style.maxWidth = `${options.size ?? 220}px`;
        this.svg.style.margin = '0 auto';
        this.root.appendChild(this.svg);
        this.root.addEventListener('click', this.onClick);
        this.tween = new Tween((v) => this.paint(v), this.duration);
        this.setRings(options.rings ?? []);
    }

    /** Replace the rings (structure and values). */
    public setRings(rings: readonly GaugeRing[], animate = this.animate): void {
        const rebuild = rings.length !== this.rings.length;

        this.rings = rings.map((r) => ({...r}));
        if (rebuild) {
            this.build();
        }
        this.tween.set(this.rings.map((r) => r.value), animate);
    }

    /** New values for the existing rings, in order. */
    public setValues(values: readonly number[], animate = this.animate): void {
        values.forEach((v, i) => {
            const ring = this.rings[i];
            if (ring !== undefined) {
                ring.value = v;
            }
        });
        this.tween.set(this.rings.map((r) => r.value), animate);
    }

    public getRings(): ReadonlyArray<Readonly<GaugeRing>> {
        return this.rings;
    }

    /** Radius of ring `i` in view units. */
    public radius(i: number): number {
        return (VIEW / 2) - 2 - (this.thickness / 2) - (i * (this.thickness + this.gap));
    }

    public override destroy(): void {
        this.tween.stop();
        this.root.removeEventListener('click', this.onClick);
        super.destroy();
    }

    private build(): void {
        const c = VIEW / 2;
        const cap = this.rounded ? 'round' : 'butt';

        this.svg.replaceChildren();
        this.arcs = [];
        this.texts = [];
        this.titles = [];

        this.rings.forEach((ring, i) => {
            const r = this.radius(i);
            const g = svgEl('g', {'data-wg-ring': i});
            const title = svgEl('title');
            const arc = svgEl('path', {class: 'wg-ring-value', 'stroke-width': this.thickness, 'stroke-linecap': cap});

            arc.style.stroke = ring.color ?? paletteColor(i);
            g.append(
                title,
                svgEl('path', {
                    d: WidgetGeometry.arcPath(c, c, r, this.start, this.start + this.sweep),
                    class: 'wg-track', 'stroke-width': this.thickness, 'stroke-linecap': cap
                }),
                arc
            );
            this.svg.appendChild(g);
            this.arcs.push(arc);
            this.titles.push(title);
        });

        if (this.center === 'none') {
            return;
        }

        const inner = Math.max(10, this.radius(this.rings.length - 1) - (this.thickness / 2));

        if (this.center !== 'values') {
            const t = svgEl('text', {x: c, y: c, class: 'wg-center wg-text', 'font-size': Math.min(34, inner * 0.55)});
            t.textContent = this.center;
            this.svg.appendChild(t);
            return;
        }

        const n = Math.max(1, this.rings.length);
        const size = Math.min(36, (inner * 1.35) / n);

        this.rings.forEach((ring, i) => {
            const y = c + ((i - ((n - 1) / 2)) * size * 1.05);
            const t = svgEl('text', {x: c, y, class: 'wg-center', 'font-size': size});

            t.style.fill = ring.color ?? paletteColor(i);
            this.svg.appendChild(t);
            this.texts.push(t);
        });
    }

    private paint(values: number[]): void {
        const c = VIEW / 2;

        this.rings.forEach((ring, i) => {
            const v = values[i] ?? 0;
            const k = WidgetGeometry.fraction(v, ring.max ?? 100);
            const arc = this.arcs[i];
            const text = this.texts[i];
            const title = this.titles[i];

            if (arc !== undefined) {
                setAttrs(arc, {d: WidgetGeometry.arcPath(c, c, this.radius(i), this.start, this.start + (this.sweep * k))});
            }
            if (text !== undefined) {
                text.textContent = this.format(v, ring);
            }
            if (title !== undefined) {
                title.textContent = `${ring.label !== undefined ? `${ring.label}: ` : ''}${this.format(ring.value, ring)}`;
            }
        });

        this.svg.setAttribute('aria-label', this.rings.map((r) => `${r.label ?? ''} ${this.format(r.value, r)}`.trim()).join(', '));
    }

    private readonly onClick = (e: MouseEvent): void => {
        const g = e.target instanceof Element ? e.target.closest('[data-wg-ring]') : null;
        const index = g === null ? -1 : Number(g.getAttribute('data-wg-ring'));
        const ring = this.rings[index];

        if (ring !== undefined) {
            this.events.emit('ringClick', {ring, index, originalEvent: e});
        }
    };

}
