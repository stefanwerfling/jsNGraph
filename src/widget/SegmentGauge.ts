import { paletteColor, setAttrs, svgEl, Tween, Widget, WidgetOptions } from './WidgetBase';
import { WidgetGeometry } from './WidgetGeometry';

/** One stacked share of a `SegmentGauge`. */
export interface GaugePart {
    value: number;
    color?: string;
    label?: string;
}

export interface SegmentGaugeOptions extends WidgetOptions {
    parts?: GaugePart[];
    /** What a full dial is worth (default 100). */
    max?: number;
    /** Number of ticks around the dial (default 44). */
    segments?: number;
    /** Degrees clockwise from the top where the dial starts (default 0). */
    startAngle?: number;
    /** Dial length in degrees (default 360; 240 for a speedometer). */
    sweep?: number;
    /** Radial length of a tick in view units, the dial being 200 wide (default 24). */
    length?: number;
    /** Share of a tick's slot that is filled, 0…1 (default 0.55). */
    fill?: number;
    /** 'values' (default): every part stacked in the middle, in its colour; 'total'; 'none'. */
    center?: 'values' | 'total' | 'none';
    /** Text of a value (default: rounded number + '%'). */
    format?: (value: number, part: GaugePart | null) => string;
    /** Maximum width in px (default 220). */
    size?: number;
}

const VIEW = 200;

/**
 * A dial made of radial ticks, lit in the colours of stacked parts (30 % +
 * 40 % + 10 %), the rest dim — the segmented gauge of a dashboard. SVG, zero
 * dependencies; values ease when they change.
 */
export class SegmentGauge extends Widget<Record<string, never>> {

    private parts: GaugePart[] = [];
    private readonly max: number;
    private readonly segments: number;
    private readonly start: number;
    private readonly sweep: number;
    private readonly length: number;
    private readonly fill: number;
    private readonly center: 'values' | 'total' | 'none';
    private readonly format: (value: number, part: GaugePart | null) => string;
    private readonly svg: SVGSVGElement;
    private ticks: SVGLineElement[] = [];
    private texts: SVGTextElement[] = [];
    private readonly tween: Tween;

    public constructor(container: HTMLElement, options: SegmentGaugeOptions = {}) {
        super(container, 'wg-segment-gauge', options);
        this.max = options.max ?? 100;
        this.segments = Math.max(3, Math.round(options.segments ?? 44));
        this.start = options.startAngle ?? 0;
        this.sweep = Math.max(10, Math.min(360, options.sweep ?? 360));
        this.length = options.length ?? 24;
        this.fill = Math.max(0.1, Math.min(1, options.fill ?? 0.55));
        this.center = options.center ?? 'values';
        this.format = options.format ?? ((v) => `${Math.round(v)}%`);
        this.svg = svgEl('svg', {viewBox: `0 0 ${VIEW} ${VIEW}`, class: 'wg-svg', role: 'img'});
        this.svg.style.maxWidth = `${options.size ?? 220}px`;
        this.svg.style.margin = '0 auto';
        this.root.appendChild(this.svg);
        this.tween = new Tween((v) => this.paint(v), this.duration);
        this.setParts(options.parts ?? []);
    }

    public setParts(parts: readonly GaugePart[], animate = this.animate): void {
        const rebuild = parts.length !== this.parts.length || this.ticks.length === 0;

        this.parts = parts.map((p) => ({...p}));
        if (rebuild) {
            this.build();
        }
        this.tween.set(this.parts.map((p) => p.value), animate);
    }

    public setValues(values: readonly number[], animate = this.animate): void {
        values.forEach((v, i) => {
            const p = this.parts[i];
            if (p !== undefined) {
                p.value = v;
            }
        });
        this.tween.set(this.parts.map((p) => p.value), animate);
    }

    public getParts(): ReadonlyArray<Readonly<GaugePart>> {
        return this.parts;
    }

    public override destroy(): void {
        this.tween.stop();
        super.destroy();
    }

    private build(): void {
        const c = VIEW / 2;
        const r1 = (VIEW / 2) - 2;
        const r0 = r1 - this.length;
        const full = this.sweep >= 360;
        const step = this.sweep / (full ? this.segments : this.segments - 1);
        const width = (2 * Math.PI * ((r0 + r1) / 2) * (step / 360)) * this.fill;

        this.svg.replaceChildren();
        this.ticks = [];
        this.texts = [];

        for (let k = 0; k < this.segments; k++) {
            const a = this.start + (k * step) + (full ? step / 2 : 0);
            const [x1, y1] = WidgetGeometry.polar(c, c, r0, a);
            const [x2, y2] = WidgetGeometry.polar(c, c, r1, a);
            const tick = svgEl('line', {x1, y1, x2, y2, 'stroke-width': width});

            this.svg.appendChild(tick);
            this.ticks.push(tick);
        }

        if (this.center === 'none') {
            return;
        }

        const inner = r0 - 8;
        const lines = this.center === 'total' ? 1 : Math.max(1, this.parts.length);
        const size = Math.min(34, (inner * 1.3) / lines);

        for (let i = 0; i < lines; i++) {
            const y = c + ((i - ((lines - 1) / 2)) * size * 1.08);
            const t = svgEl('text', {x: c, y, class: 'wg-center', 'font-size': size});

            t.style.fill = this.center === 'total' ? 'var(--wg-ink)' : this.parts[i]?.color ?? paletteColor(i);
            this.svg.appendChild(t);
            this.texts.push(t);
        }
    }

    private paint(values: number[]): void {
        const owners = WidgetGeometry.segmentOwners(values, this.max, this.segments);

        this.ticks.forEach((tick, k) => {
            const owner = owners[k] ?? -1;
            const part = this.parts[owner];

            if (part === undefined) {
                setAttrs(tick, {class: 'wg-track'});
                tick.style.stroke = '';
            } else {
                setAttrs(tick, {class: ''});
                tick.style.stroke = part.color ?? paletteColor(owner);
            }
        });

        if (this.center === 'total') {
            const t = this.texts[0];
            if (t !== undefined) {
                t.textContent = this.format(values.reduce((a, b) => a + b, 0), null);
            }
        } else {
            this.texts.forEach((t, i) => {
                const part = this.parts[i];
                t.textContent = part === undefined ? '' : this.format(values[i] ?? 0, part);
            });
        }

        this.svg.setAttribute('aria-label', this.parts.map((p) => `${p.label ?? ''} ${this.format(p.value, p)}`.trim()).join(', '));
    }

}
