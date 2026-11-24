import { Color } from '../util/Color';
import { ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { AlignedFix, EncounterFix, EncounterGeometry } from './EncounterGeometry';

/** A kind of animal (or any category) with its colour. */
export interface EncounterCategory {
    id: string;
    name: string;
    color: string;
}

/** One encounter: where the animals went while they were followed. */
export interface EncounterData {
    id: string;
    /** `EncounterCategory.id`. */
    category: string;
    /** Positions in metres east/north, `t` in seconds (any origin — the track is moved to the centre). */
    fixes: EncounterFix[];
    /** Group size: the head dot grows with √count. */
    count?: number;
    /** Young animals: small dots following the head. */
    young?: number;
    /** Bearing (degrees, 0 = north) of something to turn every track towards, e.g. the open sea or the boat; used by align 'reference'. */
    reference?: number;
    label?: string;
}

export type EncounterAlign = 'north' | 'reference' | 'first';

export interface EncounterRoseOptions {
    categories?: EncounterCategory[];
    encounters?: EncounterData[];
    /** Which way is up: north, each encounter's `reference`, or its first heading (default 'north'). */
    align?: EncounterAlign;
    /** Text at the top of the dial per align mode. */
    upLabels?: Partial<Record<EncounterAlign, string>>;
    /** Outer radius in metres; default: 90th percentile of the farthest point. */
    radius?: number;
    /** Distance scale: 'sqrt' gives the first metres more room (default 'linear'). */
    scale?: 'linear' | 'sqrt';
    /** Direction sectors of the rose (default 16). */
    bins?: number;
    /** Replay speed: seconds of encounter per second (default 90). */
    speed?: number;
    /** Start the replay at once (default false: whole tracks). */
    play?: boolean;
    /** Loop the replay (default true). */
    loop?: boolean;
    /** Show only these encounters (null = all). */
    filter?: ((e: EncounterData) => boolean) | null;
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
}

export interface EncounterHover {
    encounter: EncounterData;
    category: EncounterCategory | undefined;
    stats: ReturnType<typeof EncounterGeometry.stats>;
}

export interface EncounterSector {
    index: number;
    /** Centre bearing in degrees. */
    bearing: number;
    /** Encounter ids counted in it (at the current time). */
    ids: string[];
}

export interface EncounterRoseEvents extends Record<string, unknown> {
    hover: EncounterHover | null;
    click: EncounterHover | null;
    sectorHover: EncounterSector | null;
    /** Current replay time in seconds (null = whole tracks). */
    time: number | null;
}

interface Prepared {
    data: EncounterData;
    track: AlignedFix[];
    color: string;
    ci: number;
    stats: ReturnType<typeof EncounterGeometry.stats>;
    /** Screen polyline of the drawn part (for hit testing). */
    screen: number[];
    /** Bearing of the current position (or the end) and its distance. */
    now: {bearing: number; dist: number; x: number; y: number} | null;
}

/**
 * Every encounter's track moved to one common start in the centre, turned to
 * a shared "up" (north, a per-encounter reference, or the first heading) and
 * replayed on one clock: who swims away, who circles, who comes back. Around
 * the dial a direction rose of where everybody is *now*, stacked by
 * category, and a mean-direction arrow per category in the middle.
 */
export class EncounterRose extends ChartSurface<EncounterRoseEvents> {

    private static readonly TAU = Math.PI * 2;

    private categories: EncounterCategory[];
    private encounters: EncounterData[];
    private prepared: Prepared[] = [];
    private align: EncounterAlign;
    private readonly upLabels: Record<EncounterAlign, string>;
    private radiusFixed: number | null;
    private radiusAuto = 1000;
    private zoom = 1;
    private scale: 'linear' | 'sqrt';
    private bins: number;
    private speed: number;
    private looping: boolean;
    private filter: ((e: EncounterData) => boolean) | null;
    private time: number | null = null;
    private playingState = false;
    private lastNow = -1;
    private maxTime = 0;
    private hover: Prepared | null = null;
    private selected: string | null = null;
    private highlighted: Set<string> | null = null;
    private sector: number | null = null;
    private sectorIds: string[][] = [];
    private geo = {cx: 0, cy: 0, R: 1, band: 1};

    public constructor(container: HTMLElement, options: EncounterRoseOptions = {}) {
        super(container, options.theme ?? 'dark');
        this.categories = (options.categories ?? []).map((c) => ({...c}));
        this.encounters = EncounterRose.copyEncounters(options.encounters ?? []);
        this.align = options.align ?? 'north';
        this.upLabels = {north: 'N', reference: 'REFERENCE', first: 'FIRST HEADING', ...options.upLabels};
        this.radiusFixed = options.radius ?? null;
        this.scale = options.scale ?? 'linear';
        this.bins = Math.max(4, options.bins ?? 16);
        this.speed = options.speed ?? 90;
        this.looping = options.loop ?? true;
        this.filter = options.filter ?? null;
        this.prepare();
        if (options.play === true) {
            this.play();
        }

        this.canvas.addEventListener('pointermove', this.onMove);
        this.canvas.addEventListener('pointerleave', this.onLeave);
        this.canvas.addEventListener('click', this.onClick);
        this.canvas.addEventListener('wheel', this.onWheel, {passive: false});
        this.canvas.addEventListener('dblclick', this.onDblClick);
        this.redraw();
    }

    // ---- data -------------------------------------------------------------------------------------------

    public setEncounters(encounters: EncounterData[], categories?: EncounterCategory[]): void {
        this.encounters = EncounterRose.copyEncounters(encounters);
        if (categories !== undefined) {
            this.categories = categories.map((c) => ({...c}));
        }
        this.prepare();
        this.redraw();
    }

    public setAlign(align: EncounterAlign): void {
        this.align = align;
        this.prepare();
        this.redraw();
    }

    public setScale(scale: 'linear' | 'sqrt'): void {
        this.scale = scale;
        this.redraw();
    }

    public setFilter(filter: ((e: EncounterData) => boolean) | null): void {
        this.filter = filter;
        this.prepare();
        this.redraw();
    }

    /** Outer radius in metres (null = automatic). */
    public setRadius(radius: number | null): void {
        this.radiusFixed = radius;
        this.zoom = 1;
        this.redraw();
    }

    public setSpeed(speed: number): void {
        this.speed = speed;
    }

    /** Emphasise these encounters (null = none). */
    public highlight(ids: string[] | null): void {
        this.highlighted = ids === null ? null : new Set(ids);
        this.redraw();
    }

    /** Select one encounter (drawn on top, others dimmed); null clears. */
    public select(id: string | null): void {
        this.selected = id;
        this.redraw();
    }

    /** Encounters that pass the filter, with their statistics in the current frame. */
    public getVisible(): {encounter: EncounterData; stats: EncounterHover['stats']}[] {
        return this.prepared.map((p) => ({encounter: EncounterRose.copyEncounters([p.data])[0]!, stats: {...p.stats}}));
    }

    /** Back to the automatic radius zoom (like a double-click). */
    public resetView(): void {
        this.zoom = 1;
        this.redraw();
    }

    // ---- replay ---------------------------------------------------------------------------------------------

    public play(): void {
        if (this.time === null || this.time >= this.maxTime) {
            this.time = 0;
        }
        this.playingState = true;
        this.lastNow = -1;
        this.redraw();
    }

    public pause(): void {
        this.playingState = false;
    }

    /** True while the replay runs. */
    public get playing(): boolean {
        return this.playingState;
    }

    /** @deprecated use the `playing` getter */
    public isPlaying(): boolean {
        return this.playingState;
    }

    /** Jump to a time in seconds; null shows the whole tracks. */
    public setTime(t: number | null): void {
        this.time = t === null ? null : Math.max(0, Math.min(this.maxTime, t));
        if (t === null) {
            this.playingState = false;
        }
        this.events.emit('time', this.time);
        this.redraw();
    }

    public getTime(): number | null {
        return this.time;
    }

    /** Duration of the longest visible encounter, seconds. */
    public getMaxTime(): number {
        return this.maxTime;
    }

    public override destroy(): void {
        this.canvas.removeEventListener('pointermove', this.onMove);
        this.canvas.removeEventListener('pointerleave', this.onLeave);
        this.canvas.removeEventListener('click', this.onClick);
        this.canvas.removeEventListener('wheel', this.onWheel);
        this.canvas.removeEventListener('dblclick', this.onDblClick);
        super.destroy();
    }

    private prepare(): void {
        const index = new Map(this.categories.map((c, i) => [c.id, i]));
        const far: number[] = [];

        this.prepared = [];
        for (const e of this.encounters) {
            if (this.filter !== null && !this.filter(e)) {
                continue;
            }

            const sorted = [...e.fixes].sort((a, b) => a.t - b.t);
            const ref = this.align === 'north' ? 0
                : this.align === 'reference' ? (e.reference ?? 0) * Math.PI / 180
                    : EncounterGeometry.firstHeading(sorted, 25);
            const track = EncounterGeometry.align(sorted, ref);
            const ci = index.get(e.category) ?? -1;

            far.push(track.reduce((m, f) => Math.max(m, Math.hypot(f.x, f.y)), 0));
            this.prepared.push({
                data: e, track, ci,
                color: this.categories[ci]?.color ?? this.theme.line,
                stats: EncounterGeometry.stats(track),
                screen: [], now: null
            });
        }
        far.sort((a, b) => a - b);
        this.radiusAuto = Math.max(50, far[Math.floor((far.length - 1) * 0.9)] ?? 1000) * 1.05;
        this.maxTime = this.prepared.reduce((m, p) => Math.max(m, p.stats.duration), 0);
        if (this.time !== null) {
            this.time = Math.min(this.time, this.maxTime);
        }
        if (this.hover !== null && !this.prepared.includes(this.hover)) {
            this.hover = null;
        }
    }

    // ---- geometry ------------------------------------------------------------------------------------------------

    private radius(): number {
        return (this.radiusFixed ?? this.radiusAuto) / this.zoom;
    }

    private toScreen(x: number, y: number): [number, number] {
        const {cx, cy, R} = this.geo;
        const rad = this.radius();

        if (this.scale === 'linear') {
            const k = R / rad;
            return [cx + x * k, cy - y * k];
        }

        const d = Math.hypot(x, y);

        if (d === 0) {
            return [cx, cy];
        }

        const rr = R * Math.sqrt(d / rad);

        return [cx + x / d * rr, cy - y / d * rr];
    }

    private ringRadius(m: number): number {
        const r = m / this.radius();

        return this.geo.R * (this.scale === 'linear' ? r : Math.sqrt(r));
    }

    // ---- drawing -----------------------------------------------------------------------------------------------------

    protected draw(ctx: CanvasRenderingContext2D, now: number): boolean {
        if (this.playing && this.time !== null) {
            if (this.lastNow >= 0) {
                this.time += Math.min(0.1, (now - this.lastNow) / 1000) * this.speed;
                if (this.time >= this.maxTime) {
                    if (this.looping) {
                        this.time = 0;
                    } else {
                        this.time = this.maxTime;
                        this.playingState = false;
                    }
                }
            }
            this.lastNow = now;
            this.events.emit('time', this.time);
        }

        const W = this.width, H = this.height;
        const side = Math.min(W, H);
        const band = Math.max(26, side * 0.1);
        const R = Math.max(40, side / 2 - band - 30);

        this.geo = {cx: W / 2, cy: H / 2 + 4, R, band};
        this.drawDial(ctx);

        const t = this.time;
        const dimAll = this.selected !== null || this.highlighted !== null || this.sector !== null || this.hover !== null;
        const inSector = this.sector === null ? null : new Set(this.sectorIds[this.sector] ?? []);
        const emph = (p: Prepared): boolean => p.data.id === this.selected || (this.highlighted?.has(p.data.id) ?? false)
            || (inSector?.has(p.data.id) ?? false) || p === this.hover;

        ctx.save();
        ctx.beginPath();
        ctx.arc(this.geo.cx, this.geo.cy, R, 0, EncounterRose.TAU);
        ctx.clip();

        // ghosts of the whole tracks while replaying
        if (t !== null) {
            ctx.lineWidth = 1;
            for (const p of this.prepared) {
                ctx.strokeStyle = Color.withAlpha(p.color, 0.07);
                this.trackPath(ctx, p, p.track.length - 1, null);
                ctx.stroke();
            }
        }

        const order = [...this.prepared].sort((a, b) => Number(emph(a)) - Number(emph(b)));
        for (const p of order) {
            this.drawTrack(ctx, p, t, dimAll && !emph(p) ? 0.12 : emph(p) && dimAll ? 1 : 0.6, emph(p) && dimAll);
        }
        ctx.restore();

        this.drawRose(ctx);
        this.drawMeans(ctx);
        this.drawClock(ctx);
        if (this.hover !== null) {
            this.drawTooltip(ctx, this.hover);
        }

        return this.playing;
    }

    private drawDial(ctx: CanvasRenderingContext2D): void {
        const {cx, cy, R, band} = this.geo;
        const th = this.theme;
        const rad = this.radius();
        const step = EncounterGeometry.ringStep(rad, this.scale === 'sqrt' ? 5 : 4);

        const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        bg.addColorStop(0, Color.withAlpha(th.line, 0.07));
        bg.addColorStop(1, Color.withAlpha(th.line, 0.015));
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, EncounterRose.TAU);
        ctx.fill();

        ctx.lineWidth = 1;
        ctx.strokeStyle = th.grid;
        ctx.font = `10px ${ChartSurface.FONT_FAMILY}`;
        ctx.fillStyle = th.text;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (let m = step; m <= rad * 1.0001; m += step) {
            const r = this.ringRadius(m);
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, EncounterRose.TAU);
            ctx.stroke();
            ctx.setLineDash([]);
            const lx = cx + r * Math.sin(Math.PI * 0.82), ly = cy - r * Math.cos(Math.PI * 0.82);
            ctx.fillText(m >= 1000 ? `${+(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`, lx + 3, ly);
        }
        // spokes per sector
        for (let i = 0; i < this.bins; i++) {
            const a = i / this.bins * EncounterRose.TAU;
            ctx.strokeStyle = i % (this.bins / 4) === 0 ? th.axis : th.grid;
            ctx.beginPath();
            ctx.moveTo(cx + Math.sin(a) * 6, cy - Math.cos(a) * 6);
            ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
            ctx.stroke();
        }
        ctx.strokeStyle = th.axis;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, EncounterRose.TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, R + band, 0, EncounterRose.TAU);
        ctx.strokeStyle = th.grid;
        ctx.stroke();

        // labels outside
        ctx.fillStyle = th.title;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labels = this.align === 'north'
            ? ['N', 'E', 'S', 'W']
            : [this.upLabels[this.align], '90°', '180°', '270°'];
        labels.forEach((l, i) => {
            const a = i * Math.PI / 2;
            const r = R + band + 14;
            ctx.font = i === 0 ? `700 12px ${ChartSurface.FONT_FAMILY}` : `11px ${ChartSurface.FONT_FAMILY}`;
            ctx.fillText(l, cx + Math.sin(a) * r, cy - Math.cos(a) * r);
        });
        // start mark
        ctx.fillStyle = th.select;
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, EncounterRose.TAU);
        ctx.fill();
    }

    /** Path of a track up to fix `last`, plus an interpolated end; returns screen coords into p.screen when `collect`. */
    private trackPath(ctx: CanvasRenderingContext2D, p: Prepared, last: number, end: {x: number; y: number} | null, collect = false): void {
        ctx.beginPath();
        if (collect) {
            p.screen = [];
        }
        for (let i = 0; i <= last; i++) {
            const f = p.track[i]!;
            const [x, y] = this.toScreen(f.x, f.y);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            if (collect) {
                p.screen.push(x, y);
            }
        }
        if (end !== null) {
            const [x, y] = this.toScreen(end.x, end.y);
            ctx.lineTo(x, y);
            if (collect) {
                p.screen.push(x, y);
            }
        }
    }

    private drawTrack(ctx: CanvasRenderingContext2D, p: Prepared, t: number | null, alpha: number, strong: boolean): void {
        const pos = t === null ? null : EncounterGeometry.at(p.track, t);
        const lastFix = p.track[p.track.length - 1];

        if (lastFix === undefined) {
            p.screen = [];
            p.now = null;
            return;
        }
        if (t !== null && pos === null) {
            p.screen = [];
            p.now = null;
            return;
        }

        const lastIndex = pos === null ? p.track.length - 1 : pos.i;
        const end = pos === null ? null : {x: pos.x, y: pos.y};
        const hx = pos?.x ?? lastFix.x, hy = pos?.y ?? lastFix.y;
        const finished = t === null || t >= p.stats.duration;

        p.now = {x: hx, y: hy, dist: Math.hypot(hx, hy), bearing: EncounterGeometry.bearing(0, 0, hx, hy)};

        // surface segments solid, dives dashed — one pass each
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        const width = strong ? 2.4 : 1.25;
        for (const dive of [false, true]) {
            ctx.beginPath();
            let any = false;
            for (let i = 1; i <= lastIndex + (end !== null ? 1 : 0); i++) {
                const f = p.track[i];
                if (f === undefined || (f.dive === true) !== dive) {
                    continue;
                }
                const a = p.track[i - 1]!;
                const b = i > lastIndex && end !== null ? end : f;
                const [ax, ay] = this.toScreen(a.x, a.y);
                const [bx, by] = this.toScreen(b.x, b.y);
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                any = true;
            }
            if (!any) {
                continue;
            }
            ctx.setLineDash(dive ? [2, 4] : []);
            ctx.strokeStyle = Color.withAlpha(p.color, alpha * (dive ? 0.7 : 1));
            ctx.lineWidth = dive ? width * 0.8 : width;
            ctx.stroke();
        }
        ctx.setLineDash([]);
        if (strong) {
            this.trackPath(ctx, p, lastIndex, end, true);
        } else {
            p.screen = [];
            for (let i = 0; i <= lastIndex; i++) {
                const [x, y] = this.toScreen(p.track[i]!.x, p.track[i]!.y);
                p.screen.push(x, y);
            }
            if (end !== null) {
                const [x, y] = this.toScreen(end.x, end.y);
                p.screen.push(x, y);
            }
        }

        // head: group, young following behind
        const [sx, sy] = this.toScreen(hx, hy);
        const r = 1.6 + Math.sqrt(p.data.count ?? 1) * 0.55;
        const under = pos?.dive === true && !finished;

        if (!finished) {
            const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 3);
            g.addColorStop(0, Color.withAlpha(p.color, 0.45 * alpha));
            g.addColorStop(1, Color.withAlpha(p.color, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(sx, sy, r * 3, 0, EncounterRose.TAU);
            ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, EncounterRose.TAU);
        if (under) {
            ctx.strokeStyle = Color.withAlpha(p.color, alpha);
            ctx.lineWidth = 1.2;
            ctx.stroke();
        } else {
            ctx.fillStyle = Color.withAlpha(finished ? Color.lerp(p.color, this.theme.background, 0.25) : p.color, Math.min(1, alpha + 0.25));
            ctx.fill();
        }
        const young = Math.min(4, p.data.young ?? 0);
        if (young > 0) {
            const back = (pos?.heading ?? lastFix.heading) + Math.PI;
            for (let k = 0; k < young; k++) {
                const a = back + (k - (young - 1) / 2) * 0.55;
                const d = r + 2.5 + k % 2 * 1.5;
                ctx.fillStyle = Color.withAlpha('#ffffff', 0.8 * alpha);
                ctx.beginPath();
                ctx.arc(sx + Math.sin(a) * d, sy - Math.cos(a) * d, 1.3, 0, EncounterRose.TAU);
                ctx.fill();
            }
        }
    }

    /** Stacked direction rose of the current positions, outside the dial. */
    private drawRose(ctx: CanvasRenderingContext2D): void {
        const {cx, cy, R, band} = this.geo;
        const n = this.categories.length;
        const items: {bearing: number; category: number}[] = [];
        const ids: string[][] = Array.from({length: this.bins}, () => []);
        const minMove = this.radius() * 0.03;

        for (const p of this.prepared) {
            if (p.now === null || p.now.dist < minMove || p.ci < 0) {
                continue;
            }
            items.push({bearing: p.now.bearing, category: p.ci});
            ids[EncounterGeometry.binOf(p.now.bearing, this.bins)]!.push(p.data.id);
        }
        this.sectorIds = ids;

        const rose = EncounterGeometry.rose(items, this.bins, Math.max(1, n));
        const max = Math.max(1, ...rose.map((r) => r.reduce((s, v) => s + v, 0)));
        const half = Math.PI / this.bins * 0.86;
        const r0 = R + 4;

        rose.forEach((row, i) => {
            const mid = i / this.bins * EncounterRose.TAU;
            const a0 = mid - half - Math.PI / 2, a1 = mid + half - Math.PI / 2;
            let acc = 0;
            const hot = this.sector === i;

            if (hot) {
                ctx.fillStyle = Color.withAlpha(this.theme.hover, 0.12);
                ctx.beginPath();
                ctx.arc(cx, cy, r0 + band - 4, a0, a1);
                ctx.arc(cx, cy, r0, a1, a0, true);
                ctx.closePath();
                ctx.fill();
            }
            row.forEach((v, c) => {
                if (v <= 0) {
                    return;
                }
                // petal length ∝ count
                const ra = r0 + (band - 6) * (acc / max);
                acc += v;
                const rb = r0 + (band - 6) * (acc / max);
                ctx.beginPath();
                ctx.arc(cx, cy, rb, a0, a1);
                ctx.arc(cx, cy, ra, a1, a0, true);
                ctx.closePath();
                ctx.fillStyle = Color.withAlpha(this.categories[c]?.color ?? this.theme.line, hot ? 1 : 0.82);
                ctx.fill();
            });
            if (hot && acc > 0) {
                ctx.font = `600 11px ${ChartSurface.FONT_FAMILY}`;
                ctx.fillStyle = this.theme.title;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const rr = r0 + (band - 6) * (acc / max) + 10;
                ctx.fillText(String(acc), cx + Math.sin(mid) * rr, cy - Math.cos(mid) * rr);
            }
        });
    }

    /** Circular mean of the current direction per category: an arrow from the centre, length = how much they agree. */
    private drawMeans(ctx: CanvasRenderingContext2D): void {
        const {cx, cy, R} = this.geo;
        const minMove = this.radius() * 0.03;

        this.categories.forEach((c, ci) => {
            const ps = this.prepared.filter((p) => p.ci === ci && p.now !== null && p.now.dist >= minMove);
            if (ps.length < 2) {
                return;
            }
            const m = EncounterGeometry.circularMean(ps.map((p) => p.now!.bearing));
            const len = R * 0.42 * m.r;
            if (len < 6) {
                return;
            }
            const ex = cx + Math.sin(m.bearing) * len, ey = cy - Math.cos(m.bearing) * len;
            ctx.strokeStyle = Color.withAlpha(c.color, 0.95);
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            ctx.fillStyle = c.color;
            ctx.beginPath();
            const a = m.bearing;
            ctx.moveTo(ex + Math.sin(a) * 7, ey - Math.cos(a) * 7);
            ctx.lineTo(ex + Math.sin(a + 2.4) * 6, ey - Math.cos(a + 2.4) * 6);
            ctx.lineTo(ex + Math.sin(a - 2.4) * 6, ey - Math.cos(a - 2.4) * 6);
            ctx.closePath();
            ctx.fill();
        });
    }

    private drawClock(ctx: CanvasRenderingContext2D): void {
        const t = this.time;
        const running = t === null ? this.prepared.length
            : this.prepared.filter((p) => p.stats.duration >= t && (p.track[0]?.t ?? 0) <= t).length;

        ctx.font = `600 20px ui-monospace, monospace`;
        ctx.fillStyle = this.theme.title;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(t === null ? 'whole tracks' : EncounterRose.clock(t), 14, 12);
        ctx.font = `11px ${ChartSurface.FONT_FAMILY}`;
        ctx.fillStyle = this.theme.text;
        ctx.fillText(t === null ? `${this.prepared.length} encounters` : `after the first contact · ${running} of ${this.prepared.length} still followed`, 14, 38);
    }

    private drawTooltip(ctx: CanvasRenderingContext2D, p: Prepared): void {
        const s = p.stats;
        const cat = this.categories[p.ci];
        const lines = [
            p.data.label ?? `${cat?.name ?? p.data.category} · ${p.data.id}`,
            `${p.data.count ?? 1} animals${(p.data.young ?? 0) > 0 ? ` · ${p.data.young} young` : ''}`,
            `${EncounterRose.clock(s.duration)} · ${(s.length / 1000).toFixed(2)} km · ${(s.speed * 3.6).toFixed(1)} km/h`,
            `straightness ${Math.round(s.straightness * 100)} % · ended ${(s.net / 1000).toFixed(2)} km away`
        ];
        const last = p.screen.length >= 2 ? [p.screen[p.screen.length - 2]!, p.screen[p.screen.length - 1]!] : [this.geo.cx, this.geo.cy];

        ctx.save();
        ctx.font = `12px ${ChartSurface.FONT_FAMILY}`;
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
        const h = lines.length * 16 + 12;
        const x = Math.max(4, Math.min(this.width - w - 4, last[0]! + 12));
        const y = Math.max(4, Math.min(this.height - h - 4, last[1]! + 12));

        ctx.fillStyle = Color.withAlpha(this.theme.background, 0.94);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 5);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        lines.forEach((l, i) => {
            ctx.font = i === 0 ? `600 12px ${ChartSurface.FONT_FAMILY}` : `12px ${ChartSurface.FONT_FAMILY}`;
            ctx.fillStyle = i === 0 ? this.theme.title : this.theme.text;
            ctx.fillText(l, x + 10, y + 7 + i * 16);
        });
        ctx.restore();
    }

    /** m:ss or h:mm:ss. */
    public static clock(seconds: number): string {
        const s = Math.max(0, Math.round(seconds));
        const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
        const two = (v: number): string => String(v).padStart(2, '0');

        return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
    }

    // ---- input ---------------------------------------------------------------------------------------------------

    private pick(x: number, y: number): {track: Prepared | null; sector: number | null} {
        const {cx, cy, R, band} = this.geo;
        const d = Math.hypot(x - cx, y - cy);

        if (d > R && d <= R + band + 4) {
            return {track: null, sector: EncounterGeometry.binOf(EncounterGeometry.bearing(cx, -cy, x, -y), this.bins)};
        }
        if (d > R) {
            return {track: null, sector: null};
        }

        let best: Prepared | null = null, bd = 7;

        for (const p of this.prepared) {
            if (p.screen.length < 2) {
                continue;
            }
            const dist = EncounterGeometry.distanceToPath(x, y, p.screen);
            if (dist < bd) {
                bd = dist;
                best = p;
            }
        }

        return {track: best, sector: null};
    }

    private readonly onMove = (e: PointerEvent): void => {
        const {x, y} = this.local(e);
        const hit = this.pick(x, y);

        if (hit.track !== this.hover) {
            this.hover = hit.track;
            this.events.emit('hover', hit.track === null ? null : this.toHover(hit.track));
        }
        if (hit.sector !== this.sector) {
            this.sector = hit.sector;
            this.events.emit('sectorHover', hit.sector === null ? null
                : {index: hit.sector, bearing: hit.sector / this.bins * 360, ids: [...(this.sectorIds[hit.sector] ?? [])]});
        }
        this.canvas.style.cursor = hit.track !== null || hit.sector !== null ? 'pointer' : '';
        this.redraw();
    };

    private readonly onLeave = (): void => {
        if (this.hover !== null) {
            this.hover = null;
            this.events.emit('hover', null);
        }
        if (this.sector !== null) {
            this.sector = null;
            this.events.emit('sectorHover', null);
        }
        this.redraw();
    };

    private readonly onClick = (e: MouseEvent): void => {
        const {x, y} = this.local(e);
        const hit = this.pick(x, y);

        this.selected = hit.track === null || hit.track.data.id === this.selected ? null : hit.track.data.id;
        this.events.emit('click', hit.track === null ? null : this.toHover(hit.track));
        this.redraw();
    };

    private readonly onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        this.zoom = Math.max(0.25, Math.min(40, this.zoom * Math.exp(-e.deltaY * 0.0015)));
        this.redraw();
    };

    private readonly onDblClick = (): void => {
        this.resetView();
    };

    private static copyEncounters(encounters: readonly EncounterData[]): EncounterData[] {
        return encounters.map((e) => ({...e, fixes: e.fixes.map((f) => ({...f}))}));
    }

    private toHover(p: Prepared): EncounterHover {
        return {encounter: p.data, category: this.categories[p.ci], stats: p.stats};
    }

}
