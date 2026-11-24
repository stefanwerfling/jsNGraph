import { Color } from '../util/Color';
import { ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { AssociationEncounter, AssociationIndex, AssociationPair, AssociationTally } from './AssociationIndex';

/** A known (photo-identified) individual. */
export interface SkyIndividual {
    id: string;
    name?: string;
    /** `SkyCategory.id` (e.g. the species). */
    category: string;
    /** Id of the mother: drawn as a dashed line once both are seen. */
    mother?: string;
}

export interface SkyCategory {
    id: string;
    name: string;
    color: string;
}

export interface SkyEncounter extends AssociationEncounter {
    id?: string;
    label?: string;
}

export interface AssociationSkyOptions {
    individuals?: SkyIndividual[];
    categories?: SkyCategory[];
    encounters?: SkyEncounter[];
    /** Show what was known at this time (default: the last encounter). */
    time?: number;
    /** Lines for pairs with HWI ≥ this (default 0.25). */
    minHwi?: number;
    /** Pairs with HWI ≥ this (and ≥ 2 encounters together) form a unit (default 0.5). */
    unitHwi?: number;
    /** Name of a unit, from its members (sorted ids); default none. */
    unitName?: (members: string[], index: number) => string | null;
    /** Encounters this recent (time units) flare up (default 21 days in ms). */
    flare?: number;
    /** Not seen for this long → the star fades (default 2 years in ms). */
    fadeAfter?: number;
    /** Time label (default ISO date). */
    formatTime?: (t: number) => string;
    /** Background stars twinkle (default true). */
    twinkle?: boolean;
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
}

export interface SkyIndividualInfo {
    individual: SkyIndividual;
    tally: AssociationTally;
    /** Strongest associates first. */
    associates: {id: string; hwi: number; together: number}[];
    /** Unit members (incl. itself) or [] when it belongs to none. */
    unit: string[];
    unitName: string | null;
}

export interface AssociationSkyEvents extends Record<string, unknown> {
    hover: SkyIndividualInfo | null;
    click: SkyIndividualInfo | null;
    unitHover: {members: string[]; name: string | null} | null;
}

interface Star {
    ind: SkyIndividual;
    color: string;
    wx: number;
    wy: number;
    sx: number;
    sy: number;
    r: number;
    tally: AssociationTally | null;
}

/**
 * A night sky of known individuals: every photo-identified animal is a
 * star (brighter the more often it was resighted), pairs that are often seen
 * together are joined by constellation lines (half-weight index), social
 * units get a faint outline and a name. Move the time and the sky fills up:
 * new stars appear, calves next to their mothers, recent encounters flare,
 * animals not seen for long fade. Hover/click a star for its associates.
 */
export class AssociationSky extends ChartSurface<AssociationSkyEvents> {

    private static readonly TAU = Math.PI * 2;
    private static readonly DAY = 86400000;

    private individuals: SkyIndividual[] = [];
    private categories: SkyCategory[] = [];
    private encounters: SkyEncounter[] = [];
    private byId = new Map<string, SkyIndividual>();
    private stars: Star[] = [];
    private starById = new Map<string, Star>();
    private time: number;
    private minHwi: number;
    private unitHwi: number;
    private readonly unitName: ((members: string[], index: number) => string | null) | null;
    private readonly flare: number;
    private readonly fadeAfter: number;
    private readonly formatTime: (t: number) => string;
    private readonly twinkle: boolean;
    private hidden = new Set<string>();
    private tally: ReturnType<typeof AssociationIndex.tally> = {seen: new Map(), together: new Map()};
    private pairs: AssociationPair[] = [];
    private units: string[][] = [];
    private unitNames: (string | null)[] = [];
    private unitOf = new Map<string, number>();
    private dirty = true;
    private hover: Star | null = null;
    private hoverUnit: number | null = null;
    private selected: string | null = null;
    private highlighted: Set<string> | null = null;
    private dust: {x: number; y: number; r: number; a: number; p: number}[] = [];
    private dustSize = '';
    private view = {zoom: 1, ox: 0, oy: 0};
    private drag: {x: number; y: number; ox: number; oy: number; moved: boolean} | null = null;
    private unitHulls: {x: number; y: number}[][] = [];

    public constructor(container: HTMLElement, options: AssociationSkyOptions = {}) {
        super(container, options.theme ?? {background: '#060a18', text: '#8d9bc0', title: '#e4e9ff'});
        this.minHwi = options.minHwi ?? 0.25;
        this.unitHwi = options.unitHwi ?? 0.5;
        this.unitName = options.unitName ?? null;
        this.flare = options.flare ?? 21 * AssociationSky.DAY;
        this.fadeAfter = options.fadeAfter ?? 730 * AssociationSky.DAY;
        this.formatTime = options.formatTime ?? ((t) => new Date(t).toISOString().slice(0, 10));
        this.twinkle = options.twinkle ?? true;
        this.time = options.time ?? Infinity;
        this.setData(options.individuals ?? [], options.encounters ?? [], options.categories);
        if (options.time !== undefined) {
            this.time = options.time;
        }

        this.canvas.addEventListener('pointerdown', this.onDown);
        this.canvas.addEventListener('pointermove', this.onMove);
        this.canvas.addEventListener('pointerup', this.onUp);
        this.canvas.addEventListener('pointercancel', this.onUp);
        this.canvas.addEventListener('pointerleave', this.onLeave);
        this.canvas.addEventListener('wheel', this.onWheel, {passive: false});
        this.canvas.addEventListener('dblclick', this.onDblClick);
        this.redraw();
    }

    // ---- data ---------------------------------------------------------------------------------------

    /** Replace everything; the layout is computed from all encounters, so stars keep their place over time. */
    public setData(individuals: SkyIndividual[], encounters: SkyEncounter[], categories?: SkyCategory[]): void {
        const list = individuals.map((i) => ({...i}));

        this.individuals = list;
        this.encounters = encounters.map((e) => ({...e, ids: e.ids.slice()})).sort((a, b) => a.t - b.t);
        if (categories !== undefined) {
            this.categories = categories.map((c) => ({...c}));
        }
        this.byId = new Map(list.map((i) => [i.id, i]));

        const all = AssociationIndex.pairs(AssociationIndex.tally(this.encounters));
        const extra: AssociationPair[] = list
            .filter((i) => i.mother !== undefined && this.byId.has(i.mother))
            .map((i) => ({a: i.id, b: i.mother!, together: 1, onlyA: 0, onlyB: 0, hwi: 1}));
        const pos = AssociationIndex.layout(list.map((i) => i.id), [...all, ...extra], {seed: 11});
        const color = new Map(this.categories.map((c) => [c.id, c.color]));

        this.stars = list.map((ind) => {
            const p = pos.get(ind.id) ?? {x: 0, y: 0};
            return {ind, color: color.get(ind.category) ?? this.theme.line, wx: p.x, wy: p.y, sx: 0, sy: 0, r: 0, tally: null};
        });
        this.starById = new Map(this.stars.map((s) => [s.ind.id, s]));
        if (this.time === Infinity || this.time > this.lastTime()) {
            this.time = this.lastTime();
        }
        this.dirty = true;
        this.redraw();
    }

    public setTime(t: number): void {
        this.time = t;
        this.dirty = true;
        this.redraw();
    }

    public getTime(): number {
        return this.time;
    }

    /** First and last encounter time. */
    public getRange(): [number, number] {
        return [this.encounters[0]?.t ?? 0, this.lastTime()];
    }

    public setMinHwi(v: number): void {
        this.minHwi = v;
        this.redraw();
    }

    public setUnitHwi(v: number): void {
        this.unitHwi = v;
        this.dirty = true;
        this.redraw();
    }

    public setCategoryVisible(id: string, visible: boolean): void {
        if (visible) {
            this.hidden.delete(id);
        } else {
            this.hidden.add(id);
        }
        this.redraw();
    }

    public select(id: string | null): void {
        this.selected = id;
        this.redraw();
    }

    public highlight(ids: string[] | null): void {
        this.highlighted = ids === null ? null : new Set(ids);
        this.redraw();
    }

    /** What is known about one individual at the current time (null if not yet seen). */
    public getInfo(id: string): SkyIndividualInfo | null {
        this.refresh();

        const ind = this.byId.get(id);
        const tally = this.tally.seen.get(id);

        if (ind === undefined || tally === undefined) {
            return null;
        }

        const associates = this.pairs
            .filter((p) => p.a === id || p.b === id)
            .map((p) => ({id: p.a === id ? p.b : p.a, hwi: p.hwi, together: p.together}));
        const u = this.unitOf.get(id);

        return {
            individual: {...ind}, tally: {...tally}, associates,
            unit: u === undefined ? [] : this.units[u]!.slice(),
            unitName: u === undefined ? null : this.unitNames[u] ?? null
        };
    }

    /** Current units with names. */
    public getUnits(): {members: string[]; name: string | null}[] {
        this.refresh();

        return this.units.map((m, i) => ({members: m.slice(), name: this.unitNames[i] ?? null}));
    }

    /** Encounters up to the current time. */
    public getEncounters(): SkyEncounter[] {
        return this.encounters.filter((e) => e.t <= this.time).map((e) => ({...e, ids: e.ids.slice()}));
    }

    /** Undo zoom and pan. */
    public resetView(): void {
        this.view = {zoom: 1, ox: 0, oy: 0};
        this.redraw();
    }

    public override destroy(): void {
        this.canvas.removeEventListener('pointerdown', this.onDown);
        this.canvas.removeEventListener('pointermove', this.onMove);
        this.canvas.removeEventListener('pointerup', this.onUp);
        this.canvas.removeEventListener('pointercancel', this.onUp);
        this.canvas.removeEventListener('pointerleave', this.onLeave);
        this.canvas.removeEventListener('wheel', this.onWheel);
        this.canvas.removeEventListener('dblclick', this.onDblClick);
        super.destroy();
    }

    private lastTime(): number {
        return this.encounters[this.encounters.length - 1]?.t ?? 0;
    }

    private refresh(): void {
        if (!this.dirty) {
            return;
        }
        this.dirty = false;
        this.tally = AssociationIndex.tally(this.encounters, this.time);
        this.pairs = AssociationIndex.pairs(this.tally);
        this.units = AssociationIndex.units(this.pairs, this.unitHwi);
        this.unitNames = this.units.map((m, i) => this.unitName?.(m, i) ?? null);
        this.unitOf = new Map();
        this.units.forEach((m, i) => m.forEach((id) => this.unitOf.set(id, i)));
        for (const s of this.stars) {
            s.tally = this.tally.seen.get(s.ind.id) ?? null;
        }
    }

    // ---- drawing ------------------------------------------------------------------------------------------

    private visible(s: Star): boolean {
        return s.tally !== null && !this.hidden.has(s.ind.category);
    }

    private fade(s: Star): number {
        if (s.tally === null) {
            return 0;
        }

        const age = this.time - s.tally.last;

        return age <= this.fadeAfter ? 1 : Math.max(0.22, 1 - (age - this.fadeAfter) / this.fadeAfter);
    }

    protected draw(ctx: CanvasRenderingContext2D, now: number): boolean {
        this.refresh();

        const W = this.width, H = this.height;
        const bg = ctx.createRadialGradient(W * 0.45, H * 0.4, 0, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.6);
        bg.addColorStop(0, Color.lerp(this.theme.background, '#1b2550', 0.55));
        bg.addColorStop(1, this.theme.background);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
        this.drawDust(ctx, now);

        // world → screen
        const scale = Math.min(W, H) * 0.44 * this.view.zoom;
        const cx = W / 2 + this.view.ox, cy = H / 2 + 8 + this.view.oy;

        for (const s of this.stars) {
            s.sx = cx + s.wx * scale * Math.max(1, W / H * 0.8);
            s.sy = cy + s.wy * scale;
            s.r = s.tally === null ? 0 : 1.2 + 1.05 * Math.log2(1 + s.tally.sightings);
        }

        const focus = this.focusSet();
        const lit = (id: string): number => (focus === null || focus.has(id) ? 1 : 0.18);

        this.drawUnits(ctx, focus);
        this.drawLinks(ctx, focus);
        this.drawFlares(ctx, focus);
        for (const s of this.stars) {
            if (this.visible(s)) {
                this.drawStar(ctx, s, this.fade(s) * lit(s.ind.id), now);
            }
        }
        this.drawLabels(ctx, focus);
        this.drawHeader(ctx);
        if (this.hover !== null && this.drag?.moved !== true) {
            this.drawTooltip(ctx, this.hover);
        }

        return this.twinkle;
    }

    private focusSet(): Set<string> | null {
        const id = this.hover?.ind.id ?? this.selected;

        if (id !== null && id !== undefined) {
            const set = new Set([id]);
            for (const p of this.pairs) {
                if (p.hwi >= this.minHwi && (p.a === id || p.b === id)) {
                    set.add(p.a === id ? p.b : p.a);
                }
            }
            const ind = this.byId.get(id);
            if (ind?.mother !== undefined) {
                set.add(ind.mother);
            }
            for (const i of this.individuals) {
                if (i.mother === id) {
                    set.add(i.id);
                }
            }
            return set;
        }
        if (this.hoverUnit !== null) {
            return new Set(this.units[this.hoverUnit] ?? []);
        }

        return this.highlighted;
    }

    private drawDust(ctx: CanvasRenderingContext2D, now: number): void {
        const size = `${this.width}x${this.height}`;

        if (size !== this.dustSize) {
            this.dustSize = size;
            let s = 97;
            const rnd = (): number => {
                s = (s * 16807) % 2147483647;
                return (s - 1) / 2147483646;
            };
            const n = Math.round(this.width * this.height / 1400);
            this.dust = [];
            for (let i = 0; i < n; i++) {
                // half of them crowd into a diagonal band (a milky way)
                let x = rnd() * this.width, y = rnd() * this.height;
                if (i % 2 === 0) {
                    const u = rnd();
                    const g = (rnd() + rnd() + rnd() - 1.5) * 0.18;
                    x = u * this.width;
                    y = this.height * (0.85 - 0.7 * u + g);
                }
                this.dust.push({x, y, r: 0.3 + Math.pow(rnd(), 3) * 1.1, a: 0.12 + rnd() * 0.45, p: rnd() * AssociationSky.TAU});
            }
        }
        ctx.fillStyle = '#ffffff';
        for (const d of this.dust) {
            const tw = this.twinkle ? 0.75 + 0.25 * Math.sin(now / 900 + d.p * 7) : 1;
            ctx.globalAlpha = d.a * tw * 0.6;
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.r, 0, AssociationSky.TAU);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    private drawUnits(ctx: CanvasRenderingContext2D, focus: Set<string> | null): void {
        this.unitHulls = [];
        this.units.forEach((members, i) => {
            const pts = members.map((id) => this.starById.get(id)).filter((s): s is Star => s !== undefined && this.visible(s));
            if (pts.length < 2) {
                this.unitHulls.push([]);
                return;
            }
            // pad every star into 8 points, then hull: a rounded outline
            const pad = 10;
            const ring: {x: number; y: number}[] = [];
            for (const s of pts) {
                for (let k = 0; k < 10; k++) {
                    ring.push({x: s.sx + Math.cos(k / 10 * AssociationSky.TAU) * (pad + s.r), y: s.sy + Math.sin(k / 10 * AssociationSky.TAU) * (pad + s.r)});
                }
            }
            const hull = AssociationIndex.hull(ring);
            this.unitHulls.push(hull);
            const on = focus === null || members.some((m) => focus.has(m));
            const color = pts[0]!.color;
            ctx.beginPath();
            hull.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.closePath();
            ctx.fillStyle = Color.withAlpha(color, this.hoverUnit === i ? 0.1 : on ? 0.045 : 0.015);
            ctx.fill();
            ctx.setLineDash([2, 5]);
            ctx.strokeStyle = Color.withAlpha(color, this.hoverUnit === i ? 0.7 : on ? 0.3 : 0.08);
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);
        });
    }

    private drawLinks(ctx: CanvasRenderingContext2D, focus: Set<string> | null): void {
        ctx.lineCap = 'round';
        for (const p of this.pairs) {
            if (p.hwi < this.minHwi) {
                continue;
            }
            const a = this.starById.get(p.a), b = this.starById.get(p.b);
            if (a === undefined || b === undefined || !this.visible(a) || !this.visible(b)) {
                continue;
            }
            const on = focus === null || (focus.has(p.a) && focus.has(p.b));
            const alpha = (0.12 + 0.55 * p.hwi) * Math.min(this.fade(a), this.fade(b)) * (on ? 1 : 0.12);
            ctx.strokeStyle = Color.withAlpha(Color.lerp(a.color, '#ffffff', 0.45), Math.min(1, alpha * (focus !== null && on ? 1.5 : 1)));
            ctx.lineWidth = 0.5 + 2.2 * p.hwi * p.hwi;
            ctx.beginPath();
            ctx.moveTo(a.sx, a.sy);
            ctx.lineTo(b.sx, b.sy);
            ctx.stroke();
        }
        // mother → calf
        ctx.setLineDash([3, 4]);
        for (const s of this.stars) {
            const m = s.ind.mother === undefined ? undefined : this.starById.get(s.ind.mother);
            if (m === undefined || !this.visible(s) || !this.visible(m)) {
                continue;
            }
            const on = focus === null || (focus.has(s.ind.id) && focus.has(m.ind.id));
            ctx.strokeStyle = Color.withAlpha('#ffd479', on ? 0.75 : 0.12);
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(m.sx, m.sy);
            ctx.lineTo(s.sx, s.sy);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    /** Recent encounters: a ring around each star in them, wider and fainter with age. */
    private drawFlares(ctx: CanvasRenderingContext2D, focus: Set<string> | null): boolean {
        let any = false;

        for (let i = this.encounters.length - 1; i >= 0; i--) {
            const e = this.encounters[i]!;
            if (e.t > this.time) {
                continue;
            }
            const age = (this.time - e.t) / this.flare;
            if (age > 1) {
                break;
            }
            any = true;
            const ss = e.ids.map((id) => this.starById.get(id)).filter((s): s is Star => s !== undefined && this.visible(s));
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (const s of ss) {
                const r = s.r + 4 + age * 22;
                ctx.strokeStyle = Color.withAlpha(s.color, 0.7 * (1 - age) * (focus === null || focus.has(s.ind.id) ? 1 : 0.15));
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(s.sx, s.sy, r, 0, AssociationSky.TAU);
                ctx.stroke();
            }
            ctx.restore();
        }

        return any;
    }

    private drawStar(ctx: CanvasRenderingContext2D, s: Star, alpha: number, now: number): void {
        const hot = this.hover === s || this.selected === s.ind.id;
        const tw = this.twinkle ? 0.9 + 0.1 * Math.sin(now / 700 + s.wx * 40 + s.wy * 17) : 1;
        const r = s.r * (hot ? 1.25 : 1);
        const core = Color.lerp(s.color, '#ffffff', 0.55);

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(s.sx, s.sy, 0, s.sx, s.sy, r * 2.8);
        g.addColorStop(0, Color.withAlpha(s.color, 0.4 * alpha * tw));
        g.addColorStop(1, Color.withAlpha(s.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, r * 2.8, 0, AssociationSky.TAU);
        ctx.fill();
        // diffraction spikes on bright stars
        if ((s.tally?.sightings ?? 0) >= 8) {
            const len = r * (2.6 + 0.4 * tw);
            ctx.strokeStyle = Color.withAlpha(core, 0.5 * alpha);
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(s.sx - len, s.sy);
            ctx.lineTo(s.sx + len, s.sy);
            ctx.moveTo(s.sx, s.sy - len);
            ctx.lineTo(s.sx, s.sy + len);
            ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle = Color.withAlpha(core, Math.min(1, alpha * 1.1));
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, r * 0.55, 0, AssociationSky.TAU);
        ctx.fill();
        if (hot) {
            ctx.strokeStyle = Color.withAlpha('#ffffff', 0.9);
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(s.sx, s.sy, r + 5, 0, AssociationSky.TAU);
            ctx.stroke();
        }
    }

    private drawLabels(ctx: CanvasRenderingContext2D, focus: Set<string> | null): void {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        // unit names above their outline
        this.units.forEach((members, i) => {
            const name = this.unitNames[i];
            const hull = this.unitHulls[i];
            if (name === null || name === undefined || hull === undefined || hull.length === 0) {
                return;
            }
            const top = hull.reduce((m, p) => (p.y < m.y ? p : m), hull[0]!);
            const xs = hull.map((p) => p.x);
            const on = focus === null || members.some((m) => focus.has(m));
            ctx.font = `600 11px ${ChartSurface.FONT_FAMILY}`;
            ctx.letterSpacing = '0.12em';
            ctx.fillStyle = Color.withAlpha(this.theme.title, on ? 0.8 : 0.2);
            ctx.fillText(name.toUpperCase(), (Math.min(...xs) + Math.max(...xs)) / 2, top.y - 4);
            ctx.letterSpacing = '0px';
        });
        // star names when zoomed in or in focus
        ctx.font = `11px ${ChartSurface.FONT_FAMILY}`;
        ctx.textBaseline = 'top';
        for (const s of this.stars) {
            if (!this.visible(s)) {
                continue;
            }
            const show = (focus !== null && focus.has(s.ind.id)) || this.view.zoom >= 1.8 || (s.tally?.sightings ?? 0) >= 18;
            if (!show) {
                continue;
            }
            ctx.fillStyle = Color.withAlpha(this.theme.text, 0.9 * this.fade(s));
            ctx.fillText(s.ind.name ?? s.ind.id, s.sx, s.sy + s.r + 5);
        }
    }

    private drawHeader(ctx: CanvasRenderingContext2D): void {
        const seen = this.stars.filter((s) => this.visible(s)).length;
        const enc = this.encounters.filter((e) => e.t <= this.time).length;

        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = `600 20px ui-monospace, monospace`;
        ctx.fillStyle = this.theme.title;
        ctx.fillText(this.formatTime(this.time), 16, 14);
        ctx.font = `12px ${ChartSurface.FONT_FAMILY}`;
        ctx.fillStyle = this.theme.text;
        ctx.fillText(`${seen} known individuals · ${this.units.length} units · ${enc} encounters`, 16, 40);
    }

    private drawTooltip(ctx: CanvasRenderingContext2D, s: Star): void {
        const info = this.getInfo(s.ind.id);

        if (info === null) {
            return;
        }

        const top = info.associates.slice(0, 3).map((a) => `${this.byId.get(a.id)?.name ?? a.id} ${a.hwi.toFixed(2)}`);
        const cat = this.categories.find((c) => c.id === s.ind.category);
        const lines = [
            `${s.ind.name ?? s.ind.id}${s.ind.name !== undefined ? ' · ' + s.ind.id : ''}`,
            `${cat?.name ?? s.ind.category}${info.unitName !== null ? ' · ' + info.unitName : ''}`,
            `${info.tally.sightings}× seen · first ${this.formatTime(info.tally.first)} · last ${this.formatTime(info.tally.last)}`,
            top.length > 0 ? `with ${top.join(', ')}` : 'no companions yet'
        ];

        ctx.save();
        ctx.font = `12px ${ChartSurface.FONT_FAMILY}`;
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
        const h = lines.length * 16 + 12;
        const x = Math.max(4, Math.min(this.width - w - 4, s.sx + 14));
        const y = Math.max(4, Math.min(this.height - h - 4, s.sy + 14));

        ctx.fillStyle = 'rgba(8,12,30,0.94)';
        ctx.strokeStyle = s.color;
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

    // ---- input ------------------------------------------------------------------------------------------------

    private pickStar(x: number, y: number): Star | null {
        let best: Star | null = null, bd = Infinity;

        for (const s of this.stars) {
            if (!this.visible(s)) {
                continue;
            }
            const d = Math.hypot(s.sx - x, s.sy - y);
            if (d < Math.max(8, s.r + 4) && d < bd) {
                bd = d;
                best = s;
            }
        }

        return best;
    }

    private pickUnit(x: number, y: number): number | null {
        for (let i = 0; i < this.unitHulls.length; i++) {
            const h = this.unitHulls[i]!;
            if (h.length < 3) {
                continue;
            }
            let inside = false;
            for (let a = 0, b = h.length - 1; a < h.length; b = a++) {
                const p = h[a]!, q = h[b]!;
                if ((p.y > y) !== (q.y > y) && x < (q.x - p.x) * (y - p.y) / (q.y - p.y) + p.x) {
                    inside = !inside;
                }
            }
            if (inside) {
                return i;
            }
        }

        return null;
    }

    private readonly onDown = (e: PointerEvent): void => {
        const p = this.local(e);

        this.drag = {x: p.x, y: p.y, ox: this.view.ox, oy: this.view.oy, moved: false};
        this.canvas.setPointerCapture(e.pointerId);
    };

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);

        if (this.drag !== null) {
            const dx = p.x - this.drag.x, dy = p.y - this.drag.y;
            if (Math.hypot(dx, dy) > 3) {
                this.drag.moved = true;
            }
            if (this.drag.moved) {
                this.view.ox = this.drag.ox + dx;
                this.view.oy = this.drag.oy + dy;
                this.canvas.style.cursor = 'grabbing';
                this.redraw();
                return;
            }
        }

        const star = this.pickStar(p.x, p.y);
        const unit = star === null ? this.pickUnit(p.x, p.y) : null;

        if (star !== this.hover) {
            this.hover = star;
            this.events.emit('hover', star === null ? null : this.getInfo(star.ind.id));
        }
        if (unit !== this.hoverUnit) {
            this.hoverUnit = unit;
            this.events.emit('unitHover', unit === null ? null : {members: [...this.units[unit]!], name: this.unitNames[unit] ?? null});
        }
        this.canvas.style.cursor = star !== null ? 'pointer' : 'grab';
        this.redraw();
    };

    private readonly onUp = (e: PointerEvent): void => {
        const d = this.drag;

        this.drag = null;
        if (this.canvas.hasPointerCapture(e.pointerId)) {
            this.canvas.releasePointerCapture(e.pointerId);
        }
        this.canvas.style.cursor = 'grab';
        if (d !== null && !d.moved && e.type === 'pointerup') {
            const p = this.local(e);
            const star = this.pickStar(p.x, p.y);
            this.selected = star === null || star.ind.id === this.selected ? null : star.ind.id;
            this.events.emit('click', this.selected === null ? null : this.getInfo(this.selected));
            this.redraw();
        }
    };

    private readonly onLeave = (): void => {
        this.hover = null;
        this.hoverUnit = null;
        this.events.emit('hover', null);
        this.redraw();
    };

    private readonly onWheel = (e: WheelEvent): void => {
        e.preventDefault();

        const p = this.local(e);
        const z0 = this.view.zoom;
        const z1 = Math.max(0.5, Math.min(8, z0 * Math.exp(-e.deltaY * 0.0015)));
        const cx = this.width / 2 + this.view.ox, cy = this.height / 2 + 8 + this.view.oy;

        // keep the point under the pointer
        this.view.ox += (p.x - cx) * (1 - z1 / z0);
        this.view.oy += (p.y - cy) * (1 - z1 / z0);
        this.view.zoom = z1;
        this.redraw();
    };

    private readonly onDblClick = (): void => {
        this.resetView();
    };

}
