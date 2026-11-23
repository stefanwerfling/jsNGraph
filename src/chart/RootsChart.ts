import { Camera } from '../view/Camera';
import { Color } from '../util/Color';
import { ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { RootsBar, RootsLayout as L, RootsLink } from './RootsLayout';

/** A discipline (or any category) the actors come from; bars are drawn in the given order. */
export interface RootsCategory {
    id: string;
    name: string;
    color: string;
}

/** A person (or anything placed in time) rooted in one or more categories. */
export interface RootsActor {
    id: string;
    name: string;
    /** Where it sits on the time axis (e.g. year of the main contribution). */
    year: number;
    /** `RootsCategory.id`s; the first one is the main one (drawn a little wider). */
    categories: string[];
    /** Short text above the marker (the contribution). */
    caption?: string;
    /** A later (or earlier) work drawn as a line to a second marker. */
    contribution?: {year: number; label: string};
}

export interface RootsChartOptions {
    categories?: RootsCategory[];
    actors?: RootsActor[];
    /** Time axis; default: the actors' years rounded out to 10. */
    from?: number;
    to?: number;
    /** Width of the picture in world units (text sizes are fixed in them; default 1600). */
    width?: number;
    /** Arcs between categories shared by at least this many actors (default 2; 0 = none). */
    minLink?: number;
    /** Show only actors up to this year (null = all); bars and arcs follow, strands grow. */
    time?: number | null;
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
}

export type RootsFocus =
    | {kind: 'actor'; id: string}
    | {kind: 'category'; id: string}
    | {kind: 'link'; a: string; b: string};

export type RootsHover =
    | {kind: 'actor'; actor: RootsActor; categories: RootsCategory[]}
    | {kind: 'category'; category: RootsCategory; actors: RootsActor[]}
    | {kind: 'link'; a: RootsCategory; b: RootsCategory; actors: RootsActor[]};

export interface RootsChartEvents extends Record<string, unknown> {
    hover: RootsHover | null;
    click: RootsHover | null;
}

interface PActor {
    data: RootsActor;
    cats: number[];
    x: number;
    y: number;
    caption: string[];
    nameW: number;
    capW: number;
    /** Strand cubic per category (same order as cats) and its sampled polyline. */
    strands: number[][];
    samples: number[][];
    cx: number | null;
    vis: number;
}

interface PBar extends RootsBar {
    label: string[];
    /** Animated number of visible actors. */
    count: number;
}

const FONT = 'system-ui, -apple-system, sans-serif';
const CAP = 7.5;
const NAME = 9;
const ROW = 44;
const UNIT = 3.2;
const HEAD = 5;

/**
 * Where does something come from: actors on a time axis, each tied by a
 * coloured strand to every category it is rooted in — bars along the bottom
 * whose height counts their actors — and dotted arcs under the bars for the
 * categories that share actors. Hover an actor, a bar or an arc to light its
 * part of the web; `setTime` replays how the bars filled up. Pan/zoom with a
 * camera, since the picture is poster sized.
 */
export class RootsChart extends ChartSurface<RootsChartEvents> {

    private categories: RootsCategory[] = [];
    private actors: RootsActor[] = [];
    private pa: PActor[] = [];
    private bars: PBar[] = [];
    private links: RootsLink[] = [];
    private from = 0;
    private to = 1;
    private fixedFrom: number | undefined;
    private fixedTo: number | undefined;
    private readonly worldW: number;
    private minLink: number;
    private time: number | null;
    private x0 = 0;
    private x1 = 1;
    private barsTop = 0;
    private bottom = 0;
    private readonly camera = new Camera(0.1, 8);
    private userMoved = false;
    private fitW = 0;
    private fitH = 0;
    private hover: RootsFocus | null = null;
    private pinned: RootsFocus | null = null;
    private external: RootsFocus | null = null;
    private pointer: {x: number; y: number} | null = null;
    private drag: {x: number; y: number; moved: boolean} | null = null;
    private lastTime = -1;

    public constructor(container: HTMLElement, options: RootsChartOptions = {}) {
        super(container, options.theme ?? 'dark');
        this.worldW = options.width ?? 1600;
        this.minLink = options.minLink ?? 2;
        this.time = options.time ?? null;
        this.fixedFrom = options.from;
        this.fixedTo = options.to;

        this.canvas.addEventListener('pointerdown', this.onDown);
        this.canvas.addEventListener('pointermove', this.onMove);
        this.canvas.addEventListener('pointerup', this.onUp);
        this.canvas.addEventListener('pointerleave', this.onLeave);
        this.canvas.addEventListener('wheel', this.onWheel, {passive: false});
        this.canvas.addEventListener('dblclick', this.onDblClick);
        this.setData(options.actors ?? [], options.categories ?? []);
    }

    // ---- data -----------------------------------------------------------------------------------------------

    public setData(actors: RootsActor[], categories?: RootsCategory[]): void {
        this.actors = actors;
        if (categories !== undefined) {
            this.categories = categories;
        }
        this.prepare();
        this.userMoved = false;
        this.redraw();
    }

    /** Show only actors up to `year` (null = all). */
    public setTime(year: number | null): void {
        this.time = year;
        this.redraw();
    }

    public getTime(): number | null {
        return this.time;
    }

    /** The time axis in use. */
    public getRange(): {from: number; to: number} {
        return {from: this.from, to: this.to};
    }

    public setMinLink(min: number): void {
        this.minLink = min;
        this.links = L.links(this.pa.map((p) => ({id: p.data.id, categories: p.cats})), Math.max(1, min));
        this.redraw();
    }

    /** Light a part of the web from outside (e.g. a legend); null clears. Hover and click still win. */
    public focus(target: RootsFocus | null): void {
        this.external = target;
        this.redraw();
    }

    /** Pin a focus like a click would (null clears). */
    public select(target: RootsFocus | null): void {
        this.pinned = target;
        this.redraw();
    }

    /** Frame the whole picture (animated). */
    public fit(animate = true): void {
        this.userMoved = false;
        this.camera.flyTo(this.fitState(), animate ? 350 : 0);
        this.redraw();
    }

    /** Actors per category currently shown. */
    public getCounts(): Record<string, number> {
        const out: Record<string, number> = {};

        this.categories.forEach((c, i) => {
            out[c.id] = this.pa.filter((p) => this.shown(p) && p.cats.includes(i)).length;
        });

        return out;
    }

    // ---- layout ---------------------------------------------------------------------------------------------

    private prepare(): void {
        const ctx = this.ctx;
        const catIndex = new Map(this.categories.map((c, i) => [c.id, i]));
        const years = this.actors.flatMap((a) => [a.year, ...(a.contribution !== undefined ? [a.contribution.year] : [])]);
        const lo = years.length > 0 ? Math.min(...years) : 0;
        const hi = years.length > 0 ? Math.max(...years) : 10;

        this.from = this.fixedFrom ?? Math.floor(lo / 10) * 10;
        this.to = this.fixedTo ?? Math.ceil((hi + 1) / 10) * 10;
        this.x0 = 60;
        this.x1 = this.worldW - 60;

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const measure = (font: string) => (s: string): number => {
            ctx.font = font;
            return ctx.measureText(s).width;
        };
        const capW = measure(`italic ${CAP}px ${FONT}`);
        const nameW = measure(`600 ${NAME}px ${FONT}`);
        const barW = measure(`10px ${FONT}`);

        const pre = this.actors.map((a) => {
            const caption = a.caption !== undefined && a.caption !== '' ? L.wrap(a.caption, 118, capW).slice(0, 2) : [];
            const cw = Math.max(0, ...caption.map(capW));
            const nw = nameW(a.name);
            let left = Math.max(nw, cw) / 2 + 2, right = left;

            if (a.contribution !== undefined) {
                const dx = (a.contribution.year - a.year) / ((this.to - this.from) || 1) * (this.x1 - this.x0);
                const lw = capW(a.contribution.label) / 2 + 4;
                right = Math.max(right, dx + lw);
                left = Math.max(left, -dx + lw);
            }

            return {a, caption, cw, nw, left, right};
        });
        const {placed, rows} = L.place(pre.map((p) => ({id: p.a.id, year: p.a.year, left: p.left, right: p.right})),
            {from: this.from, to: this.to, x0: this.x0, x1: this.x1, top: 74, rowH: ROW, minRows: 8});

        this.barsTop = 74 + rows * ROW + 150;
        const bars = L.bars(this.categories.length, this.x0, this.x1);
        const old = new Map(this.bars.map((b, i) => [this.categories[i]?.id, b.count]));
        this.bars = bars.map((b, i) => ({
            ...b, label: L.wrap(this.categories[i]!.name, b.w - 6, barW).slice(0, 3),
            count: old.get(this.categories[i]!.id) ?? 0
        }));

        const prev = new Map(this.pa.map((p) => [p.data.id, p.vis]));
        this.pa = pre.map(({a, caption, cw, nw}) => {
            const pos = placed.get(a.id)!;
            const cats = a.categories.map((c) => catIndex.get(c)).filter((i): i is number => i !== undefined);
            const strands = cats.map((ci, k) => {
                const dx = (k - (cats.length - 1) / 2) * 2.6;
                return L.strand(pos.x + dx, pos.y + 16, this.bars[ci]!.cx, this.barsTop);
            });

            return {
                data: a, cats, x: pos.x, y: pos.y, caption, nameW: nw, capW: cw, strands,
                samples: strands.map((s) => L.sample(s, 18)),
                cx: a.contribution !== undefined ? L.xOf(a.contribution.year, this.from, this.to, this.x0, this.x1) : null,
                vis: prev.get(a.id) ?? 0
            };
        });
        this.links = L.links(this.pa.map((p) => ({id: p.data.id, categories: p.cats})), Math.max(1, this.minLink));
        ctx.restore();

        const maxCount = Math.max(0, ...L.counts(this.pa.map((p) => p.cats), this.categories.length));
        // lowest point of any arc (at its middle) with every bar full: the picture's bottom
        const anchorMax = this.barsTop + HEAD + maxCount * UNIT + 10 + 3 * 11 + 2;
        const span = Math.max(0, ...this.links.map((l) => Math.abs(this.bars[l.b]!.cx - this.bars[l.a]!.cx)));
        this.bottom = anchorMax + (24 + span * 0.12) / 2 + 16;
    }

    private shown(p: PActor): boolean {
        return this.time === null || p.data.year <= this.time;
    }

    /** Where a bar's label ends (anchor of its arcs), for the animated count. */
    private anchorY(i: number): number {
        const b = this.bars[i]!;

        return this.barsTop + HEAD + b.count * UNIT + 10 + b.label.length * 11 + 2;
    }

    private fitState(): ReturnType<Camera['fitState']> {
        return this.camera.fitState({minX: 0, minY: -10, maxX: this.worldW, maxY: this.bottom}, this.width, this.height, 12, 12);
    }

    // ---- focus ----------------------------------------------------------------------------------------------

    private currentFocus(): RootsFocus | null {
        return this.hover ?? this.pinned ?? this.external;
    }

    /** Light level of actors, strands (actor index + category), bars and links under the current focus. */
    private lit(): {actor: (p: PActor) => number; strand: (p: PActor, ci: number) => number; bar: (i: number) => number;
        link: (l: RootsLink) => number;} | null {
        const f = this.currentFocus();

        if (f === null) {
            return null;
        }
        const idx = (id: string): number => this.categories.findIndex((c) => c.id === id);

        if (f.kind === 'actor') {
            const me = this.pa.find((p) => p.data.id === f.id);
            const cats = new Set(me?.cats ?? []);
            return {
                actor: (p) => p === me ? 1 : 0.22,
                strand: (p) => p === me ? 1 : 0.05,
                bar: (i) => cats.has(i) ? 1 : 0.3,
                link: (l) => cats.has(l.a) && cats.has(l.b) ? 1 : 0.1
            };
        }
        if (f.kind === 'category') {
            const c = idx(f.id);
            return {
                actor: (p) => p.cats.includes(c) ? 1 : 0.22,
                strand: (p, ci) => ci === c ? 1 : p.cats.includes(c) ? 0.22 : 0.04,
                bar: (i) => i === c ? 1 : 0.3,
                link: (l) => l.a === c || l.b === c ? 1 : 0.1
            };
        }
        const a = idx(f.a), b = idx(f.b);
        const both = (p: PActor): boolean => p.cats.includes(a) && p.cats.includes(b);

        return {
            actor: (p) => both(p) ? 1 : 0.22,
            strand: (p, ci) => both(p) && (ci === a || ci === b) ? 1 : both(p) ? 0.25 : 0.04,
            bar: (i) => i === a || i === b ? 1 : 0.3,
            link: (l) => (l.a === a && l.b === b) || (l.a === b && l.b === a) ? 1 : 0.1
        };
    }

    // ---- drawing --------------------------------------------------------------------------------------------

    protected draw(ctx: CanvasRenderingContext2D, timeMs: number): boolean {
        const dt = this.lastTime < 0 ? 16 : Math.min(100, timeMs - this.lastTime);
        this.lastTime = timeMs;

        if (!this.userMoved && (this.fitW !== this.width || this.fitH !== this.height)) {
            this.camera.setState(this.fitState());
            this.fitW = this.width;
            this.fitH = this.height;
        }
        const flying = this.camera.step(timeMs);
        const moving = this.step(dt);
        const lit = this.lit();

        ctx.save();
        this.camera.apply(ctx);
        this.drawAxis(ctx);
        this.drawStrands(ctx, lit);
        this.drawBars(ctx, lit);
        this.drawLinks(ctx, lit);
        this.drawActors(ctx, lit);
        ctx.restore();
        this.drawTooltip(ctx);

        if (!moving && !flying) {
            this.lastTime = -1;
        }

        return moving || flying;
    }

    private step(dt: number): boolean {
        const k = 1 - Math.exp(-dt / 260);
        let moving = false;
        const counts = new Array<number>(this.bars.length).fill(0);

        for (const p of this.pa) {
            const target = this.shown(p) ? 1 : 0;
            const d = target - p.vis;
            if (Math.abs(d) > 0.002) {
                p.vis += d * k;
                moving = true;
            } else {
                p.vis = target;
            }
            for (const c of new Set(p.cats)) {
                counts[c]! += target;
            }
        }
        this.bars.forEach((b, i) => {
            const d = counts[i]! - b.count;
            if (Math.abs(d) > 0.01) {
                b.count += d * k;
                moving = true;
            } else {
                b.count = counts[i]!;
            }
        });

        return moving;
    }

    private drawAxis(ctx: CanvasRenderingContext2D): void {
        const theme = this.theme;
        const span = this.to - this.from;
        const step = L.yearStep(span, Math.max(3, Math.floor((this.x1 - this.x0) / 260)));
        const xOf = (y: number): number => L.xOf(y, this.from, this.to, this.x0, this.x1);

        ctx.save();
        // band with one faint line per actor year
        ctx.fillStyle = Color.withAlpha(theme.title, 0.05);
        ctx.fillRect(this.x0 - 30, 0, this.x1 - this.x0 + 60, 28);
        ctx.strokeStyle = Color.withAlpha(theme.title, 0.18);
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        for (const p of this.pa) {
            if (this.shown(p)) {
                ctx.moveTo(p.x, 2);
                ctx.lineTo(p.x, 26);
            }
        }
        ctx.stroke();

        // ticks: faint guides down to the bars
        ctx.strokeStyle = theme.grid;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let y = Math.ceil(this.from / step) * step; y <= this.to; y += step) {
            ctx.moveTo(xOf(y), 28);
            ctx.lineTo(xOf(y), this.barsTop - 20);
        }
        ctx.stroke();
        ctx.fillStyle = theme.title;
        ctx.font = `600 11px ${FONT}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        for (let y = Math.ceil(this.from / step) * step; y <= this.to; y += step) {
            ctx.fillStyle = Color.withAlpha(theme.background, 0.8);
            const w = ctx.measureText(String(y)).width + 8;
            ctx.fillRect(xOf(y) - w / 2, 7, w, 14);
            ctx.fillStyle = theme.title;
            ctx.fillText(String(y), xOf(y), 14.5);
        }
        if (this.time !== null && this.time < this.to) {
            const x = xOf(this.time);
            ctx.strokeStyle = theme.marker;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.barsTop - 20);
            ctx.stroke();
        }
        ctx.restore();
    }

    private drawStrands(ctx: CanvasRenderingContext2D, lit: ReturnType<RootsChart['lit']>): void {
        ctx.save();
        ctx.lineCap = 'round';
        // dim first, lit last
        const order: Array<{p: PActor; k: number; l: number}> = [];

        for (const p of this.pa) {
            if (p.vis <= 0.003) {
                continue;
            }
            p.cats.forEach((ci, k) => order.push({p, k, l: lit === null ? 0.55 : lit.strand(p, ci)}));
        }
        order.sort((a, b) => a.l - b.l);

        for (const {p, k, l} of order) {
            const ci = p.cats[k]!;
            const s = p.samples[k]!;
            // grow downwards while appearing
            const n = Math.max(2, Math.round((s.length / 2) * p.vis));
            ctx.globalAlpha = (lit === null ? 0.55 : l) * Math.min(1, p.vis * 1.5);
            ctx.strokeStyle = this.categories[ci]!.color;
            ctx.lineWidth = (k === 0 ? 1.9 : 1.3) * (lit !== null && l >= 1 ? 1.4 : 1);
            ctx.beginPath();
            if (n * 2 >= s.length) {
                const c = p.strands[k]!;
                ctx.moveTo(c[0]!, c[1]!);
                ctx.bezierCurveTo(c[2]!, c[3]!, c[4]!, c[5]!, c[6]!, c[7]!);
            } else {
                ctx.moveTo(s[0]!, s[1]!);
                for (let i = 1; i < n; i++) {
                    ctx.lineTo(s[i * 2]!, s[i * 2 + 1]!);
                }
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    private drawBars(ctx: CanvasRenderingContext2D, lit: ReturnType<RootsChart['lit']>): void {
        const theme = this.theme;

        ctx.save();
        this.bars.forEach((b, i) => {
            const cat = this.categories[i]!;
            const a = lit === null ? 1 : lit.bar(i);
            const h = b.count * UNIT;
            const top = this.barsTop;

            ctx.globalAlpha = a;
            ctx.fillStyle = cat.color;
            ctx.fillRect(b.x + 0.5, top, b.w - 1, HEAD);
            ctx.fillStyle = Color.withAlpha(cat.color, 0.55);
            ctx.fillRect(b.x + 0.5, top + HEAD, b.w - 1, h);
            // one line per contributor
            ctx.strokeStyle = Color.withAlpha(theme.background, 0.55);
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            for (let k = 1; k < Math.floor(b.count + 1e-6); k++) {
                const y = top + HEAD + k * UNIT;
                ctx.moveTo(b.x + 0.5, y);
                ctx.lineTo(b.x + b.w - 0.5, y);
            }
            ctx.stroke();

            ctx.fillStyle = Color.lerp(cat.color, '#ffffff', 0.2);
            ctx.font = `10px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            b.label.forEach((line, k) => ctx.fillText(line, b.cx, top + HEAD + h + 5 + k * 11));
        });
        ctx.restore();
    }

    private linkGeometry(l: RootsLink): number[] {
        const a = this.bars[l.a]!, b = this.bars[l.b]!;

        return L.arc(a.cx, this.anchorY(l.a), b.cx, this.anchorY(l.b), 24, 0.12);
    }

    private drawLinks(ctx: CanvasRenderingContext2D, lit: ReturnType<RootsChart['lit']>): void {
        const shownCount = (l: RootsLink): number => l.members.reduce((s, id) => {
            const p = this.pa.find((q) => q.data.id === id);
            return s + (p !== undefined && this.shown(p) ? 1 : 0);
        }, 0);

        ctx.save();
        ctx.lineCap = 'round';
        for (const l of [...this.links].reverse()) {
            const count = shownCount(l);
            if (count < Math.max(1, this.minLink)) {
                continue;
            }
            const q = this.linkGeometry(l);
            const ca = this.categories[l.a]!.color, cb = this.categories[l.b]!.color;
            const g = ctx.createLinearGradient(q[0]!, q[1]!, q[4]!, q[5]!);
            g.addColorStop(0, ca);
            g.addColorStop(1, cb);
            ctx.globalAlpha = (lit === null ? 0.75 : lit.link(l));
            ctx.strokeStyle = g;
            ctx.lineWidth = 1 + 0.55 * Math.sqrt(count);
            ctx.setLineDash([0.01, 2.6 + ctx.lineWidth]);
            ctx.beginPath();
            ctx.moveTo(q[0]!, q[1]!);
            ctx.quadraticCurveTo(q[2]!, q[3]!, q[4]!, q[5]!);
            ctx.stroke();
            ctx.setLineDash([]);
            const [mx, my] = L.quadAt(q, 0.5);
            ctx.font = `8px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = Color.lerp(ca, cb, 0.5);
            ctx.fillText(String(count), mx, my - 3);
        }
        ctx.restore();
    }

    private drawActors(ctx: CanvasRenderingContext2D, lit: ReturnType<RootsChart['lit']>): void {
        const theme = this.theme;
        const sc = this.camera.scale;
        const showCaption = CAP * sc >= 5.5;
        const showName = NAME * sc >= 4;
        const f = this.currentFocus();

        ctx.save();
        ctx.textAlign = 'center';
        for (const p of this.pa) {
            if (p.vis <= 0.02) {
                continue;
            }
            const a = (lit === null ? 1 : lit.actor(p)) * p.vis;
            const strong = f !== null && f.kind === 'actor' && f.id === p.data.id;
            ctx.globalAlpha = a;

            // the marker
            ctx.strokeStyle = theme.title;
            ctx.lineWidth = strong ? 1.6 : 1.1;
            const cross = (x: number, y: number, r: number): void => {
                ctx.beginPath();
                ctx.moveTo(x - r, y - r);
                ctx.lineTo(x + r, y + r);
                ctx.moveTo(x + r, y - r);
                ctx.lineTo(x - r, y + r);
                ctx.stroke();
            };
            cross(p.x, p.y, 3);

            if (p.cx !== null && p.data.contribution !== undefined) {
                ctx.lineWidth = 0.7;
                ctx.beginPath();
                ctx.moveTo(p.x + Math.sign(p.cx - p.x) * 5, p.y);
                ctx.lineTo(p.cx - Math.sign(p.cx - p.x) * 5, p.y);
                ctx.stroke();
                cross(p.cx, p.y, 3);
                if (showCaption) {
                    ctx.font = `italic ${CAP}px ${FONT}`;
                    ctx.fillStyle = theme.text;
                    // under its marker, so it never meets the actor's own caption above
                    ctx.textBaseline = 'top';
                    ctx.fillText(p.data.contribution.label, p.cx, p.y + 5);
                }
            }
            if (showName) {
                ctx.font = `600 ${NAME}px ${FONT}`;
                ctx.textBaseline = 'top';
                // a dark halo keeps names readable over the strands
                ctx.lineWidth = 2.5;
                ctx.strokeStyle = Color.withAlpha(theme.background, 0.85);
                ctx.lineJoin = 'round';
                ctx.strokeText(p.data.name, p.x, p.y + 5);
                ctx.fillStyle = strong ? theme.select : theme.title;
                ctx.fillText(p.data.name, p.x, p.y + 5);
            }
            if (showCaption && p.caption.length > 0) {
                ctx.font = `italic ${CAP}px ${FONT}`;
                ctx.fillStyle = theme.text;
                ctx.textBaseline = 'bottom';
                p.caption.forEach((line, k) => ctx.fillText(line, p.x, p.y - 5 - (p.caption.length - 1 - k) * 8.5));
            }
        }
        ctx.restore();
    }

    private hoverInfo(f: RootsFocus | null): RootsHover | null {
        if (f === null) {
            return null;
        }
        if (f.kind === 'actor') {
            const p = this.pa.find((q) => q.data.id === f.id);
            return p === undefined ? null : {kind: 'actor', actor: p.data, categories: p.cats.map((i) => this.categories[i]!)};
        }
        if (f.kind === 'category') {
            const i = this.categories.findIndex((c) => c.id === f.id);
            return i < 0 ? null : {
                kind: 'category', category: this.categories[i]!,
                actors: this.pa.filter((p) => this.shown(p) && p.cats.includes(i)).map((p) => p.data)
            };
        }
        const a = this.categories.findIndex((c) => c.id === f.a), b = this.categories.findIndex((c) => c.id === f.b);

        return a < 0 || b < 0 ? null : {
            kind: 'link', a: this.categories[a]!, b: this.categories[b]!,
            actors: this.pa.filter((p) => this.shown(p) && p.cats.includes(a) && p.cats.includes(b)).map((p) => p.data)
        };
    }

    private drawTooltip(ctx: CanvasRenderingContext2D): void {
        const info = this.hover !== null ? this.hoverInfo(this.hover) : null;

        if (info === null || this.pointer === null || this.drag?.moved === true) {
            return;
        }
        let lines: string[];
        let color: string;

        if (info.kind === 'actor') {
            const a = info.actor;
            lines = [a.name, `${a.year}${a.caption !== undefined ? ` · ${a.caption}` : ''}`,
                ...(a.contribution !== undefined ? [`${a.contribution.year} · ${a.contribution.label}`] : []),
                info.categories.map((c) => c.name).join(' · ')];
            color = info.categories[0]?.color ?? this.theme.line;
        } else if (info.kind === 'category') {
            const ys = info.actors.map((a) => a.year);
            lines = [info.category.name, `${info.actors.length} contributors`,
                ...(ys.length > 0 ? [`${Math.min(...ys)} – ${Math.max(...ys)}`] : [])];
            color = info.category.color;
        } else {
            const names = info.actors.map((a) => a.name);
            lines = [`${info.a.name} ↔ ${info.b.name}`, `${names.length} shared`,
                ...L.wrap(names.slice(0, 8).join(', ') + (names.length > 8 ? ' …' : ''), 260, (s) => {
                    ctx.font = `12px ${FONT}`;
                    return ctx.measureText(s).width;
                })];
            color = info.a.color;
        }

        ctx.save();
        ctx.font = `12px ${FONT}`;
        const w = Math.min(320, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 22);
        const h = lines.length * 16 + 12;
        const x = Math.max(4, Math.min(this.width - w - 4, this.pointer.x + 14));
        const y = Math.max(4, Math.min(this.height - h - 4, this.pointer.y + 14));

        ctx.fillStyle = Color.withAlpha(this.theme.background, 0.95);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 5);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        lines.forEach((l, i) => {
            ctx.font = i === 0 ? `600 12px ${FONT}` : `12px ${FONT}`;
            ctx.fillStyle = i === 0 ? this.theme.title : this.theme.text;
            ctx.fillText(l, x + 10, y + 7 + i * 16, w - 20);
        });
        ctx.restore();
    }

    // ---- input ----------------------------------------------------------------------------------------------

    private pick(sx: number, sy: number): RootsFocus | null {
        const {x, y} = this.camera.toWorld(sx, sy);
        const tol = 4 / this.camera.scale;

        // actors: marker, name and caption
        for (const p of this.pa) {
            if (p.vis < 0.5) {
                continue;
            }
            const half = Math.max(p.nameW, p.capW, 8) / 2;
            if (Math.abs(x - p.x) <= half + tol && y >= p.y - 6 - p.caption.length * 8.5 - tol && y <= p.y + 16 + tol) {
                return {kind: 'actor', id: p.data.id};
            }
        }
        // bars with their labels, and just above them where every strand of a bar meets
        for (let i = 0; i < this.bars.length; i++) {
            const b = this.bars[i]!;
            if (x >= b.x && x <= b.x + b.w && y >= this.barsTop - 30 && y <= this.anchorY(i)) {
                return {kind: 'category', id: this.categories[i]!.id};
            }
        }
        // arcs below
        if (y > this.barsTop) {
            let best: RootsLink | null = null, bd = tol + 3 / this.camera.scale;
            for (const l of this.links) {
                const q = this.linkGeometry(l);
                const poly: number[] = [];
                for (let k = 0; k <= 20; k++) {
                    poly.push(...L.quadAt(q, k / 20));
                }
                const d = L.distanceToPath(x, y, poly);
                if (d < bd) {
                    bd = d;
                    best = l;
                }
            }
            if (best !== null) {
                return {kind: 'link', a: this.categories[best.a]!.id, b: this.categories[best.b]!.id};
            }
            return null;
        }
        // strands
        let best: PActor | null = null, bd = tol;
        for (const p of this.pa) {
            if (p.vis < 0.5) {
                continue;
            }
            for (const s of p.samples) {
                const d = L.distanceToPath(x, y, s);
                if (d < bd) {
                    bd = d;
                    best = p;
                }
            }
        }

        return best === null ? null : {kind: 'actor', id: best.data.id};
    }

    private static same(a: RootsFocus | null, b: RootsFocus | null): boolean {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    private readonly onDown = (e: PointerEvent): void => {
        this.drag = {...this.local(e), moved: false};
        this.canvas.setPointerCapture(e.pointerId);
    };

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);
        this.pointer = p;

        if (this.drag !== null) {
            const dx = p.x - this.drag.x, dy = p.y - this.drag.y;
            if (this.drag.moved || Math.hypot(dx, dy) > 3) {
                this.drag.moved = true;
                this.camera.cancelFlight();
                this.camera.panBy(dx, dy);
                this.drag.x = p.x;
                this.drag.y = p.y;
                this.userMoved = true;
                this.canvas.style.cursor = 'grabbing';
                this.redraw();
                return;
            }
        }
        const hit = this.pick(p.x, p.y);
        this.canvas.style.cursor = hit !== null ? 'pointer' : 'grab';
        if (!RootsChart.same(hit, this.hover)) {
            this.hover = hit;
            this.events.emit('hover', this.hoverInfo(hit));
        }
        this.redraw();
    };

    private readonly onUp = (e: PointerEvent): void => {
        const d = this.drag;
        this.drag = null;
        if (this.canvas.hasPointerCapture(e.pointerId)) {
            this.canvas.releasePointerCapture(e.pointerId);
        }
        if (d !== null && !d.moved) {
            const p = this.local(e);
            const hit = this.pick(p.x, p.y);
            this.pinned = hit === null || RootsChart.same(hit, this.pinned) ? null : hit;
            this.events.emit('click', this.hoverInfo(this.pinned));
        }
        this.canvas.style.cursor = 'grab';
        this.redraw();
    };

    private readonly onLeave = (): void => {
        this.pointer = null;
        if (this.hover !== null) {
            this.hover = null;
            this.events.emit('hover', null);
        }
        this.redraw();
    };

    private readonly onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        const p = this.local(e);
        this.camera.cancelFlight();
        this.camera.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
        this.userMoved = true;
        this.redraw();
    };

    private readonly onDblClick = (): void => {
        this.fit(true);
    };

    public override destroy(): void {
        this.canvas.removeEventListener('pointerdown', this.onDown);
        this.canvas.removeEventListener('pointermove', this.onMove);
        this.canvas.removeEventListener('pointerup', this.onUp);
        this.canvas.removeEventListener('pointerleave', this.onLeave);
        this.canvas.removeEventListener('wheel', this.onWheel);
        this.canvas.removeEventListener('dblclick', this.onDblClick);
        super.destroy();
    }

}
