import { Color } from '../util/Color';
import { CHART_FONT, ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import {
    EntityPoint, PlacedEvent, StoryAppearance, StoryEntity, StoryEvent, StorylineData, StorylineLayout,
    StorylineLayoutOptions, StorylineResult
} from './StorylineLayout';

export interface StorylineChartOptions {
    data?: StorylineData;
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
    layout?: StorylineLayoutOptions;
    /** Legend chips under the chart (hover = highlight, click = focus). Default true. */
    legend?: boolean;
    /** Click on a band focuses its entity, click on an event its series; double-click resets. Default true. */
    filter?: boolean;
    /** Wheel zoom about the pointer, drag pan. Default true. */
    zoom?: boolean;
}

export interface StorylineChartEvents extends Record<string, unknown> {
    /** Entity under the pointer (band or legend chip), or null. */
    hover: {entity: string | null; event: string | null};
    entityClick: {entity: string};
    eventClick: {event: string};
    /** The shown subset changed: null = everything. */
    filterChange: {entity: string | null; series: string | null};
}

const PALETTE = ['#f2c12e', '#2f7de1', '#d6453d', '#3aa655', '#e58a2f', '#7d5bd6', '#34b3c4', '#c74b8b',
    '#8a6d3b', '#9aa0a8', '#5fb39a', '#b8b23a', '#4b6cb7', '#e06c75', '#56b6c2', '#a4778b'];
const AXIS_H = 64;

interface Path {
    id: string;
    color: string;
    /** Polyline samples (world) with the band width at each, for drawing and hit tests. */
    samples: {x: number; y: number; w: number}[];
    points: EntityPoint[];
}

/**
 * A storyline chart: entities are bands running left to right through the
 * events they take part in (bars on a time axis), bundled inside an event,
 * passing freely in between; band width = weight. Hover lights one band,
 * clicking focuses an entity (its events and everyone in them) or an event's
 * series, double-click returns. Canvas + a DOM legend, zero dependencies.
 */
export class StorylineChart extends ChartSurface<StorylineChartEvents> {

    private data: StorylineData = {events: [], entities: [], appearances: []};
    private readonly layoutEngine: StorylineLayout;
    private readonly barWidth: number;
    private result: StorylineResult | null = null;
    private paths: Path[] = [];
    private readonly legendEl: HTMLDivElement | null;
    private readonly filterOn: boolean;
    private readonly zoomOn: boolean;
    private focus: {entity: string | null; series: string | null} = {entity: null, series: null};
    private hovered: string | null = null;
    private hoveredEvent: string | null = null;
    private pointer: {x: number; y: number} | null = null;
    /** x and y scale separately: the time axis fills the width, the stack the height. */
    private view = {kx: 1, ky: 1, tx: 0, ty: 0};
    private userView = false;
    private fadeStart = -1;
    private press: {x: number; y: number; tx: number; ty: number; moved: boolean} | null = null;

    public constructor(container: HTMLElement, options: StorylineChartOptions = {}) {
        super(container, options.theme);
        this.layoutEngine = new StorylineLayout(options.layout);
        this.barWidth = options.layout?.barWidth ?? 18;
        this.filterOn = options.filter ?? true;
        this.zoomOn = options.zoom ?? true;

        if (options.legend ?? true) {
            this.legendEl = document.createElement('div');
            this.legendEl.style.cssText = 'position:absolute;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:6px;'
                + 'justify-content:center;padding:8px 10px;pointer-events:auto';
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

        this.setData(options.data ?? this.data);
    }

    public setData(data: StorylineData): void {
        this.data = {events: data.events.slice(), entities: data.entities.slice(), appearances: data.appearances.slice()};
        this.focus = {entity: null, series: null};
        this.relayout();
        this.buildLegend();
    }

    /** Show only the events of this entity and everyone in them; null = all. */
    public focusEntity(id: string | null): void {
        this.focus = {entity: id, series: null};
        this.relayout();
        this.events.emit('filterChange', {...this.focus});
    }

    /** Show only the events of one series; null = all. */
    public focusSeries(series: string | null): void {
        this.focus = {entity: null, series};
        this.relayout();
        this.events.emit('filterChange', {...this.focus});
    }

    public reset(): void {
        if (this.focus.entity !== null || this.focus.series !== null) {
            this.focusEntity(null);
        }
        this.fit();
    }

    /** Highlight one entity as if hovered (null clears). */
    public highlight(id: string | null): void {
        this.setHovered(id, null);
    }

    public getLayout(): StorylineResult | null {
        return this.result;
    }

    /** Fit the whole chart into the view (also after the user zoomed). */
    public fit(): void {
        this.userView = false;
        this.fitView();
        this.redraw();
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
    }

    // ---- data → layout → paths -----------------------------------------

    private color(entity: StoryEntity, index: number): string {
        return entity.color ?? PALETTE[index % PALETTE.length]!;
    }

    /** The subset the current focus shows. */
    private visibleData(): StorylineData {
        const {entity, series} = this.focus;
        let events: StoryEvent[] = this.data.events;

        if (entity !== null) {
            const mine = new Set(this.data.appearances.filter((a) => a.entity === entity).map((a) => a.event));
            events = events.filter((e) => mine.has(e.id));
        } else if (series !== null) {
            events = events.filter((e) => e.series === series);
        }

        const ids = new Set(events.map((e) => e.id));
        const appearances: StoryAppearance[] = this.data.appearances.filter((a) => ids.has(a.event));
        const present = new Set(appearances.map((a) => a.entity));

        return {events, entities: this.data.entities.filter((e) => present.has(e.id)), appearances};
    }

    private relayout(): void {
        const data = this.visibleData();
        const colorOf = new Map(this.data.entities.map((e, i) => [e.id, this.color(e, i)]));

        this.result = this.layoutEngine.layout(data);
        this.paths = [];

        for (const ent of data.entities) {
            const placed = this.result.entities.get(ent.id);

            if (placed === undefined || placed.points.length === 0) {
                continue;
            }

            this.paths.push({id: ent.id, color: colorOf.get(ent.id)!, samples: this.sample(placed.points), points: placed.points});
        }

        // The picture changes under the pointer: drop the hover until it moves again.
        if (this.hovered !== null || this.hoveredEvent !== null) {
            this.hovered = null;
            this.hoveredEvent = null;
            this.events.emit('hover', {entity: null, event: null});
        }
        this.pointer = null;
        this.userView = false;
        this.fitView();
        this.fadeStart = -2;
        this.syncLegend();
        this.redraw();
    }

    /** Polyline of one band: straight through event bars, S-curves between columns. */
    private sample(points: EntityPoint[]): {x: number; y: number; w: number}[] {
        const half = this.barWidth / 2;
        const out: {x: number; y: number; w: number}[] = [];
        const first = points[0]!;

        out.push({x: first.x - (first.event !== null ? half + 10 : 0), y: first.y, w: first.width});

        points.forEach((p, i) => {
            const h = p.event !== null ? half : 0;

            out.push({x: p.x - h, y: p.y, w: p.width}, {x: p.x + h, y: p.y, w: p.width});

            const next = points[i + 1];

            if (next !== undefined) {
                const ax = p.x + h;
                const bx = next.x - (next.event !== null ? half : 0);
                const steps = Math.abs(next.y - p.y) < 0.5 ? 1 : 14;

                for (let s = 1; s < steps; s++) {
                    const t = s / steps;
                    const e = t * t * (3 - 2 * t);   // smoothstep: horizontal tangents at both ends

                    out.push({x: ax + (bx - ax) * t, y: p.y + (next.y - p.y) * e, w: p.width});
                }
            }
        });

        const last = points[points.length - 1]!;

        if (last.event !== null) {
            out.push({x: last.x + half + 6, y: last.y, w: last.width});
        }

        return out;
    }

    // ---- view ------------------------------------------------------------

    private legendHeight(): number {
        return this.legendEl?.offsetHeight ?? 0;
    }

    private fitView(): void {
        const r = this.result;

        if (r === null || this.width <= 0) {
            return;
        }

        const pad = 24;
        const availW = Math.max(10, this.width - 2 * pad);
        const availH = Math.max(10, this.height - AXIS_H - this.legendHeight() - 2 * pad);
        const w = r.bounds.maxX - r.bounds.minX + 40;
        const h = Math.max(1, r.bounds.maxY - r.bounds.minY);
        const kx = Math.min(availW / w, 3);
        const ky = Math.max(Math.min(availH / h, kx * 4, 3), kx * 0.5);

        this.view = {
            kx,
            ky,
            tx: pad + (availW - w * kx) / 2 - (r.bounds.minX - 20) * kx,
            ty: AXIS_H + pad + Math.max(0, availH - h * ky) / 2 - r.bounds.minY * ky
        };
    }

    private sx(x: number): number {
        return x * this.view.kx + this.view.tx;
    }

    private sy(y: number): number {
        return y * this.view.ky + this.view.ty;
    }

    /** Screen width of an event bar: follows the band scale, never wider than 60 % of a column. */
    private barPx(): number {
        const gap = (this.result?.columns[1]?.x ?? 100) * this.view.kx;

        return Math.max(6, Math.min(this.barWidth * this.view.ky, gap * 0.6, 26));
    }

    // ---- drawing ---------------------------------------------------------

    protected draw(ctx: CanvasRenderingContext2D, timeMs: number): boolean {
        const r = this.result;

        if (r === null) {
            return false;
        }
        if (!this.userView) {
            this.fitView();
        }
        if (this.fadeStart === -2) {
            this.fadeStart = timeMs;
        }

        const fade = this.fadeStart < 0 ? 1 : Math.min(1, (timeMs - this.fadeStart) / 320);
        const theme = this.theme;
        const bottom = this.height - this.legendHeight();

        // time axis: dashed column lines + slanted period labels
        ctx.save();
        ctx.strokeStyle = Color.withAlpha(theme.text, 0.35);
        ctx.setLineDash([4, 5]);
        ctx.lineWidth = 1;
        ctx.font = CHART_FONT.replace('11px', '12px');
        ctx.fillStyle = theme.text;
        for (const col of r.columns) {
            if (col.period === null) {
                continue;
            }

            const x = Math.round(this.sx(col.x)) + 0.5;

            ctx.beginPath();
            ctx.moveTo(x, AXIS_H - 6);
            ctx.lineTo(x, bottom - 4);
            ctx.stroke();
            ctx.save();
            ctx.translate(x + 2, AXIS_H - 10);
            ctx.rotate(-Math.PI / 3);
            ctx.fillText(col.period, 0, 0);
            ctx.restore();
        }
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, AXIS_H - 4, this.width, bottom - AXIS_H + 4);
        ctx.clip();
        ctx.globalAlpha = fade;

        // bands: outline then colour, entity by entity (the outline separates bundled bands)
        const dim = this.hovered !== null;

        for (const p of this.paths) {
            if (p.id !== this.hovered) {
                this.drawBand(ctx, p, dim ? 0.22 : 1, false);
            }
        }

        const hot = this.paths.find((p) => p.id === this.hovered);

        if (hot !== undefined) {
            this.drawBand(ctx, hot, 1, true);
        }

        // event bars over the bands
        for (const ev of r.events.values()) {
            this.drawEvent(ctx, ev, dim && hot !== undefined && !ev.members.includes(hot.id));
        }

        // entry markers
        for (const p of this.paths) {
            const first = p.points[0]!;

            if (first.event !== null) {
                this.drawMarker(ctx, p, first, dim && p.id !== this.hovered ? 0.3 : 1);
            }
        }
        ctx.restore();

        this.drawTooltip(ctx);

        if (fade >= 1) {
            this.fadeStart = -1;
            return false;
        }

        return true;
    }

    private drawBand(ctx: CanvasRenderingContext2D, p: Path, alpha: number, hot: boolean): void {
        const k = this.view.ky;
        const base = ctx.globalAlpha;

        ctx.lineJoin = 'round';
        ctx.lineCap = 'butt';
        ctx.globalAlpha = base * alpha;

        // Draw run by run of equal width (a width change happens at an event bar).
        const runs: {w: number; pts: {x: number; y: number}[]}[] = [];

        for (const s of p.samples) {
            const last = runs[runs.length - 1];

            if (last === undefined || last.w !== s.w) {
                const prev = last?.pts[last.pts.length - 1];
                runs.push({w: s.w, pts: prev !== undefined ? [prev, s] : [s]});
            } else {
                last.pts.push(s);
            }
        }

        for (const pass of hot ? ['halo', 'edge', 'fill'] as const : ['edge', 'fill'] as const) {
            for (const run of runs) {
                ctx.beginPath();
                run.pts.forEach((pt, i) => (i === 0 ? ctx.moveTo(this.sx(pt.x), this.sy(pt.y)) : ctx.lineTo(this.sx(pt.x), this.sy(pt.y))));

                const w = run.w * k;

                if (pass === 'halo') {
                    ctx.strokeStyle = this.theme.select;
                    ctx.lineWidth = w + 6;
                } else if (pass === 'edge') {
                    ctx.strokeStyle = Color.withAlpha(this.theme.background, 0.9);
                    ctx.lineWidth = w + Math.max(1, 1.6 * k);
                } else {
                    ctx.strokeStyle = p.color;
                    ctx.lineWidth = w;
                }
                ctx.stroke();
            }
        }
        ctx.globalAlpha = base;
    }

    private drawEvent(ctx: CanvasRenderingContext2D, ev: PlacedEvent, dimmed: boolean): void {
        const w = this.barPx();
        const x = this.sx(ev.x) - w / 2;
        const y = this.sy(ev.y0);
        const h = (ev.y1 - ev.y0) * this.view.ky;
        const hot = ev.id === this.hoveredEvent;
        const base = ctx.globalAlpha;

        ctx.globalAlpha = base * (dimmed ? 0.35 : 1);
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, Math.min(4, w / 3));
        ctx.fillStyle = Color.withAlpha(this.theme.title, hot ? 0.95 : 0.82);
        ctx.fill();
        if (hot) {
            ctx.strokeStyle = this.theme.select;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        const size = Math.min(w * 0.62, 26);

        if (size >= 5) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y + 2, w, h - 4);
            ctx.clip();
            ctx.translate(x + w / 2, y + h / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.font = `600 ${size.toFixed(1)}px system-ui, -apple-system, sans-serif`;
            ctx.fillStyle = this.theme.background;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(ev.label, 0, 0.5, Math.max(10, h - 6));
            ctx.restore();
        }
        ctx.globalAlpha = base;
    }

    private drawMarker(ctx: CanvasRenderingContext2D, p: Path, first: EntityPoint, alpha: number): void {
        const entity = this.data.entities.find((e) => e.id === p.id);
        const r = Math.max(4, Math.min(9, (first.width / 2 + 3) * this.view.ky));
        const x = this.sx(first.x) - this.barPx() / 2 - r - 3;
        const y = this.sy(first.y);
        const base = ctx.globalAlpha;

        ctx.globalAlpha = base * alpha;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = this.theme.title;
        ctx.stroke();

        const icon = entity?.icon ?? entity?.label.slice(0, 1) ?? '';

        if (r >= 6 && icon !== '') {
            ctx.fillStyle = StorylineChart.ink(p.color);
            ctx.font = `700 ${(r * (icon.length > 1 ? 0.85 : 1.1)).toFixed(1)}px system-ui, -apple-system, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(icon, x, y + 0.5);
        }
        ctx.globalAlpha = base;
    }

    private drawTooltip(ctx: CanvasRenderingContext2D): void {
        const at = this.pointer;
        let text: string | null = null;

        if (at === null) {
            return;
        }
        if (this.hoveredEvent !== null) {
            const ev = this.result?.events.get(this.hoveredEvent);
            if (ev !== undefined) {
                text = `${ev.label}${ev.period !== null ? ' · ' + ev.period : ''} · ${ev.members.length} involved`;
            }
        } else if (this.hovered !== null) {
            const entity = this.data.entities.find((e) => e.id === this.hovered);
            const n = this.paths.find((p) => p.id === this.hovered)?.points.filter((p) => p.event !== null).length ?? 0;
            text = entity === undefined ? null : `${entity.label} · ${n} event${n === 1 ? '' : 's'}`;
        }
        if (text === null) {
            return;
        }

        ctx.save();
        ctx.font = `600 ${CHART_FONT}`;

        const w = ctx.measureText(text).width + 16;
        const x = Math.min(this.width - w - 4, at.x + 14);
        const y = Math.max(4, at.y - 30);

        ctx.beginPath();
        ctx.roundRect(x, y, w, 22, 5);
        ctx.fillStyle = Color.withAlpha(this.theme.background, 0.94);
        ctx.fill();
        ctx.strokeStyle = this.theme.pillBorder;
        ctx.stroke();
        ctx.fillStyle = this.theme.title;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 8, y + 11.5);
        ctx.restore();
    }

    /** Black or white text for a fill colour. */
    private static ink(color: string): string {
        const rgb = Color.parse(color);

        if (rgb === null) {
            return '#111';
        }

        return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b > 150 ? '#14161c' : '#ffffff';
    }

    // ---- legend ----------------------------------------------------------

    private buildLegend(): void {
        const el = this.legendEl;

        if (el === null) {
            return;
        }

        el.replaceChildren();
        this.data.entities.forEach((e, i) => {
            const color = this.color(e, i);
            const chip = document.createElement('button');
            const ink = StorylineChart.ink(color);

            chip.type = 'button';
            chip.dataset['entity'] = e.id;
            chip.style.cssText = `display:inline-flex;align-items:center;gap:6px;border:0;border-radius:999px;padding:3px 12px 3px 3px;`
                + `background:${color};color:${ink};font:600 12px system-ui,-apple-system,sans-serif;cursor:pointer;`
                + `outline:2px solid transparent;outline-offset:1px;transition:opacity .15s`;

            const dot = document.createElement('span');

            dot.textContent = e.icon ?? e.label.slice(0, 1);
            dot.style.cssText = `display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;`
                + `background:${Color.withAlpha(this.theme.background, 0.85)};color:${this.theme.title};font-size:10px`;
            chip.append(dot, document.createTextNode(e.label));
            chip.addEventListener('pointerenter', () => this.setHovered(e.id, null));
            chip.addEventListener('pointerleave', () => this.setHovered(null, null));
            chip.addEventListener('click', (ev) => {
                ev.stopPropagation();
                this.events.emit('entityClick', {entity: e.id});
                if (this.filterOn) {
                    this.focusEntity(this.focus.entity === e.id ? null : e.id);
                }
            });
            chip.addEventListener('pointerdown', (ev) => ev.stopPropagation());
            el.appendChild(chip);
        });
        this.syncLegend();
        if (!this.userView) {
            this.fitView();
        }
    }

    /** Dim chips that are not in the current subset, outline the hovered/focused one. */
    private syncLegend(): void {
        const el = this.legendEl;

        if (el === null) {
            return;
        }

        const shown = new Set(this.paths.map((p) => p.id));

        for (const chip of Array.from(el.children) as HTMLElement[]) {
            const id = chip.dataset['entity'] ?? '';

            chip.style.opacity = shown.has(id) ? (this.hovered !== null && this.hovered !== id ? '0.55' : '1') : '0.25';
            chip.style.outlineColor = id === this.hovered || id === this.focus.entity ? this.theme.select : 'transparent';
        }
    }

    // ---- interaction -----------------------------------------------------

    private eventAt(x: number, y: number): string | null {
        const half = this.barPx() / 2 + 2;

        for (const ev of this.result?.events.values() ?? []) {
            if (Math.abs(x - this.sx(ev.x)) <= half && y >= this.sy(ev.y0) && y <= this.sy(ev.y1)) {
                return ev.id;
            }
        }

        return null;
    }

    /** The band under the pointer (screen px): the closest one whose half-width (+3 px) covers it; front-most wins ties. */
    private bandAt(x: number, y: number): string | null {
        let best: string | null = null;
        let bestD = Infinity;

        for (const p of this.paths) {
            const s = p.samples;

            for (let i = 1; i < s.length; i++) {
                const a = {x: this.sx(s[i - 1]!.x), y: this.sy(s[i - 1]!.y)};
                const b = {x: this.sx(s[i]!.x), y: this.sy(s[i]!.y)};

                if (x < Math.min(a.x, b.x) - 20 || x > Math.max(a.x, b.x) + 20) {
                    continue;
                }

                const d = StorylineChart.segDist(x, y, a, b);

                if (d <= s[i - 1]!.w * this.view.ky / 2 + 3 && d <= bestD) {
                    bestD = d;
                    best = p.id;
                }
            }
        }

        return best;
    }

    private static segDist(px: number, py: number, a: {x: number; y: number}, b: {x: number; y: number}): number {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = dx * dx + dy * dy;
        const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len));

        return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
    }

    private setHovered(entity: string | null, event: string | null): void {
        if (entity === this.hovered && event === this.hoveredEvent) {
            return;
        }

        this.hovered = entity;
        this.hoveredEvent = event;
        this.syncLegend();
        this.events.emit('hover', {entity, event});
        this.redraw();
    }

    private readonly onDown = (e: PointerEvent): void => {
        if (e.button !== 0) {
            return;
        }

        const p = this.local(e);

        this.press = {x: p.x, y: p.y, tx: this.view.tx, ty: this.view.ty, moved: false};
        this.root.setPointerCapture(e.pointerId);
    };

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);
        const press = this.press;

        if (press !== null) {
            if (Math.hypot(p.x - press.x, p.y - press.y) > 3) {
                press.moved = true;
            }
            if (press.moved && this.zoomOn) {
                this.view = {...this.view, tx: press.tx + p.x - press.x, ty: press.ty + p.y - press.y};
                this.userView = true;
                this.root.style.cursor = 'grabbing';
                this.pointer = null;
                this.redraw();
            }
            return;
        }

        if (p.y > this.height - this.legendHeight()) {
            return;   // over the legend: its chips handle hover
        }

        const event = this.eventAt(p.x, p.y);
        const entity = event === null ? this.bandAt(p.x, p.y) : null;

        this.pointer = p;
        this.root.style.cursor = event !== null || entity !== null ? 'pointer' : this.zoomOn ? 'grab' : '';
        this.setHovered(entity, event);
        if (entity !== null || event !== null) {
            this.redraw();   // tooltip follows the pointer
        }
    };

    private readonly onUp = (e: PointerEvent): void => {
        const press = this.press;

        this.press = null;
        if (this.root.hasPointerCapture(e.pointerId)) {
            this.root.releasePointerCapture(e.pointerId);
        }
        this.root.style.cursor = '';
        if (press === null || press.moved || e.type !== 'pointerup') {
            return;
        }

        const p = this.local(e);
        const event = this.eventAt(p.x, p.y);

        if (event !== null) {
            this.events.emit('eventClick', {event});
            const series = this.result?.events.get(event)?.series ?? null;

            if (this.filterOn && series !== null) {
                this.focusSeries(this.focus.series === series ? null : series);
            }
            return;
        }

        const entity = this.bandAt(p.x, p.y);

        if (entity !== null) {
            this.events.emit('entityClick', {entity});
            if (this.filterOn) {
                this.focusEntity(this.focus.entity === entity ? null : entity);
            }
        }
    };

    private readonly onLeave = (): void => {
        if (this.press === null) {
            this.pointer = null;
            this.setHovered(null, null);
        }
    };

    private readonly onWheel = (e: WheelEvent): void => {
        if (!this.zoomOn) {
            return;
        }

        e.preventDefault();

        const p = this.local(e);
        const f = Math.max(0.1 / this.view.kx, Math.min(12 / this.view.kx, Math.exp(-e.deltaY * 0.0015)));

        this.view = {kx: this.view.kx * f, ky: this.view.ky * f, tx: p.x - (p.x - this.view.tx) * f, ty: p.y - (p.y - this.view.ty) * f};
        this.userView = true;
        this.redraw();
    };

    private readonly onDblClick = (e: MouseEvent): void => {
        const p = this.local(e);

        if (p.y > this.height - this.legendHeight()) {
            return;
        }
        if (this.eventAt(p.x, p.y) === null && this.bandAt(p.x, p.y) === null) {
            this.reset();
        }
    };

}
