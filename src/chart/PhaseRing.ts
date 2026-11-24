import { Color } from '../util/Color';
import { ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { PhaseRingGeometry, RingPoint, RingView } from './PhaseRingGeometry';

/** One cyclic series: `values[i]` belongs to phase i / values.length. */
export interface PhaseSeries {
    name: string;
    values: number[];
}

/** A text pointing at one bin of a ring (like "Star alone"). */
export interface PhaseNote {
    bin: number;
    text: string;
    /** Series index (stack layout; default the shown/first one). */
    series?: number;
}

export interface PhaseLegend {
    title?: string;
    subtitle?: string;
    low?: string;
    high?: string;
}

export interface PhaseRingOptions {
    series?: PhaseSeries[];
    /** 'single' = one ring (the `active` series), 'stack' = one ring per series, top to bottom (default 'single'). */
    layout?: 'single' | 'stack';
    active?: number;
    /** Level of the disk each ring stands on: the series mean (default), its minimum, or a value. */
    baseline?: 'mean' | 'min' | number;
    /** Colour + height range: one for all series or each its own (default 'shared'). */
    scale?: 'shared' | 'each';
    /** Phase glyphs on the orbit above the rings (default 8; 0 = no orbit). */
    glyphs?: number;
    /** 'moon' draws the lit part for the phase, 'dot' a plain dot, or your own drawer. */
    glyph?: 'moon' | 'dot' | ((ctx: CanvasRenderingContext2D, x: number, y: number, r: number, phase: number) => void);
    /** Body in the middle of the orbit (false = none). */
    center?: {color?: string; radius?: number; label?: string} | false;
    /** Tooltip / note text of a bin. */
    phaseLabel?: (bin: number, bins: number) => string;
    format?: (value: number) => string;
    /** Value colour stops, low → high (default spectral blue → red). */
    colors?: string[];
    legend?: PhaseLegend | false;
    notes?: PhaseNote[];
    /** A marked phase (0 … 1), e.g. today. */
    cursor?: number | null;
    cursorLabel?: string;
    /** Degrees the view looks down (default 22). */
    tilt?: number;
    /** Degrees the rings are turned (default 0: phase 0 in front). */
    yaw?: number;
    /** Drag turns/tilts the view (default true). */
    rotate?: boolean;
    /** Curved arrows showing the direction of travel (default true). */
    arrows?: boolean;
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
}

export interface PhaseHover {
    /** Series under the pointer (−1 = a glyph on the orbit). */
    series: number;
    bin: number;
    phase: number;
    label: string;
    /** Value of every series at this bin. */
    values: number[];
}

export interface PhaseRingEvents extends Record<string, unknown> {
    hover: PhaseHover | null;
    click: PhaseHover;
}

interface HitPoint {
    x: number;
    y: number;
    series: number;
    bin: number;
}

/**
 * A cyclic measurement around an orbit, drawn like an exoplanet phase curve:
 * phase glyphs (e.g. the moon) circle a central body at the top, below each
 * series is a tilted ring whose height and colour follow the value (above
 * the disk = above the baseline), thin lines drop from every glyph through
 * the rings. Drag turns it, hover reads a phase, notes point at bins.
 */
export class PhaseRing extends ChartSurface<PhaseRingEvents> {

    private series: PhaseSeries[];
    private from: number[][] = [];
    private animStart = -1;
    private readonly animMs = 900;
    private layout: 'single' | 'stack';
    private active: number;
    private baseline: 'mean' | 'min' | number;
    private scale: 'shared' | 'each';
    private glyphs: number;
    private glyph: PhaseRingOptions['glyph'];
    private center: PhaseRingOptions['center'];
    private phaseLabel: (bin: number, bins: number) => string;
    private format: (value: number) => string;
    private colors: string[];
    private legend: PhaseLegend | false;
    private notes: PhaseNote[];
    private cursor: number | null;
    private cursorLabel: string;
    private tilt: number;
    private yaw: number;
    private readonly tilt0: number;
    private readonly yaw0: number;
    private readonly rotate: boolean;
    private readonly arrows: boolean;

    private hits: HitPoint[] = [];
    private hoverBin = -1;
    private hoverSeries = -2;
    private pinnedBin: number | null = null;
    private pointer: {x: number; y: number} | null = null;
    private drag: {x: number; y: number; yaw: number; tilt: number; moved: boolean} | null = null;

    public constructor(container: HTMLElement, options: PhaseRingOptions = {}) {
        super(container, options.theme ?? 'dark');
        this.series = PhaseRing.copySeries(options.series ?? []);
        this.layout = options.layout ?? 'single';
        this.active = options.active ?? 0;
        this.baseline = options.baseline ?? 'mean';
        this.scale = options.scale ?? 'shared';
        this.glyphs = options.glyphs ?? 8;
        this.glyph = options.glyph ?? 'moon';
        this.center = {...options.center};
        this.format = options.format ?? ((v) => String(Math.round(v * 100) / 100));
        this.phaseLabel = options.phaseLabel ?? ((bin, bins) => this.glyph === 'moon'
            ? `${PhaseRingGeometry.moonName(bin / bins)} · day ${Math.round(bin / bins * 29.53)}`
            : `Phase ${bin + 1} / ${bins}`);
        this.colors = [...(options.colors ?? PhaseRingGeometry.SPECTRAL)];
        this.legend = options.legend === false ? false : {...options.legend};
        this.notes = (options.notes ?? []).map((n) => ({...n}));
        this.cursor = options.cursor ?? null;
        this.cursorLabel = options.cursorLabel ?? 'today';
        this.tilt0 = this.tilt = options.tilt ?? 22;
        this.yaw0 = this.yaw = options.yaw ?? 0;
        this.rotate = options.rotate ?? true;
        this.arrows = options.arrows ?? true;
        this.animStart = performance.now();
        this.from = this.series.map((s) => s.values.map(() => this.base(s.values)));

        this.root.addEventListener('pointerdown', this.onDown);
        this.root.addEventListener('pointermove', this.onMove);
        this.root.addEventListener('pointerup', this.onUp);
        this.root.addEventListener('pointercancel', this.onUp);
        this.root.addEventListener('pointerleave', this.onLeave);
        this.root.addEventListener('dblclick', this.onDblClick);
        this.redraw();
    }

    /** Replace the data; with `animate` (default true) rings morph from what is shown now. */
    public setSeries(series: PhaseSeries[], options: {animate?: boolean} = {}): void {
        const now = performance.now();

        this.from = series.map((s, i) => {
            const shown = this.shownValues(i, now);
            return shown !== null && shown.length === s.values.length ? shown : s.values.map(() => this.base(s.values));
        });
        this.series = PhaseRing.copySeries(series);
        this.animStart = options.animate === false ? -1 : now;
        if (this.active >= series.length) {
            this.active = 0;
        }
        this.redraw();
    }

    /** A copy of the series. */
    public getSeries(): ReadonlyArray<PhaseSeries> {
        return PhaseRing.copySeries(this.series);
    }

    public setLayout(layout: 'single' | 'stack'): void {
        this.layout = layout;
        this.redraw();
    }

    public setActive(index: number): void {
        this.active = Math.max(0, Math.min(this.series.length - 1, index));
        this.redraw();
    }

    public setScale(scale: 'shared' | 'each'): void {
        this.scale = scale;
        this.redraw();
    }

    public setNotes(notes: PhaseNote[]): void {
        this.notes = notes.map((n) => ({...n}));
        this.redraw();
    }

    public setLegend(legend: PhaseLegend | false): void {
        this.legend = legend === false ? false : {...legend};
        this.redraw();
    }

    public setCursor(phase: number | null, label?: string): void {
        this.cursor = phase;
        if (label !== undefined) {
            this.cursorLabel = label;
        }
        this.redraw();
    }

    /** Mark one bin from outside (e.g. a hovered table column); null = none. */
    public highlightBin(bin: number | null): void {
        this.pinnedBin = bin;
        this.redraw();
    }

    /** Turn (yaw) and look-down angle (tilt), degrees. */
    public setView(view: {yaw?: number; tilt?: number}): void {
        this.yaw = view.yaw ?? this.yaw;
        this.tilt = Math.max(8, Math.min(70, view.tilt ?? this.tilt));
        this.redraw();
    }

    /** Back to the start turn and tilt. */
    public resetView(): void {
        this.setView({yaw: this.yaw0, tilt: this.tilt0});
    }

    public override destroy(): void {
        this.root.removeEventListener('pointerdown', this.onDown);
        this.root.removeEventListener('pointermove', this.onMove);
        this.root.removeEventListener('pointerup', this.onUp);
        this.root.removeEventListener('pointercancel', this.onUp);
        this.root.removeEventListener('pointerleave', this.onLeave);
        this.root.removeEventListener('dblclick', this.onDblClick);
        super.destroy();
    }

    // ---- values ---------------------------------------------------------------------------------

    private base(values: ReadonlyArray<number>): number {
        const st = PhaseRingGeometry.stats(values);

        return this.baseline === 'mean' ? st.mean : this.baseline === 'min' ? st.min : this.baseline;
    }

    private ease(now: number): number {
        if (this.animStart < 0) {
            return 1;
        }

        const u = Math.min(1, (now - this.animStart) / this.animMs);

        return 1 - Math.pow(1 - u, 3);
    }

    private shownValues(i: number, now: number): number[] | null {
        const s = this.series[i];

        if (s === undefined) {
            return null;
        }

        const from = this.from[i];
        const e = this.ease(now);

        return s.values.map((v, k) => {
            const f = from?.[k] ?? v;
            return f + (v - f) * e;
        });
    }

    /** Indices of the series drawn as rings, top first. */
    private rings(): number[] {
        if (this.series.length === 0) {
            return [];
        }

        return this.layout === 'stack' ? this.series.map((_, i) => i) : [Math.min(this.active, this.series.length - 1)];
    }

    // ---- drawing --------------------------------------------------------------------------------------

    protected draw(ctx: CanvasRenderingContext2D, now: number): boolean {
        const {width: W, height: H, theme} = this;
        const animating = this.animStart >= 0 && now - this.animStart < this.animMs;

        ctx.fillStyle = theme.background;
        ctx.fillRect(0, 0, W, H);
        this.hits = [];

        const rings = this.rings();
        const values = this.series.map((_, i) => this.shownValues(i, now) ?? []);

        if (rings.length === 0 || W < 40 || H < 40) {
            return animating;
        }

        // ranges: shared over the drawn rings, or per series (taken from the target values so they do not jump)
        const range = (i: number): {lo: number; hi: number; base: number} => {
            const pool = this.scale === 'each' ? [i] : rings;
            let lo = Infinity, hi = -Infinity;

            for (const k of pool) {
                const st = PhaseRingGeometry.stats(this.series[k]!.values);
                lo = Math.min(lo, st.min);
                hi = Math.max(hi, st.max);
            }
            if (!(hi > lo)) {
                hi = lo + 1;
            }

            return {lo, hi, base: this.base(this.series[i]!.values)};
        };

        // layout
        const legendH = this.legend === false ? 0 : 78;
        const pad = 14;
        const t = this.tilt * Math.PI / 180 * (this.rings().length > 1 ? 0.7 : 1);    // stacked rings look flatter so more fit
        const yaw = this.yaw * Math.PI / 180;
        const n = rings.length;
        const hasOrbit = this.glyphs > 0;
        const st = Math.sin(t);
        // height budget in units of rx: orbit (2 ry + glyph), then n rings of (ry + their swing) overlapping a little
        const ringUnit = n === 1 ? 2 * st + 0.44 : 1.15 * st + 0.3;
        const avail = H - legendH - 2 * pad - 18;
        const rx = Math.max(40, Math.min(W * 0.36, avail / ((hasOrbit ? 2 * st + 0.12 : 0) + n * ringUnit)));
        const ry = rx * st;
        const gR = Math.max(5, Math.min(15, rx * 0.045));
        const orbitY = pad + gR + 4 + ry;
        const zoneTop = hasOrbit ? orbitY + ry + gR + 18 : pad;
        const zoneH = Math.max(40, H - legendH - pad - zoneTop);
        const slot = zoneH / n;
        const amp = n === 1 ? rx * 0.2 : Math.max(8, rx * 0.13);
        const lift = Math.cos(t);
        const cx = W / 2;
        const viewAt = (cy: number, scale = 1): RingView => ({cx, cy, rx: rx * scale, ry: ry * scale, lift, yaw});
        const orbit = viewAt(orbitY);
        const planes = rings.map((_, k) => zoneTop + slot * k + (n === 1 ? ry + amp + Math.max(0, zoneH - 2 * ry - 2 * amp) / 2 : slot / 2 + ry * 0.15));
        const views = planes.map((y) => viewAt(y));
        const heightOf = (i: number, v: number): number => {
            const r = range(i);
            return (v - r.base) / Math.max(1e-9, r.hi - r.base, r.base - r.lo) * amp;
        };
        const colorOf = (i: number, v: number): string => {
            const r = range(i);
            return PhaseRingGeometry.colorAt(this.colors, (v - r.lo) / (r.hi - r.lo));
        };
        const bins = (this.series[rings[0]!]?.values.length) ?? 0;
        const hot = this.pinnedBin ?? (this.hoverBin >= 0 ? this.hoverBin : null);
        const smoothed = rings.map((i) => PhaseRingGeometry.smooth(values[i]!, 10));
        const valueAtPhase = (k: number, phase: number): number => {
            const sm = smoothed[k]!;
            const idx = Math.min(sm.length - 1, Math.max(0, Math.round(phase * (sm.length - 1))));
            return sm[idx]!.value;
        };

        // drop lines from the glyphs through the rings
        if (hasOrbit) {
            for (let g = 0; g < this.glyphs; g++) {
                const ph = g / this.glyphs;
                const top = PhaseRingGeometry.point(orbit, ph);
                const bottom = PhaseRingGeometry.point(views[n - 1]!, ph, Math.min(0, heightOf(rings[n - 1]!, valueAtPhase(n - 1, ph))));
                const isHot = hot !== null && PhaseRingGeometry.binAt(ph, bins) === hot;
                ctx.strokeStyle = Color.withAlpha(colorOf(rings[0]!, valueAtPhase(0, ph)), isHot ? 0.9 : 0.35);
                ctx.lineWidth = isHot ? 1.5 : 0.8;
                ctx.beginPath();
                ctx.moveTo(top.x, top.y);
                ctx.lineTo(bottom.x, bottom.y);
                ctx.stroke();
            }
        }
        if (hot !== null && bins > 0 && (!hasOrbit || hot * this.glyphs % bins !== 0)) {
            const ph = hot / bins;
            const top = hasOrbit ? PhaseRingGeometry.point(orbit, ph) : PhaseRingGeometry.point(views[0]!, ph);
            const bottom = PhaseRingGeometry.point(views[n - 1]!, ph);
            ctx.strokeStyle = Color.withAlpha(theme.select, 0.6);
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(top.x, top.y);
            ctx.lineTo(bottom.x, bottom.y);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // rings, bottom first (the higher ones are nearer to the eye)
        for (let k = n - 1; k >= 0; k--) {
            this.drawRing(ctx, k, rings[k]!, views[k]!, smoothed[k]!, values[rings[k]!]!, range(rings[k]!), heightOf, colorOf, amp, hot, n > 1);
        }

        if (this.arrows) {
            this.drawArrows(ctx, viewAt(planes[0]!, 1.1));
        }
        if (hasOrbit) {
            this.drawOrbit(ctx, orbit, gR, rings[0]!, valueAtPhase, colorOf, bins, hot);
        }
        this.drawCursor(ctx, hasOrbit ? orbit : views[0]!, views[n - 1]!, gR);
        this.drawNotes(ctx, rings, views, values, heightOf, bins);
        if (this.legend !== false) {
            this.drawLegend(ctx, this.legend, pad, H - legendH + 6);
        }
        this.drawTooltip(ctx, values, bins);

        return animating;
    }

    private drawRing(ctx: CanvasRenderingContext2D, k: number, series: number, view: RingView,
        smooth: ReadonlyArray<{phase: number; value: number}>, values: ReadonlyArray<number>,
        r: {lo: number; hi: number; base: number}, heightOf: (i: number, v: number) => number,
        colorOf: (i: number, v: number) => string, amp: number, hot: number | null, labelled: boolean): void {
        const {theme} = this;
        const pts: (RingPoint & {h: number; v: number})[] = smooth.map((s) => {
            const h = heightOf(series, s.value);
            return {...PhaseRingGeometry.point(view, s.phase, h), h, v: s.value};
        });
        const segs = pts.slice(1).map((b, i) => ({a: pts[i]!, b, depth: (pts[i]!.depth + b.depth) / 2, below: (pts[i]!.h + b.h) / 2 < 0}));
        const stroke = (list: typeof segs): void => {
            list.sort((u, v) => u.depth - v.depth);
            ctx.lineCap = 'round';
            for (const s of list) {
                ctx.strokeStyle = colorOf(series, (s.a.v + s.b.v) / 2);
                ctx.lineWidth = 2.2 + 1.6 * (s.depth + 1) / 2;
                ctx.beginPath();
                ctx.moveTo(s.a.x, s.a.y);
                ctx.lineTo(s.b.x, s.b.y);
                ctx.stroke();
            }
        };
        const ellipse = (h: number): void => {
            ctx.beginPath();
            ctx.ellipse(view.cx, view.cy - h * view.lift, view.rx, view.ry, 0, 0, Math.PI * 2);
        };

        // guide rings at the lowest and highest value, then the curve under the disk, the disk, the curve over it
        ctx.lineWidth = 1;
        ctx.strokeStyle = Color.withAlpha(theme.text, 0.18);
        ellipse(heightOf(series, r.lo));
        ctx.stroke();
        ellipse(heightOf(series, r.hi));
        ctx.stroke();
        stroke(segs.filter((s) => s.below));
        ellipse(0);
        ctx.fillStyle = Color.withAlpha(theme.text, 0.14);
        ctx.fill();
        ctx.strokeStyle = Color.withAlpha(theme.title, 0.55);
        ctx.stroke();
        stroke(segs.filter((s) => !s.below));

        // hit points + the hovered bin
        values.forEach((v, bin) => {
            const p = PhaseRingGeometry.point(view, bin / values.length, heightOf(series, v));
            this.hits.push({x: p.x, y: p.y, series, bin});
            if (bin === hot) {
                ctx.fillStyle = colorOf(series, v);
                ctx.strokeStyle = theme.select;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        });

        ctx.font = `10px ${ChartSurface.FONT_FAMILY}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillStyle = Color.withAlpha(theme.text, 0.85);
        const right = view.cx + view.rx + 8;
        if (!labelled || k === 0) {
            ctx.fillText(this.format(r.hi), right, view.cy - heightOf(series, r.hi) * view.lift);
            ctx.fillText(this.format(r.lo), right, view.cy - heightOf(series, r.lo) * view.lift);
        }
        if (labelled) {
            ctx.font = `600 12px ${ChartSurface.FONT_FAMILY}`;
            ctx.textAlign = 'right';
            ctx.fillStyle = this.series[series]!.name !== '' ? theme.title : theme.text;
            ctx.fillText(this.series[series]!.name, view.cx - view.rx - 12, view.cy);
        }
        void amp;
    }

    private drawOrbit(ctx: CanvasRenderingContext2D, orbit: RingView, gR: number, series: number,
        valueAtPhase: (k: number, phase: number) => number, colorOf: (i: number, v: number) => string, bins: number, hot: number | null): void {
        const {theme} = this;
        const N = 120;
        const seg = (front: boolean): void => {
            ctx.lineWidth = 1.5;
            for (let i = 0; i < N; i++) {
                const a = PhaseRingGeometry.point(orbit, i / N), b = PhaseRingGeometry.point(orbit, (i + 1) / N);
                if ((a.depth + b.depth >= 0) !== front) {
                    continue;
                }
                ctx.strokeStyle = colorOf(series, valueAtPhase(0, (i + 0.5) / N));
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }
        };
        const glyphs = Array.from({length: this.glyphs}, (_, g) => ({phase: g / this.glyphs, p: PhaseRingGeometry.point(orbit, g / this.glyphs)}));
        const drawGlyphs = (front: boolean): void => {
            for (const g of glyphs) {
                if ((g.p.depth >= 0) !== front) {
                    continue;
                }

                const bin = PhaseRingGeometry.binAt(g.phase, bins);
                const r = gR * (0.8 + 0.2 * (g.p.depth + 1) / 2) * (bin === hot ? 1.3 : 1);
                this.drawGlyph(ctx, g.p.x, g.p.y, r, g.phase);
                if (bin === hot) {
                    ctx.strokeStyle = theme.select;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(g.p.x, g.p.y, r + 3, 0, Math.PI * 2);
                    ctx.stroke();
                }
                this.hits.push({x: g.p.x, y: g.p.y, series: -1, bin});
            }
        };

        seg(false);
        drawGlyphs(false);
        if (this.center !== false) {
            const c = this.center ?? {};
            const r = (c.radius ?? 0.11) * orbit.rx;
            const grad = ctx.createRadialGradient(orbit.cx - r * 0.35, orbit.cy - r * 0.35, r * 0.1, orbit.cx, orbit.cy, r);
            const color = c.color ?? '#c8ccd2';
            grad.addColorStop(0, Color.lerp(color, '#ffffff', 0.35));
            grad.addColorStop(1, color);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(orbit.cx, orbit.cy, r, 0, Math.PI * 2);
            ctx.fill();
            if (c.label !== undefined) {
                ctx.font = `600 11px ${ChartSurface.FONT_FAMILY}`;
                ctx.fillStyle = theme.title;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(c.label, orbit.cx, orbit.cy + r + 4);
            }
        }
        seg(true);
        drawGlyphs(true);
    }

    private drawGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, phase: number): void {
        const g = this.glyph;

        if (typeof g === 'function') {
            g(ctx, x, y, r, phase);
            return;
        }
        if (g === 'dot') {
            ctx.fillStyle = this.theme.title;
            ctx.beginPath();
            ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        const tm = PhaseRingGeometry.terminator(phase);

        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = '#2e3136';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        if (tm.lit > 0.005) {
            ctx.fillStyle = '#e6e6e2';
            ctx.beginPath();
            ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, !tm.waxing);
            ctx.ellipse(0, 0, Math.abs(tm.mid) * r, r, 0, Math.PI / 2, -Math.PI / 2, tm.mid > 0);
            ctx.fill();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    private drawArrows(ctx: CanvasRenderingContext2D, view: RingView): void {
        ctx.strokeStyle = Color.withAlpha(this.theme.title, 0.85);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 1.5;
        for (const [a, b] of [[0.08, 0.16], [0.58, 0.66]] as const) {
            ctx.beginPath();
            for (let i = 0; i <= 12; i++) {
                const p = PhaseRingGeometry.point(view, a + (b - a) * i / 12);
                if (i === 0) {
                    ctx.moveTo(p.x, p.y);
                } else {
                    ctx.lineTo(p.x, p.y);
                }
            }
            ctx.stroke();

            const p1 = PhaseRingGeometry.point(view, b), p0 = PhaseRingGeometry.point(view, b - 0.01);
            const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
            ctx.beginPath();
            ctx.moveTo(p1.x + Math.cos(ang) * 6, p1.y + Math.sin(ang) * 6);
            ctx.lineTo(p1.x + Math.cos(ang + 2.5) * 6, p1.y + Math.sin(ang + 2.5) * 6);
            ctx.lineTo(p1.x + Math.cos(ang - 2.5) * 6, p1.y + Math.sin(ang - 2.5) * 6);
            ctx.closePath();
            ctx.fill();
        }
    }

    private drawCursor(ctx: CanvasRenderingContext2D, top: RingView, bottom: RingView, gR: number): void {
        if (this.cursor === null) {
            return;
        }

        const a = PhaseRingGeometry.point(top, this.cursor);
        const b = PhaseRingGeometry.point(bottom, this.cursor);
        const color = this.theme.marker;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y - gR - 3);
        ctx.lineTo(a.x - 5, a.y - gR - 11);
        ctx.lineTo(a.x + 5, a.y - gR - 11);
        ctx.closePath();
        ctx.fill();
        ctx.font = `600 11px ${ChartSurface.FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.cursorLabel, a.x + 8, a.y - gR - 8);
    }

    private drawNotes(ctx: CanvasRenderingContext2D, rings: number[], views: RingView[], values: number[][],
        heightOf: (i: number, v: number) => number, bins: number): void {
        ctx.font = `12px ${ChartSurface.FONT_FAMILY}`;
        ctx.textBaseline = 'middle';
        for (const note of this.notes) {
            const k = note.series === undefined ? 0 : rings.indexOf(note.series);
            const series = rings[k];

            if (k < 0 || series === undefined || bins === 0) {
                continue;
            }

            const v = values[series]![note.bin] ?? 0;
            const p = PhaseRingGeometry.point(views[k]!, note.bin / bins, heightOf(series, v));
            const side = p.x >= views[k]!.cx ? 1 : -1;
            const tx = p.x + side * 70;
            const ty = p.y + (p.depth > 0.2 ? 30 : -30);

            ctx.strokeStyle = Color.withAlpha(this.theme.title, 0.8);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(tx, ty);
            ctx.stroke();
            ctx.fillStyle = this.theme.title;
            ctx.textAlign = side > 0 ? 'left' : 'right';
            note.text.split('\n').forEach((line, i, all) => ctx.fillText(line, tx + side * 4, ty + (i - (all.length - 1) / 2) * 14));
        }
    }

    private drawLegend(ctx: CanvasRenderingContext2D, legend: PhaseLegend, x: number, y: number): void {
        const {theme} = this;
        const w = Math.min(260, this.width * 0.42);

        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = theme.title;
        ctx.font = `16px ${ChartSurface.FONT_FAMILY}`;
        ctx.fillText(legend.title ?? 'Value', x, y);
        ctx.font = `11px ${ChartSurface.FONT_FAMILY}`;
        ctx.fillStyle = theme.text;
        if (legend.subtitle !== undefined) {
            ctx.fillText(legend.subtitle, x, y + 20);
        }

        const by = y + 36;
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        this.colors.forEach((c, i) => g.addColorStop(i / Math.max(1, this.colors.length - 1), c));
        ctx.fillStyle = g;
        ctx.fillRect(x, by, w, 11);
        ctx.strokeStyle = Color.withAlpha(theme.title, 0.6);
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, by + 0.5, w - 1, 10);

        const ay = by + 20;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.4, ay);
        ctx.lineTo(x, ay);
        ctx.lineTo(x + 5, ay - 3);
        ctx.moveTo(x, ay);
        ctx.lineTo(x + 5, ay + 3);
        ctx.moveTo(x + w * 0.6, ay);
        ctx.lineTo(x + w, ay);
        ctx.lineTo(x + w - 5, ay - 3);
        ctx.moveTo(x + w, ay);
        ctx.lineTo(x + w - 5, ay + 3);
        ctx.stroke();
        ctx.fillStyle = theme.text;
        ctx.textBaseline = 'top';
        ctx.fillText(legend.low ?? 'less', x + 6, ay + 4);
        ctx.textAlign = 'right';
        ctx.fillText(legend.high ?? 'more', x + w - 6, ay + 4);
    }

    private drawTooltip(ctx: CanvasRenderingContext2D, values: number[][], bins: number): void {
        if (this.pointer === null || this.hoverBin < 0 || this.drag !== null) {
            return;
        }

        const lines = [this.phaseLabel(this.hoverBin, bins)];
        const shown = this.rings();

        for (const i of shown) {
            lines.push(`${this.series[i]!.name}: ${this.format(values[i]?.[this.hoverBin] ?? 0)}`);
        }

        ctx.save();
        ctx.font = `12px ${ChartSurface.FONT_FAMILY}`;
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18;
        const h = lines.length * 16 + 10;
        const x = Math.max(4, Math.min(this.width - w - 4, this.pointer.x + 14));
        const y = Math.max(4, Math.min(this.height - h - 4, this.pointer.y + 14));

        ctx.fillStyle = Color.withAlpha(this.theme.background, 0.94);
        ctx.strokeStyle = Color.withAlpha(this.theme.title, 0.5);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 6);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        lines.forEach((l, i) => {
            ctx.font = i === 0 ? `600 12px ${ChartSurface.FONT_FAMILY}` : `12px ${ChartSurface.FONT_FAMILY}`;
            ctx.fillStyle = i === 0 ? this.theme.title : this.theme.text;
            ctx.fillText(l, x + 9, y + 6 + i * 16);
        });
        ctx.restore();
    }

    // ---- input -----------------------------------------------------------------------------------------

    private payload(series: number, bin: number): PhaseHover {
        const bins = this.series[this.rings()[0] ?? 0]?.values.length ?? 0;

        return {
            series, bin, phase: bins > 0 ? bin / bins : 0,
            label: this.phaseLabel(bin, bins),
            values: this.series.map((s) => s.values[bin] ?? 0)
        };
    }

    private readonly onDown = (e: PointerEvent): void => {
        if (e.button !== 0) {
            return;
        }
        this.drag = {...this.local(e), yaw: this.yaw, tilt: this.tilt, moved: false};
        this.root.setPointerCapture(e.pointerId);
    };

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);

        this.pointer = p;
        if (this.drag !== null) {
            const dx = p.x - this.drag.x, dy = p.y - this.drag.y;

            if (Math.hypot(dx, dy) > 3) {
                this.drag.moved = true;
            }
            if (this.drag.moved && this.rotate) {
                this.yaw = this.drag.yaw + dx * 0.5;
                this.tilt = Math.max(8, Math.min(70, this.drag.tilt - dy * 0.25));
                this.root.style.cursor = 'grabbing';
                this.redraw();
                return;
            }
        }

        const i = PhaseRingGeometry.nearest(this.hits, p.x, p.y, 14);
        const hit = this.hits[i];
        const bin = hit?.bin ?? -1;
        const series = hit?.series ?? -2;

        if (bin !== this.hoverBin || series !== this.hoverSeries) {
            this.hoverBin = bin;
            this.hoverSeries = series;
            this.events.emit('hover', hit === undefined ? null : this.payload(series, bin));
        }
        this.root.style.cursor = hit !== undefined ? 'pointer' : this.rotate ? 'grab' : '';
        this.redraw();
    };

    private readonly onUp = (e: PointerEvent): void => {
        const d = this.drag;

        this.drag = null;
        this.root.style.cursor = '';
        if (this.root.hasPointerCapture(e.pointerId)) {
            this.root.releasePointerCapture(e.pointerId);
        }
        if (d !== null && !d.moved && e.type === 'pointerup' && this.hoverBin >= 0) {
            this.events.emit('click', this.payload(this.hoverSeries, this.hoverBin));
        }
    };

    private readonly onLeave = (): void => {
        this.pointer = null;
        if (this.hoverBin >= 0) {
            this.hoverBin = -1;
            this.hoverSeries = -2;
            this.events.emit('hover', null);
        }
        this.redraw();
    };

    private readonly onDblClick = (): void => {
        this.resetView();
    };

    private static copySeries(series: readonly PhaseSeries[]): PhaseSeries[] {
        return series.map((s) => ({...s, values: s.values.slice()}));
    }

}
