import { Color } from '../util/Color';
import { ChartRange, ChartScale } from './ChartScale';
import { ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import {
    StreamData, StreamLayer, StreamLayout, StreamLayoutOptions, StreamOffset, StreamOrder, StreamResult
} from './StreamLayout';

/** A vertical guide line with a label above the panels (e.g. "Ep. 50"). */
export interface StreamMark {
    x: number;
    label?: string;
}

/** A note box pinned to a spot in a panel. */
export interface StreamAnnotation {
    /** Panel index or id. */
    panel: number | string;
    x: number;
    /** Panel value the note points at (default: the stack's top at x). */
    y?: number;
    /** Text; `**bold**` is bold, `\n` breaks. */
    text: string;
    /** Border / bold colour (default the theme's title colour). */
    color?: string;
    /** Box offset from the anchor in px (default 14, -14 → up-right). */
    dx?: number;
    dy?: number;
    /** Box width in px (default 150). */
    width?: number;
}

export interface StreamChartOptions {
    data?: StreamData;
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
    /** Layout: offset, order, bandwidth, taper, resolution. */
    layout?: Omit<StreamLayoutOptions, 'hidden'>;
    /** One y scale for all panels, panel height ∝ its range (default true); false: equal heights, own scales. */
    sharedScale?: boolean;
    /** Space between panels in px (default 14). */
    panelGap?: number;
    /** Room for the panel labels on the left in px (default 110; 0 hides them). */
    labelWidth?: number;
    marks?: StreamMark[];
    annotations?: StreamAnnotation[];
    /** Edge between layers: a colour, or false (default: the background colour). */
    outline?: string | false;
    /** DOM legend at the bottom, grouped by `layer.group` (default true). */
    legend?: boolean;
    /** Wheel zooms the x axis, drag pans, double-click resets (default true). */
    zoom?: boolean;
    /** Morph to new layouts (default true). */
    animate?: boolean;
    /** Value text in the tooltip (default: rounded to 1 decimal). */
    format?: (value: number) => string;
    /** x text in the tooltip (default: the number). */
    xFormat?: (x: number) => string;
}

export interface StreamChartEvents extends Record<string, unknown> {
    /** Layer under the pointer with the raw value at the nearest data x, or null. */
    hover: {layer: StreamLayer; panel: number; x: number; value: number} | null;
    layerClick: {layer: StreamLayer; panel: number; x: number};
    /** A legend entry toggled its layers. */
    toggle: {layers: string[]; visible: boolean};
    rangeChange: ChartRange;
}

interface PanelBox {
    top: number;
    height: number;
    min: number;
    max: number;
}

/**
 * Streamgraph with small multiples: layers flow around a centre line (or a
 * least-wiggle baseline), smoothed so they swell and taper, the same layers
 * repeated in several panels on one x axis and — by default — one y scale.
 * Guide marks, pinned note boxes, a grouped legend that toggles layers,
 * hover highlight with values, x zoom, morphing between layouts. Canvas +
 * DOM legend/notes, zero dependencies.
 *
 *     const chart = new StreamChart(el, {data: {x, layers, panels}});
 *     chart.setOffset('wiggle');
 */
export class StreamChart extends ChartSurface<StreamChartEvents> {

    private static readonly PALETTE = ['#f6a91b', '#e8213c', '#27a9e6', '#c01fc4', '#5a5a52', '#3fb37f', '#7b61ff', '#ff7a45'];
    private static readonly TOP_MARKS = 34;
    private static readonly TOP_PLAIN = 10;
    private static readonly RIGHT = 16;
    private static readonly MORPH_MS = 450;

    private data: StreamData = {x: [], layers: [], panels: []};
    private layoutOptions: Omit<StreamLayoutOptions, 'hidden'>;
    private readonly hidden = new Set<string>();
    private result: StreamResult | null = null;
    private previous: StreamResult | null = null;
    private morphStart = -1;
    private sharedScale: boolean;
    private readonly panelGap: number;
    private readonly labelWidth: number;
    private marks: StreamMark[];
    private annotations: StreamAnnotation[];
    private readonly outline: string | false | undefined;
    private readonly zoomOn: boolean;
    private readonly animate: boolean;
    private readonly format: (v: number) => string;
    private readonly xFormat: (x: number) => string;
    private readonly legendEl: HTMLDivElement | null;
    private readonly notesEl: HTMLDivElement;
    private range: ChartRange | null = null;
    private boxes: PanelBox[] = [];
    private hovered: {layer: number; panel: number} | null = null;
    private highlighted: Set<string> | null = null;
    private pointer: {x: number; y: number} | null = null;
    private press: {x: number; range: ChartRange; moved: boolean} | null = null;

    public constructor(container: HTMLElement, options: StreamChartOptions = {}) {
        super(container, options.theme);
        this.layoutOptions = {...options.layout};
        this.sharedScale = options.sharedScale ?? true;
        this.panelGap = options.panelGap ?? 14;
        this.labelWidth = options.labelWidth ?? 110;
        this.marks = (options.marks ?? []).map((m) => ({...m}));
        this.annotations = (options.annotations ?? []).map((a) => ({...a}));
        this.outline = options.outline;
        this.zoomOn = options.zoom ?? true;
        this.animate = options.animate ?? true;
        this.format = options.format ?? ((v) => String(Math.round(v * 10) / 10));
        this.xFormat = options.xFormat ?? ((x) => String(Math.round(x * 100) / 100));

        this.notesEl = document.createElement('div');
        this.notesEl.style.cssText = 'position:absolute;inset:0;pointer-events:none';
        this.root.appendChild(this.notesEl);

        if (options.legend ?? true) {
            this.legendEl = document.createElement('div');
            this.legendEl.style.cssText = 'position:absolute;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:6px 14px;'
                + 'justify-content:center;padding:8px 10px';
            this.root.appendChild(this.legendEl);
        } else {
            this.legendEl = null;
        }

        this.root.addEventListener('pointerdown', this.onDown);
        this.root.addEventListener('pointermove', this.onMove);
        this.root.addEventListener('pointerup', this.onUp);
        this.root.addEventListener('pointercancel', this.onUp);
        this.root.addEventListener('pointerleave', this.onLeave);
        this.root.addEventListener('wheel', this.onWheel, {passive: false});
        this.root.addEventListener('dblclick', this.onDblClick);

        this.setData(options.data ?? this.data, false);
    }

    /** New data; morphs when the x positions and layers are unchanged. */
    public setData(data: StreamData, animate = this.animate): void {
        const sameShape = data.x.length === this.data.x.length && data.layers.length === this.data.layers.length
            && data.panels.length === this.data.panels.length;

        this.data = StreamChart.copyData(data);
        for (const id of Array.from(this.hidden)) {
            if (!data.layers.some((l) => l.id === id)) {
                this.hidden.delete(id);
            }
        }
        if (!sameShape) {
            this.range = null;
        }
        this.relayout(animate && sameShape);
        this.buildLegend();
        this.buildNotes();
    }

    /** A copy of the current data. */
    public getData(): StreamData {
        return StreamChart.copyData(this.data);
    }

    /** A copy of the current layout (null before the first data). */
    public getLayout(): StreamResult | null {
        return this.result === null ? null : structuredClone(this.result);
    }

    public setOffset(offset: StreamOffset): void {
        this.layoutOptions = {...this.layoutOptions, offset};
        this.relayout(this.animate);
    }

    public setOrder(order: StreamOrder): void {
        this.layoutOptions = {...this.layoutOptions, order};
        this.relayout(this.animate);
    }

    /** Smoothing bandwidth in x units (0 = none). */
    public setBandwidth(bandwidth: number): void {
        this.layoutOptions = {...this.layoutOptions, bandwidth};
        this.relayout(false);
    }

    public setSharedScale(shared: boolean): void {
        this.sharedScale = shared;
        this.redraw();
    }

    /** Show or hide layers (the others close the gap, animated). */
    public setLayerVisible(ids: string | string[], visible: boolean): void {
        for (const id of Array.isArray(ids) ? ids : [ids]) {
            if (visible) {
                this.hidden.delete(id);
            } else {
                this.hidden.add(id);
            }
        }
        this.relayout(this.animate);
        this.syncLegend();
    }

    public isLayerVisible(id: string): boolean {
        return !this.hidden.has(id);
    }

    /** Emphasise these layers, dim the rest (null clears). */
    public highlight(ids: string[] | null): void {
        this.highlighted = ids === null || ids.length === 0 ? null : new Set(ids);
        this.syncLegend();
        this.redraw();
    }

    public setMarks(marks: StreamMark[]): void {
        this.marks = marks.map((m) => ({...m}));
        this.redraw();
    }

    public setAnnotations(annotations: StreamAnnotation[]): void {
        this.annotations = annotations.map((a) => ({...a}));
        this.buildNotes();
        this.redraw();
    }

    /** Visible x range (null = everything). */
    public setRange(range: ChartRange | null): void {
        this.range = range === null ? null : {...range};
        this.redraw();
        this.events.emit('rangeChange', this.viewRange());
    }

    /** Show the whole x extent again. */
    public resetView(): void {
        this.setRange(null);
    }

    /** @deprecated use resetView */
    public resetZoom(): void {
        this.resetView();
    }

    public override destroy(): void {
        this.root.removeEventListener('pointerdown', this.onDown);
        this.root.removeEventListener('pointermove', this.onMove);
        this.root.removeEventListener('pointerup', this.onUp);
        this.root.removeEventListener('pointercancel', this.onUp);
        this.root.removeEventListener('pointerleave', this.onLeave);
        this.root.removeEventListener('wheel', this.onWheel);
        this.root.removeEventListener('dblclick', this.onDblClick);
        super.destroy();
    }

    protected override themeChanged(): void {
        this.buildLegend();
        this.buildNotes();
    }

    /** Data copy: arrays and the objects in them, panel values per layer. */
    private static copyData(data: StreamData): StreamData {
        return {
            x: Array.from(data.x),
            layers: data.layers.map((l) => ({...l})),
            panels: data.panels.map((p) => ({...p, values: p.values.map((v) => Array.from(v))}))
        };
    }

    // ---- layout ----------------------------------------------------------

    private relayout(animate: boolean): void {
        const next = new StreamLayout({...this.layoutOptions, hidden: this.hidden}).layout(this.data);
        const morph = animate && this.result !== null && this.result.xs.length === next.xs.length
            && this.result.panels.length === next.panels.length;

        this.previous = morph ? this.current() : null;
        this.morphStart = morph ? -2 : -1;
        this.result = next;
        this.redraw();
    }

    /** The picture as drawn right now (mid-morph included) — the start of the next morph. */
    private current(): StreamResult | null {
        const r = this.result;
        const p = this.previous;

        if (r === null || p === null || this.morphStart < 0) {
            return r;
        }

        const t = this.morphT(performance.now());

        return StreamChart.mix(p, r, t);
    }

    private morphT(now: number): number {
        if (this.morphStart < 0) {
            return 1;
        }

        const t = Math.min(1, (now - this.morphStart) / StreamChart.MORPH_MS);

        return 1 - ((1 - t) ** 3);
    }

    private static mix(a: StreamResult, b: StreamResult, t: number): StreamResult {
        const lerp = (x: Float64Array, y: Float64Array): Float64Array => {
            const out = new Float64Array(y.length);
            for (let i = 0; i < y.length; i++) {
                out[i] = (x[i] ?? 0) + (((y[i] ?? 0) - (x[i] ?? 0)) * t);
            }
            return out;
        };

        return {
            xs: b.xs,
            order: b.order,
            domain: b.domain,
            panels: b.panels.map((p, i) => {
                const q = a.panels[i]!;
                return {
                    lower: p.lower.map((l, k) => lerp(q.lower[k] ?? l, l)),
                    upper: p.upper.map((u, k) => lerp(q.upper[k] ?? u, u)),
                    value: p.value,
                    min: q.min + ((p.min - q.min) * t),
                    max: q.max + ((p.max - q.max) * t)
                };
            })
        };
    }

    private viewRange(): ChartRange {
        return this.range ?? (this.result?.domain ?? {min: 0, max: 1});
    }

    private plotLeft(): number {
        return this.labelWidth;
    }

    private plotRight(): number {
        return this.width - StreamChart.RIGHT;
    }

    private sx(x: number): number {
        return ChartScale.toPx(x, this.viewRange(), this.plotLeft(), this.plotRight());
    }

    private legendHeight(): number {
        return this.legendEl?.offsetHeight ?? 0;
    }

    /** Panel rectangles and their y ranges. */
    private computeBoxes(r: StreamResult): PanelBox[] {
        const top = this.marks.length > 0 ? StreamChart.TOP_MARKS : StreamChart.TOP_PLAIN;
        const bottom = this.height - this.legendHeight() - 6;
        const n = r.panels.length;
        const avail = Math.max(10, bottom - top - (this.panelGap * Math.max(0, n - 1)));
        const boxes: PanelBox[] = [];
        let y = top;

        if (this.sharedScale) {
            const spans = r.panels.map((p) => Math.max(1e-9, p.max - p.min));
            const total = spans.reduce((a, b) => a + b, 0);
            const minH = Math.min(24, avail / Math.max(1, n));
            // panels too thin for their share get minH; the rest shares what is left, same scale
            const k = (avail - (minH * n)) / total;

            r.panels.forEach((p, i) => {
                const h = minH + (spans[i]! * Math.max(0, k));
                const extra = (h - (spans[i]! * Math.max(0, k))) / 2;
                const unit = Math.max(0, k) || (h / spans[i]!);
                boxes.push({top: y, height: h, min: p.min - (extra / unit), max: p.max + (extra / unit)});
                y += h + this.panelGap;
            });
        } else {
            const h = avail / Math.max(1, n);
            r.panels.forEach((p) => {
                boxes.push({top: y, height: h, min: p.min, max: p.max});
                y += h + this.panelGap;
            });
        }

        return boxes;
    }

    private sy(box: PanelBox, v: number): number {
        return box.top + box.height - (((v - box.min) / (box.max - box.min)) * box.height);
    }

    private color(layer: StreamLayer, i: number): string {
        return layer.color ?? StreamChart.PALETTE[i % StreamChart.PALETTE.length]!;
    }

    // ---- drawing ---------------------------------------------------------

    protected draw(ctx: CanvasRenderingContext2D, timeMs: number): boolean {
        if (this.morphStart === -2) {
            this.morphStart = timeMs;
        }

        const t = this.morphT(timeMs);
        const r = this.result === null ? null : this.previous !== null && t < 1 ? StreamChart.mix(this.previous, this.result, t) : this.result;

        if (r === null) {
            return false;
        }

        this.boxes = this.computeBoxes(r);

        const left = this.plotLeft();
        const right = this.plotRight();
        const view = this.viewRange();
        const s0 = Math.max(0, Math.floor(StreamLayout.sampleAt(r.xs, view.min)) - 1);
        const s1 = Math.min(r.xs.length - 1, Math.ceil(StreamLayout.sampleAt(r.xs, view.max)) + 1);
        const outline = this.outline === undefined ? this.theme.background : this.outline;
        let focus = this.highlighted ?? (this.hovered !== null ? new Set([this.data.layers[this.hovered.layer]?.id ?? '']) : null);

        // emphasising only hidden layers (pointer still on a legend entry just switched off) dims nothing
        if (focus !== null && Array.from(focus).every((id) => this.hidden.has(id))) {
            focus = null;
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(left, 0, right - left, this.height);
        ctx.clip();

        r.panels.forEach((p, pi) => {
            const box = this.boxes[pi]!;

            for (const li of r.order) {
                const layer = this.data.layers[li]!;

                if (this.hidden.has(layer.id) && this.morphStart < 0) {
                    continue;
                }

                const path = new Path2D();
                const lo = p.lower[li]!;
                const hi = p.upper[li]!;

                for (let s = s0; s <= s1; s++) {
                    const x = this.sx(r.xs[s]!);
                    const y = this.sy(box, hi[s]!);
                    if (s === s0) {
                        path.moveTo(x, y);
                    } else {
                        path.lineTo(x, y);
                    }
                }
                for (let s = s1; s >= s0; s--) {
                    path.lineTo(this.sx(r.xs[s]!), this.sy(box, lo[s]!));
                }
                path.closePath();

                ctx.globalAlpha = focus !== null && !focus.has(layer.id) ? 0.22 : 1;
                ctx.fillStyle = this.color(layer, li);
                ctx.fill(path);
                if (outline !== false) {
                    ctx.strokeStyle = outline;
                    ctx.lineWidth = 0.8;
                    ctx.lineJoin = 'round';
                    ctx.stroke(path);
                }
            }
            ctx.globalAlpha = 1;

            // the outer silhouette gets a stronger outline, like a cut-out
            if (outline !== false && r.order.length > 0) {
                const first = r.order[0]!;
                const last = r.order[r.order.length - 1]!;
                const edge = new Path2D();

                for (let s = s0; s <= s1; s++) {
                    const x = this.sx(r.xs[s]!);
                    const y = this.sy(box, p.upper[last]![s]!);
                    if (s === s0) {
                        edge.moveTo(x, y);
                    } else {
                        edge.lineTo(x, y);
                    }
                }
                for (let s = s0; s <= s1; s++) {
                    const x = this.sx(r.xs[s]!);
                    const y = this.sy(box, p.lower[first]![s]!);
                    if (s === s0) {
                        edge.moveTo(x, y);
                    } else {
                        edge.lineTo(x, y);
                    }
                }
                ctx.strokeStyle = outline;
                ctx.lineWidth = 1.8;
                ctx.stroke(edge);
            }
        });

        this.drawMarks(ctx, r);
        ctx.restore();

        this.drawPanelLabels(ctx);
        this.drawHover(ctx, r);
        this.placeNotes(r);

        if (t < 1) {
            return true;
        }
        if (this.previous !== null) {
            this.previous = null;
            this.morphStart = -1;
        }

        return false;
    }

    private drawMarks(ctx: CanvasRenderingContext2D, r: StreamResult): void {
        if (this.marks.length === 0) {
            return;
        }

        ctx.save();
        ctx.font = ChartSurface.FONT;
        ctx.textAlign = 'center';
        for (const m of this.marks) {
            const x = Math.round(this.sx(m.x)) + 0.5;

            ctx.strokeStyle = Color.withAlpha(this.theme.title, 0.5);
            ctx.setLineDash([1.5, 3]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            this.boxes.forEach((box, pi) => {
                const p = r.panels[pi]!;
                const f = StreamLayout.sampleAt(r.xs, m.x);
                let lo = Infinity;
                let hi = -Infinity;

                for (const li of r.order) {
                    lo = Math.min(lo, StreamLayout.at(p.lower[li]!, f));
                    hi = Math.max(hi, StreamLayout.at(p.upper[li]!, f));
                }
                if (hi > lo) {
                    ctx.moveTo(x, this.sy(box, hi));
                    ctx.lineTo(x, this.sy(box, lo));
                }
            });
            ctx.stroke();
            ctx.setLineDash([]);

            if (m.label !== undefined) {
                ctx.fillStyle = this.theme.text;
                ctx.textBaseline = 'top';
                m.label.split('\n').forEach((line, i) => ctx.fillText(line, x, 4 + (i * 13)));
            }
        }
        ctx.restore();
    }

    private drawPanelLabels(ctx: CanvasRenderingContext2D): void {
        if (this.labelWidth <= 0) {
            return;
        }

        ctx.save();
        ctx.fillStyle = this.theme.title;
        ctx.font = `700 13px system-ui, -apple-system, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        this.data.panels.forEach((panel, i) => {
            const box = this.boxes[i];

            if (panel.label === undefined || box === undefined) {
                return;
            }

            const lines = panel.label.split('\n');
            const mid = this.sy(box, 0) + 12;

            lines.forEach((line, k) => ctx.fillText(line, 12, Math.min(box.top + box.height, mid) + ((k - ((lines.length - 1) / 2)) * 16)));
        });
        ctx.restore();
    }

    private drawHover(ctx: CanvasRenderingContext2D, r: StreamResult): void {
        const h = this.hovered;
        const at = this.pointer;

        if (h === null || at === null) {
            return;
        }

        const layer = this.data.layers[h.layer];
        const box = this.boxes[h.panel];

        if (layer === undefined || box === undefined) {
            return;
        }

        const xv = ChartScale.fromPx(at.x, this.viewRange(), this.plotLeft(), this.plotRight());
        const idx = StreamLayout.nearest(this.data.x, xv);
        const raw = this.data.panels[h.panel]?.values[h.layer]?.[idx] ?? 0;
        const dx = this.data.x[idx] ?? xv;
        const p = r.panels[h.panel]!;
        const f = StreamLayout.sampleAt(r.xs, dx);
        const cx = this.sx(dx);

        // guide at the data x
        ctx.save();
        ctx.strokeStyle = this.theme.select;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(cx) + 0.5, this.sy(box, StreamLayout.at(p.upper[h.layer]!, f)));
        ctx.lineTo(Math.round(cx) + 0.5, this.sy(box, StreamLayout.at(p.lower[h.layer]!, f)));
        ctx.stroke();
        ctx.globalAlpha = 1;

        const panelLabel = this.data.panels[h.panel]?.label?.replace(/\n/g, ' ');
        const text = `${layer.label} · ${this.xFormat(dx)} · ${this.format(raw)}${panelLabel !== undefined ? ` (${panelLabel})` : ''}`;

        ctx.font = `600 ${ChartSurface.FONT}`;

        const w = ctx.measureText(text).width + 22;
        const x = Math.min(this.width - w - 4, at.x + 14);
        const y = Math.max(4, at.y - 32);

        ctx.beginPath();
        ctx.roundRect(x, y, w, 22, 5);
        ctx.fillStyle = Color.withAlpha(this.theme.background, 0.95);
        ctx.fill();
        ctx.strokeStyle = this.color(layer, h.layer);
        ctx.stroke();
        ctx.fillStyle = this.color(layer, h.layer);
        ctx.fillRect(x + 7, y + 7, 8, 8);
        ctx.fillStyle = this.theme.title;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 19, y + 11.5);
        ctx.restore();
    }

    // ---- notes -----------------------------------------------------------

    private buildNotes(): void {
        this.notesEl.replaceChildren();

        for (const a of this.annotations) {
            const box = document.createElement('div');
            const color = a.color ?? this.theme.title;

            box.style.cssText = `position:absolute;width:${a.width ?? 150}px;padding:6px 8px;border:1px solid ${color};`
                + `border-radius:6px;background:${Color.withAlpha(this.theme.background, 0.88)};color:${color};`
                + 'font:11px/1.35 system-ui,-apple-system,sans-serif;white-space:pre-line';
            for (const [i, part] of a.text.split('**').entries()) {
                if (i % 2 === 1) {
                    const b = document.createElement('b');
                    b.textContent = part;
                    box.appendChild(b);
                } else {
                    box.appendChild(document.createTextNode(part));
                }
            }
            this.notesEl.appendChild(box);
        }
    }

    private placeNotes(r: StreamResult): void {
        const view = this.viewRange();

        this.annotations.forEach((a, i) => {
            const el = this.notesEl.children[i] as HTMLElement | undefined;
            const pi = typeof a.panel === 'number' ? a.panel : this.data.panels.findIndex((p) => p.id === a.panel);
            const box = this.boxes[pi];
            const p = r.panels[pi];

            if (el === undefined) {
                return;
            }
            if (box === undefined || p === undefined || a.x < view.min || a.x > view.max) {
                el.style.display = 'none';
                return;
            }

            let y = a.y;

            if (y === undefined) {
                const f = StreamLayout.sampleAt(r.xs, a.x);
                y = -Infinity;
                for (const li of r.order) {
                    y = Math.max(y, StreamLayout.at(p.upper[li]!, f));
                }
            }

            const ax = this.sx(a.x);
            const ay = this.sy(box, y);
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            const dx = a.dx ?? 14;
            const dy = a.dy ?? -14;
            const left = Math.max(2, Math.min(this.width - w - 2, dx >= 0 ? ax + dx : ax + dx - w));
            // never over the mark labels at the top
            const ceiling = this.marks.length > 0 ? StreamChart.TOP_MARKS : 2;
            const top = Math.max(ceiling, Math.min(this.height - this.legendHeight() - h - 2, dy <= 0 ? ay + dy - h : ay + dy));

            el.style.display = 'block';
            el.style.left = `${left}px`;
            el.style.top = `${top}px`;
        });
    }

    // ---- legend ----------------------------------------------------------

    /** Legend entries: layers grouped by `group` (ungrouped layers stand alone), in data order. */
    private legendGroups(): {key: string; layers: number[]}[] {
        const groups: {key: string; layers: number[]}[] = [];

        this.data.layers.forEach((l, i) => {
            const key = l.group ?? `\u0000${l.id}`;
            const g = groups.find((x) => x.key === key);

            if (g === undefined) {
                groups.push({key, layers: [i]});
            } else {
                g.layers.push(i);
            }
        });

        return groups;
    }

    private buildLegend(): void {
        const el = this.legendEl;

        if (el === null) {
            return;
        }

        el.replaceChildren();
        for (const g of this.legendGroups()) {
            const ids = g.layers.map((i) => this.data.layers[i]!.id);
            const item = document.createElement('button');
            const swatch = document.createElement('span');
            const labels = document.createElement('span');

            item.type = 'button';
            item.dataset['layers'] = ids.join('\u0001');
            item.style.cssText = 'display:inline-flex;align-items:center;gap:7px;border:0;background:transparent;padding:2px 4px;'
                + `color:${this.theme.text};font:11px/1.25 system-ui,-apple-system,sans-serif;cursor:pointer;text-align:left;`
                + 'transition:opacity .15s';
            swatch.style.cssText = 'display:inline-flex;flex-direction:column;width:26px;border-radius:2px;overflow:hidden';
            labels.style.cssText = 'display:inline-flex;flex-direction:column';

            for (const i of g.layers) {
                const layer = this.data.layers[i]!;
                const s = document.createElement('span');
                const t = document.createElement('span');

                s.style.cssText = `display:block;height:${g.layers.length > 1 ? 7 : 10}px;background:${this.color(layer, i)}`;
                t.textContent = layer.label;
                swatch.appendChild(s);
                labels.appendChild(t);
            }
            item.append(swatch, labels);
            item.addEventListener('pointerenter', () => this.highlight(ids));
            item.addEventListener('pointerleave', () => this.highlight(null));
            item.addEventListener('pointerdown', (e) => e.stopPropagation());
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const visible = ids.every((id) => this.hidden.has(id));
                this.setLayerVisible(ids, visible);
                this.events.emit('toggle', {layers: ids, visible});
            });
            el.appendChild(item);
        }
        this.syncLegend();
    }

    private syncLegend(): void {
        const el = this.legendEl;

        if (el === null) {
            return;
        }

        for (const item of Array.from(el.children) as HTMLElement[]) {
            const ids = (item.dataset['layers'] ?? '').split('\u0001');
            const off = ids.every((id) => this.hidden.has(id));
            const dim = this.highlighted !== null && !ids.some((id) => this.highlighted!.has(id));

            item.style.opacity = off ? '0.3' : dim ? '0.55' : '1';
            item.style.textDecoration = off ? 'line-through' : 'none';
        }
    }

    // ---- interaction -----------------------------------------------------

    private hitAt(px: number, py: number): {layer: number; panel: number} | null {
        const r = this.result;

        if (r === null || px < this.plotLeft() || px > this.plotRight()) {
            return null;
        }

        const x = ChartScale.fromPx(px, this.viewRange(), this.plotLeft(), this.plotRight());

        for (let pi = 0; pi < this.boxes.length; pi++) {
            const box = this.boxes[pi]!;

            if (py < box.top || py > box.top + box.height) {
                continue;
            }

            const y = box.min + (((box.top + box.height - py) / box.height) * (box.max - box.min));
            const li = StreamLayout.layerAt(r, pi, x, y);

            if (li >= 0 && !this.hidden.has(this.data.layers[li]!.id)) {
                return {layer: li, panel: pi};
            }
        }

        return null;
    }

    private readonly onDown = (e: PointerEvent): void => {
        if (e.button !== 0) {
            return;
        }
        this.press = {x: e.clientX, range: this.viewRange(), moved: false};
    };

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);

        if (this.press !== null && this.zoomOn && this.result !== null) {
            const dxPx = e.clientX - this.press.x;

            if (Math.abs(dxPx) > 3 || this.press.moved) {
                if (!this.press.moved) {
                    this.root.setPointerCapture(e.pointerId);
                }
                this.press.moved = true;

                const span = this.press.range.max - this.press.range.min;
                const shift = -dxPx / Math.max(1, this.plotRight() - this.plotLeft()) * span;

                this.range = ChartScale.pan(this.press.range, shift, this.result.domain);
                this.hovered = null;
                this.redraw();
                this.events.emit('rangeChange', this.viewRange());
                return;
            }
        }

        if (p.y > this.height - this.legendHeight()) {
            this.onLeave();
            return;
        }

        const hit = this.hitAt(p.x, p.y);
        const changed = hit?.layer !== this.hovered?.layer || hit?.panel !== this.hovered?.panel;

        this.hovered = hit;
        this.pointer = p;
        this.root.style.cursor = hit !== null ? 'pointer' : (this.zoomOn ? 'grab' : 'default');
        this.redraw();

        if (changed) {
            this.emitHover(p.x);
        }
    };

    private emitHover(px: number): void {
        const h = this.hovered;

        if (h === null) {
            this.events.emit('hover', null);
            return;
        }

        const xv = ChartScale.fromPx(px, this.viewRange(), this.plotLeft(), this.plotRight());
        const idx = StreamLayout.nearest(this.data.x, xv);

        this.events.emit('hover', {
            layer: this.data.layers[h.layer]!,
            panel: h.panel,
            x: this.data.x[idx] ?? xv,
            value: this.data.panels[h.panel]?.values[h.layer]?.[idx] ?? 0
        });
    }

    private readonly onUp = (e: PointerEvent): void => {
        const press = this.press;

        this.press = null;
        if (press === null || press.moved || e.type !== 'pointerup') {
            return;
        }

        const p = this.local(e);
        const hit = this.hitAt(p.x, p.y);

        if (hit !== null) {
            const x = ChartScale.fromPx(p.x, this.viewRange(), this.plotLeft(), this.plotRight());
            this.events.emit('layerClick', {layer: this.data.layers[hit.layer]!, panel: hit.panel, x});
        }
    };

    private readonly onLeave = (): void => {
        if (this.hovered !== null || this.pointer !== null) {
            this.hovered = null;
            this.pointer = null;
            this.redraw();
            this.events.emit('hover', null);
        }
    };

    private readonly onWheel = (e: WheelEvent): void => {
        if (!this.zoomOn || this.result === null) {
            return;
        }
        e.preventDefault();

        const p = this.local(e);
        const at = ChartScale.fromPx(p.x, this.viewRange(), this.plotLeft(), this.plotRight());
        const factor = Math.exp(e.deltaY * 0.0015);
        const domain = this.result.domain;

        this.range = ChartScale.zoom(this.viewRange(), at, factor, domain, (domain.max - domain.min) / 200);
        this.redraw();
        this.events.emit('rangeChange', this.viewRange());
    };

    private readonly onDblClick = (): void => {
        if (this.zoomOn) {
            this.resetView();
        }
    };

}
