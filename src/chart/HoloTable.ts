import { Color } from '../util/Color';
import { ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { HoloCamera, HoloFrame, HoloGeometry, HoloPoint } from './HoloGeometry';

/*
 * Scene coordinates: x to the right, y towards the viewer (0 = far edge of the
 * table), z up — like a page lying on the table. All sizes in table units.
 */

/** A framed area of the table with a title (a dashboard tile). */
export interface HoloPanel {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    title?: string;
    color?: string;
}

/** A polyline on the table: roads, routes; `glow` makes it a neon line, `flow` sends dots along it. */
export interface HoloLine {
    id?: string;
    points: [number, number][];
    color: string;
    width?: number;
    glow?: boolean;
    dash?: number[];
    /** Number of dots travelling along the line (0 = none). */
    flow?: number;
    /** Laps per minute (default 6). */
    speed?: number;
    label?: string;
}

/** A filled polygon on the table (district, zone). */
export interface HoloArea {
    id?: string;
    points: [number, number][];
    fill?: string;
    stroke?: string;
    width?: number;
    label?: string;
}

/** A glowing column standing on the table. */
export interface HoloBar {
    id: string;
    x: number;
    y: number;
    /** Footprint side (default 14). */
    size?: number;
    height: number;
    color: string;
    label?: string;
}

/** Walls of values standing side by side (one row per series), like a ridgeline in 3D. */
export interface HoloRidge {
    id: string;
    x: number;
    y: number;
    w: number;
    /** Depth the rows are spread over (towards the viewer). */
    depth: number;
    rows: {name: string; values: number[]}[];
    /** Height of the largest value (default 120). */
    height?: number;
    /** Value mapped to `height` (default the largest). */
    max?: number;
    color: string;
    /** Tooltip label of column i. */
    labels?: string[];
}

/** A point of interest: a pin, a pulsing ring, a dot or a wind turbine. */
export interface HoloMarker {
    id: string;
    x: number;
    y: number;
    color: string;
    shape?: 'pin' | 'ring' | 'dot' | 'turbine';
    size?: number;
    pulse?: boolean;
    label?: string;
}

/** Text printed on the table, or standing up (`standing`) at height `z`. */
export interface HoloText {
    x: number;
    y: number;
    text: string;
    size?: number;
    color?: string;
    align?: 'left' | 'center' | 'right';
    weight?: number;
    standing?: boolean;
    z?: number;
}

/** A small framed box of text lines on the table (a KPI). */
export interface HoloCard {
    id?: string;
    x: number;
    y: number;
    w: number;
    h: number;
    color: string;
    lines: {text: string; size?: number; color?: string; weight?: number}[];
    label?: string;
}

export interface HoloScene {
    /** Table size (default 1600 × 1000). */
    width: number;
    height: number;
    panels: HoloPanel[];
    lines: HoloLine[];
    areas: HoloArea[];
    bars: HoloBar[];
    ridges: HoloRidge[];
    markers: HoloMarker[];
    texts: HoloText[];
    cards: HoloCard[];
}

export interface HoloTableOptions {
    scene?: Partial<HoloScene>;
    /** Start camera (default: the whole table, a little turned). */
    camera?: Partial<HoloCamera>;
    /** Table top / edge / decoration colours. */
    table?: {top?: string; edge?: string; trim?: string};
    /** Value text in ridge tooltips. */
    format?: (value: number) => string;
    /** Drag orbits, right/shift-drag pans, wheel zooms (default true). */
    interactive?: boolean;
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
}

export type HoloKind = 'panel' | 'line' | 'area' | 'bar' | 'ridge' | 'marker' | 'card';

export interface HoloHit {
    kind: HoloKind;
    id: string;
    /** Ridge: row; others −1. */
    row: number;
    /** Ridge: column; others −1. */
    index: number;
    label: string;
    /** Table point under the pointer. */
    x: number;
    y: number;
}

export interface HoloTableEvents extends Record<string, unknown> {
    hover: HoloHit | null;
    click: HoloHit;
    viewChange: HoloCamera;
}

interface Pick {
    hit: Omit<HoloHit, 'x' | 'y'>;
    test: (sx: number, sy: number, px: number, py: number) => number;
}

/**
 * A dark table seen in perspective with glowing dashboard content on it:
 * panels, road maps and routes (with travelling dots), districts, columns,
 * ridgeline walls, pins, turbines and KPI cards. The camera orbits, pans and
 * zooms, and `focus` flies to a panel. Everything is plain data
 * (`setScene`); hover/click report what is under the pointer.
 */
export class HoloTable extends ChartSurface<HoloTableEvents> {

    private static readonly EMPTY: HoloScene = {width: 1600, height: 1000, panels: [], lines: [], areas: [], bars: [], ridges: [], markers: [], texts: [], cards: []};

    private scene: HoloScene;
    private cam: HoloCamera;
    private home: HoloCamera | null = null;
    private userMoved = false;
    private flight: {from: HoloCamera; to: HoloCamera; start: number; ms: number} | null = null;
    private readonly table: {top: string; edge: string; trim: string};
    private readonly format: (v: number) => string;
    private readonly interactive: boolean;
    private pausedState = false;
    private clock = 0;
    private lastNow = -1;
    private barFrom = new Map<string, number>();
    private barStart = -1;
    private picks: Pick[] = [];
    private frameNow: HoloFrame | null = null;
    private hover: HoloHit | null = null;
    private highlighted: Set<string> | null = null;
    private pointer: {x: number; y: number} | null = null;
    private drag: {x: number; y: number; cam: HoloCamera; pan: boolean; moved: boolean} | null = null;

    public constructor(container: HTMLElement, options: HoloTableOptions = {}) {
        super(container, options.theme ?? {background: '#05080c', text: '#8fa6b8', title: '#d9f3ff'});
        this.scene = structuredClone({...HoloTable.EMPTY, ...options.scene});
        this.table = {top: '#0a1118', edge: '#16212b', trim: '#1f3b4d', ...options.table};
        this.format = options.format ?? ((v) => String(Math.round(v * 10) / 10));
        this.interactive = options.interactive ?? true;
        this.cam = {yaw: -14, pitch: 42, distance: 2000, tx: this.scene.width / 2, ty: this.scene.height / 2, ...options.camera};
        if (options.camera?.distance !== undefined) {
            this.userMoved = true;
        }
        this.barStart = performance.now();

        this.root.style.cursor = this.interactive ? 'grab' : '';
        this.root.addEventListener('pointerdown', this.onDown);
        this.root.addEventListener('pointermove', this.onMove);
        this.root.addEventListener('pointerup', this.onUp);
        this.root.addEventListener('pointercancel', this.onUp);
        this.root.addEventListener('pointerleave', this.onLeave);
        this.root.addEventListener('wheel', this.onWheel, {passive: false});
        this.root.addEventListener('dblclick', this.onDblClick);
        this.root.addEventListener('contextmenu', this.onContext);
        this.redraw();
    }

    /** Replace parts of the scene (keys you leave out stay). Bars grow from their old height. */
    public setScene(scene: Partial<HoloScene>): void {
        if (scene.bars !== undefined) {
            const now = performance.now();
            this.barFrom = new Map(this.scene.bars.map((b) => [b.id, this.barHeight(b, now)]));
            this.barStart = now;
        }
        this.scene = {...this.scene, ...structuredClone(scene)};
        this.redraw();
    }

    /** A copy of the scene. */
    public getScene(): HoloScene {
        return structuredClone(this.scene);
    }

    public getCamera(): HoloCamera {
        return {...this.cam};
    }

    /** Move the camera; animated by default. */
    public setCamera(cam: Partial<HoloCamera>, options: {animate?: boolean; ms?: number} = {}): void {
        const to = {...this.cam, ...cam};

        this.userMoved = true;
        if (options.animate === false) {
            this.flight = null;
            this.cam = to;
            this.events.emit('viewChange', this.getCamera());
        } else {
            this.flight = {from: {...this.cam}, to, start: performance.now(), ms: options.ms ?? 900};
        }
        this.redraw();
    }

    /** Fly to a panel (looking down on it) or back to the whole table ('all'). */
    public focus(id: string | 'all', options: {pitch?: number; yaw?: number} = {}): void {
        if (id === 'all') {
            this.setCamera(this.overview());
            return;
        }

        const p = this.scene.panels.find((x) => x.id === id);

        if (p === undefined) {
            return;
        }

        const pitch = options.pitch ?? 62;
        const distance = HoloGeometry.fitDistance(p.w, p.h * (0.55 + 0.45 * Math.sin(pitch * Math.PI / 180)), this.width, this.height, 40, 1.12);

        this.setCamera({yaw: options.yaw ?? 0, pitch, distance, tx: p.x + p.w / 2, ty: -(p.y + p.h / 2)});
    }

    /** Back to the start camera. */
    public resetView(): void {
        this.setCamera(this.home ?? this.overview());
    }

    /** Emphasise items by id (others dim); null = all normal. */
    public highlight(ids: string[] | null): void {
        this.highlighted = ids === null ? null : new Set(ids);
        this.redraw();
    }

    /** Stop the flowing dots, pulses and turbines. */
    public setPaused(paused: boolean): void {
        this.pausedState = paused;
        this.redraw();
    }

    /** True while the motion is stopped. */
    public get paused(): boolean {
        return this.pausedState;
    }

    public override destroy(): void {
        this.root.removeEventListener('pointerdown', this.onDown);
        this.root.removeEventListener('pointermove', this.onMove);
        this.root.removeEventListener('pointerup', this.onUp);
        this.root.removeEventListener('pointercancel', this.onUp);
        this.root.removeEventListener('pointerleave', this.onLeave);
        this.root.removeEventListener('wheel', this.onWheel);
        this.root.removeEventListener('dblclick', this.onDblClick);
        this.root.removeEventListener('contextmenu', this.onContext);
        super.destroy();
    }

    // ---- camera ---------------------------------------------------------------------------------------

    private overview(): HoloCamera {
        const {width: tw, height: th} = this.scene;
        const pitch = 42;

        return {
            yaw: -14, pitch, tx: tw / 2, ty: -th * 0.5,
            distance: HoloGeometry.fitDistance(tw * 1.08, th * 0.95, this.width, this.height, 40, 1.2)
        };
    }

    private P(x: number, y: number, z = 0): HoloPoint {
        return HoloGeometry.project(this.frameNow!, x, -y, z);
    }

    // ---- drawing ------------------------------------------------------------------------------------------

    protected draw(ctx: CanvasRenderingContext2D, now: number): boolean {
        if (this.lastNow >= 0 && !this.pausedState) {
            this.clock += Math.min(0.1, (now - this.lastNow) / 1000);
        }
        this.lastNow = now;

        if (!this.userMoved) {
            this.cam = this.overview();
            this.home = this.cam;
        }
        let flying = false;
        if (this.flight !== null) {
            const u = Math.min(1, (now - this.flight.start) / this.flight.ms);
            this.cam = HoloGeometry.lerp(this.flight.from, this.flight.to, u);
            flying = u < 1;
            if (!flying) {
                this.flight = null;
            }
            this.events.emit('viewChange', this.getCamera());
        }

        this.frameNow = HoloGeometry.frame(this.cam, this.width, this.height);
        this.picks = [];

        const bg = ctx.createRadialGradient(this.width / 2, this.height * 0.45, 0, this.width / 2, this.height * 0.45, Math.max(this.width, this.height) * 0.75);
        bg.addColorStop(0, Color.lerp(this.theme.background, '#1a2b3a', 0.35));
        bg.addColorStop(1, this.theme.background);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, this.width, this.height);

        this.drawTable(ctx);
        for (const p of this.scene.panels) {
            this.drawPanel(ctx, p);
        }
        for (const a of this.scene.areas) {
            this.drawArea(ctx, a);
        }
        for (const l of this.scene.lines) {
            if (l.glow !== true) {
                this.drawLine(ctx, l);
            }
        }
        for (const l of this.scene.lines) {
            if (l.glow === true) {
                this.drawLine(ctx, l);
            }
        }
        for (const c of this.scene.cards) {
            this.drawCard(ctx, c);
        }
        for (const t of this.scene.texts) {
            if (t.standing !== true) {
                this.planeText(ctx, t);
            }
        }

        // things standing up, far to near
        const items: {d: number; draw: () => void}[] = [];
        for (const b of this.scene.bars) {
            const s = b.size ?? 14;
            items.push({d: this.P(b.x + s / 2, b.y + s / 2).depth, draw: () => this.drawBar(ctx, b, now)});
        }
        for (const r of this.scene.ridges) {
            r.rows.forEach((row, i) => {
                const y = r.y + r.depth * (i + 0.5) / r.rows.length;
                items.push({d: this.P(r.x + r.w / 2, y).depth + 0.001 * i, draw: () => this.drawRidgeRow(ctx, r, i, y)});
            });
        }
        for (const m of this.scene.markers) {
            items.push({d: this.P(m.x, m.y).depth, draw: () => this.drawMarker(ctx, m)});
        }
        for (const t of this.scene.texts) {
            if (t.standing === true) {
                items.push({d: this.P(t.x, t.y).depth - 1, draw: () => this.standingText(ctx, t)});
            }
        }
        items.sort((a, b) => b.d - a.d);
        for (const it of items) {
            it.draw();
        }

        this.drawTooltip(ctx);

        const moving = !this.pausedState && (this.scene.lines.some((l) => (l.flow ?? 0) > 0)
            || this.scene.markers.some((m) => m.pulse === true || m.shape === 'turbine'));
        const growing = this.barStart >= 0 && now - this.barStart < 900;

        return flying || moving || growing;
    }

    private dim(id: string | undefined): number {
        return this.highlighted === null || (id !== undefined && this.highlighted.has(id)) ? 1 : 0.25;
    }

    private isHover(kind: HoloKind, id: string | undefined, row = -1): boolean {
        return this.hover !== null && this.hover.kind === kind && this.hover.id === id && (row < 0 || this.hover.row === row);
    }

    private path(ctx: CanvasRenderingContext2D, pts: ReadonlyArray<[number, number]>, z = 0, close = false): HoloPoint[] {
        const out = pts.map(([x, y]) => this.P(x, y, z));

        ctx.beginPath();
        out.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        if (close) {
            ctx.closePath();
        }

        return out;
    }

    /** Three strokes on top of each other, added up: a neon line. */
    private glowStroke(ctx: CanvasRenderingContext2D, color: string, width: number, alpha = 1): void {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (const [w, a] of [[width * 5, 0.07], [width * 2.4, 0.2], [width, 0.95]] as const) {
            ctx.strokeStyle = Color.withAlpha(color, a * alpha);
            ctx.lineWidth = w;
            ctx.stroke();
        }
        ctx.restore();
    }

    private drawTable(ctx: CanvasRenderingContext2D): void {
        const {width: W, height: H} = this.scene;
        const f = this.frameNow!;
        const thick = Math.max(W, H) * 0.02;

        // the slab's sides (world y = −scene y)
        for (const face of HoloGeometry.boxFaces(f.eye, -8, -(H + 8), W + 16, H + 16, -thick, 0)) {
            if (face.top) {
                continue;
            }
            ctx.beginPath();
            face.pts.forEach((q, i) => {
                const p = HoloGeometry.project(f, q[0], q[1], q[2]);
                i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
            });
            ctx.closePath();
            ctx.fillStyle = Color.lerp(this.table.edge, '#000000', 1 - face.shade);
            ctx.fill();
        }
        this.path(ctx, [[-8, -8], [W + 8, -8], [W + 8, H + 8], [-8, H + 8]], 0, true);
        ctx.fillStyle = this.table.top;
        ctx.fill();
        ctx.strokeStyle = Color.withAlpha(this.table.trim, 0.9);
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // trim: an inner border with notches, like a circuit
        const m = 14;
        this.path(ctx, [[m, m + 30], [m, m], [m + 60, m], [W * 0.35, m], [W * 0.35 + 12, m + 6], [W * 0.62, m + 6], [W * 0.62 + 12, m],
            [W - m, m], [W - m, H - m], [W * 0.7, H - m], [W * 0.7 - 12, H - m - 6], [W * 0.3, H - m - 6], [W * 0.3 - 12, H - m],
            [m, H - m], [m, m + 30]]);
        ctx.strokeStyle = Color.withAlpha(this.table.trim, 0.8);
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    private drawPanel(ctx: CanvasRenderingContext2D, p: HoloPanel): void {
        const color = p.color ?? '#3cc8ff';
        const hot = this.isHover('panel', p.id);

        this.path(ctx, [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]], 0, true);
        ctx.fillStyle = Color.withAlpha(color, hot ? 0.09 : 0.05);
        ctx.fill();
        ctx.strokeStyle = Color.withAlpha(color, 0.45);
        ctx.lineWidth = 1;
        ctx.stroke();

        // corner brackets glow
        const c = Math.min(p.w, p.h) * 0.08;
        for (const [x, y, dx, dy] of [[p.x, p.y, 1, 1], [p.x + p.w, p.y, -1, 1], [p.x + p.w, p.y + p.h, -1, -1], [p.x, p.y + p.h, 1, -1]] as const) {
            this.path(ctx, [[x + dx * c, y], [x, y], [x, y + dy * c]]);
            this.glowStroke(ctx, color, 1.6);
        }
        if (p.title !== undefined) {
            this.planeText(ctx, {x: p.x + 16, y: p.y + 24, text: p.title.toUpperCase(), size: Math.min(26, p.h * 0.06), color, weight: 700});
        }
        this.picks.push({
            hit: {kind: 'panel', id: p.id, row: -1, index: -1, label: p.title ?? p.id},
            test: (_sx, _sy, px, py) => (px >= p.x && px <= p.x + p.w && py >= p.y && py <= p.y + p.h ? 1000 : Infinity)
        });
    }

    private drawArea(ctx: CanvasRenderingContext2D, a: HoloArea): void {
        const hot = this.isHover('area', a.id);
        const alpha = this.dim(a.id);

        this.path(ctx, a.points, 0, true);
        if (a.fill !== undefined) {
            ctx.fillStyle = hot ? Color.lerp(a.fill, '#ffffff', 0.25) : a.fill;
            ctx.globalAlpha = alpha;
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        if (a.stroke !== undefined || hot) {
            if (hot) {
                this.glowStroke(ctx, a.stroke ?? '#ffffff', 2);
            } else {
                ctx.strokeStyle = Color.withAlpha(a.stroke!, alpha);
                ctx.lineWidth = a.width ?? 1;
                ctx.stroke();
            }
        }
        if (a.id !== undefined) {
            const id = a.id;
            const poly = a.points.map(([x, y]) => ({x, y}));
            this.picks.push({
                hit: {kind: 'area', id, row: -1, index: -1, label: a.label ?? id},
                test: (_sx, _sy, px, py) => (HoloGeometry.inPolygon(px, py, poly) ? 500 : Infinity)
            });
        }
    }

    private drawLine(ctx: CanvasRenderingContext2D, l: HoloLine): void {
        const hot = this.isHover('line', l.id);
        const alpha = this.dim(l.id);
        const pts = this.path(ctx, l.points);
        const k = pts.reduce((s, p) => s + p.k, 0) / Math.max(1, pts.length);
        const w = Math.max(0.6, (l.width ?? 1) * k * (hot ? 1.8 : 1));

        if (l.dash !== undefined) {
            ctx.setLineDash(l.dash.map((d) => d * k));
        }
        if (l.glow === true) {
            this.glowStroke(ctx, l.color, w, alpha);
        } else {
            ctx.strokeStyle = Color.withAlpha(l.color, alpha);
            ctx.lineWidth = w;
            ctx.lineJoin = 'round';
            ctx.stroke();
        }
        ctx.setLineDash([]);

        const n = l.flow ?? 0;
        if (n > 0) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const laps = (l.speed ?? 6) / 60;
            for (let i = 0; i < n; i++) {
                const q = HoloGeometry.along(l.points, this.clock * laps + i / n);
                const p = this.P(q.x, q.y);
                const r = Math.max(1.2, (l.width ?? 1) * p.k * 1.3);
                const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
                g.addColorStop(0, Color.withAlpha('#ffffff', 0.95 * alpha));
                g.addColorStop(0.25, Color.withAlpha(l.color, 0.8 * alpha));
                g.addColorStop(1, Color.withAlpha(l.color, 0));
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
        if (l.id !== undefined) {
            const id = l.id;
            const poly = l.points.map(([x, y]) => ({x, y}));
            const tol = (l.width ?? 1) * 2;
            this.picks.push({
                hit: {kind: 'line', id, row: -1, index: -1, label: l.label ?? id},
                test: (_sx, _sy, px, py) => {
                    const d = HoloGeometry.polylineDistance(px, py, poly);
                    const px6 = 6 / Math.max(1e-6, k);
                    return d <= Math.max(tol, px6) ? 100 + d * k : Infinity;
                }
            });
        }
    }

    private drawCard(ctx: CanvasRenderingContext2D, c: HoloCard): void {
        const hot = this.isHover('card', c.id);

        this.path(ctx, [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]], 0, true);
        ctx.fillStyle = Color.withAlpha(c.color, hot ? 0.22 : 0.12);
        ctx.fill();
        this.glowStroke(ctx, c.color, hot ? 1.6 : 1);
        let y = c.y + 8;
        for (const line of c.lines) {
            const size = line.size ?? 14;
            y += size;
            this.planeText(ctx, {x: c.x + 10, y, text: line.text, size, color: line.color ?? '#ffffff', weight: line.weight});
            y += size * 0.35;
        }
        if (c.id !== undefined) {
            const id = c.id;
            this.picks.push({
                hit: {kind: 'card', id, row: -1, index: -1, label: c.label ?? c.lines.map((l) => l.text).join(' · ')},
                test: (_sx, _sy, px, py) => (px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h ? 50 : Infinity)
            });
        }
    }

    private barHeight(b: HoloBar, now: number): number {
        const from = this.barFrom.get(b.id) ?? 0;
        const u = this.barStart < 0 ? 1 : Math.min(1, (now - this.barStart) / 900);
        const e = 1 - Math.pow(1 - u, 3);

        return from + (b.height - from) * e;
    }

    private drawBar(ctx: CanvasRenderingContext2D, b: HoloBar, now: number): void {
        const f = this.frameNow!;
        const s = b.size ?? 14;
        const h = Math.max(0.5, this.barHeight(b, now));
        const hot = this.isHover('bar', b.id);
        const alpha = this.dim(b.id);
        const faces = HoloGeometry.boxFaces(f.eye, b.x, -(b.y + s), s, s, 0, h);
        const polys: {x: number; y: number}[][] = [];

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const face of faces) {
            const pts = face.pts.map((q) => HoloGeometry.project(f, q[0], q[1], q[2]));
            polys.push(pts);
            ctx.beginPath();
            pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.closePath();
            const top = pts.reduce((m, p) => Math.min(m, p.y), Infinity), bottom = pts.reduce((m, p) => Math.max(m, p.y), -Infinity);
            const g = ctx.createLinearGradient(0, top, 0, bottom);
            g.addColorStop(0, Color.withAlpha(b.color, (face.top ? 0.95 : 0.75) * face.shade * alpha));
            g.addColorStop(1, Color.withAlpha(b.color, 0.25 * face.shade * alpha));
            ctx.fillStyle = face.top ? Color.withAlpha(Color.lerp(b.color, '#ffffff', 0.45), 0.9 * alpha) : g;
            ctx.fill();
            ctx.strokeStyle = Color.withAlpha(Color.lerp(b.color, '#ffffff', hot ? 0.7 : 0.3), 0.8 * alpha);
            ctx.lineWidth = hot ? 1.6 : 0.8;
            ctx.stroke();
        }
        // footprint glow on the table
        const base = this.P(b.x + s / 2, b.y + s / 2);
        const g = ctx.createRadialGradient(base.x, base.y, 0, base.x, base.y, s * base.k * 1.6);
        g.addColorStop(0, Color.withAlpha(b.color, 0.45 * alpha));
        g.addColorStop(1, Color.withAlpha(b.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(base.x, base.y, s * base.k * 1.6, s * base.k * 1.6 * Math.sin(this.cam.pitch * Math.PI / 180), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        this.picks.push({
            hit: {kind: 'bar', id: b.id, row: -1, index: -1, label: b.label ?? b.id},
            test: (sx, sy) => (polys.some((poly) => HoloGeometry.inPolygon(sx, sy, poly)) ? 10 : Infinity)
        });
    }

    private drawRidgeRow(ctx: CanvasRenderingContext2D, r: HoloRidge, i: number, y: number): void {
        const row = r.rows[i]!;
        const n = row.values.length;
        const max = r.max ?? Math.max(1e-9, ...r.rows.flatMap((x) => x.values));
        const H = r.height ?? 120;
        const hot = this.isHover('ridge', r.id, i);
        const alpha = this.dim(r.id + ':' + i) * (this.hover !== null && this.hover.kind === 'ridge' && this.hover.id === r.id && !hot ? 0.45 : 1);
        const tops = row.values.map((v, k) => this.P(r.x + r.w * k / Math.max(1, n - 1), y, Math.max(0, v) / max * H));
        const b0 = this.P(r.x, y), b1 = this.P(r.x + r.w, y);

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath();
        ctx.moveTo(b0.x, b0.y);
        tops.forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.lineTo(b1.x, b1.y);
        ctx.closePath();
        const top = tops.reduce((m, p) => Math.min(m, p.y), b0.y);
        const g = ctx.createLinearGradient(0, top, 0, Math.max(b0.y, b1.y));
        g.addColorStop(0, Color.withAlpha(r.color, (hot ? 0.6 : 0.42) * alpha));
        g.addColorStop(1, Color.withAlpha(r.color, 0.05 * alpha));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();

        ctx.beginPath();
        tops.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        this.glowStroke(ctx, hot ? Color.lerp(r.color, '#ffffff', 0.4) : r.color, hot ? 1.8 : 1.1, alpha);

        const poly = [b0, ...tops, b1];
        this.picks.push({
            hit: {kind: 'ridge', id: r.id, row: i, index: -1, label: row.name},
            test: (sx, sy) => (HoloGeometry.inPolygon(sx, sy, poly) ? 20 - i * 0.01 : Infinity)
        });
        if (hot && this.hover !== null && this.hover.index >= 0) {
            const p = tops[this.hover.index];
            if (p !== undefined) {
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    private drawMarker(ctx: CanvasRenderingContext2D, m: HoloMarker): void {
        const s = m.size ?? 10;
        const base = this.P(m.x, m.y);
        const hot = this.isHover('marker', m.id);
        const alpha = this.dim(m.id);
        const shape = m.shape ?? 'pin';
        const ring = (r: number, a: number, width = 1.4): void => {
            const pts: [number, number][] = Array.from({length: 33}, (_, i) => [m.x + Math.cos(i / 32 * Math.PI * 2) * r, m.y + Math.sin(i / 32 * Math.PI * 2) * r]);
            this.path(ctx, pts);
            ctx.strokeStyle = Color.withAlpha(m.color, a * alpha);
            ctx.lineWidth = width;
            ctx.stroke();
        };
        let head = base;

        ctx.save();
        if (m.pulse === true) {
            const u = (this.clock * 0.8 + (m.x * 0.013 + m.y * 0.007)) % 1;
            ring(s * (1 + u * 3), 0.9 * (1 - u), 1.6);
        }
        if (shape === 'ring') {
            ring(s, 0.95, hot ? 2.6 : 1.8);
        } else if (shape === 'dot') {
            ctx.globalCompositeOperation = 'lighter';
            const r = Math.max(2, s * base.k);
            const g = ctx.createRadialGradient(base.x, base.y, 0, base.x, base.y, r * 2.5);
            g.addColorStop(0, Color.withAlpha('#ffffff', alpha));
            g.addColorStop(0.3, Color.withAlpha(m.color, alpha));
            g.addColorStop(1, Color.withAlpha(m.color, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(base.x, base.y, r * 2.5, 0, Math.PI * 2);
            ctx.fill();
        } else if (shape === 'pin') {
            ring(s * 0.8, 0.7);
            head = this.P(m.x, m.y, s * 3);
            ctx.strokeStyle = Color.withAlpha(m.color, 0.8 * alpha);
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(base.x, base.y);
            ctx.lineTo(head.x, head.y);
            ctx.stroke();
            const r = Math.max(3, s * 0.7 * head.k) * (hot ? 1.3 : 1);
            ctx.fillStyle = Color.withAlpha(m.color, alpha);
            ctx.beginPath();
            ctx.moveTo(head.x, head.y + r * 1.6);
            ctx.arc(head.x, head.y, r, Math.PI * 0.75, Math.PI * 0.25);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = Color.withAlpha('#ffffff', 0.9 * alpha);
            ctx.beginPath();
            ctx.arc(head.x, head.y, r * 0.38, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // turbine: mast and three turning blades, always facing the viewer
            const top = this.P(m.x, m.y, s * 4);
            head = top;
            ctx.strokeStyle = Color.withAlpha(m.color, 0.9 * alpha);
            ctx.lineWidth = Math.max(1, s * 0.12 * top.k);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(base.x, base.y);
            ctx.lineTo(top.x, top.y);
            ctx.stroke();
            const len = s * 2.4 * top.k;
            const a0 = this.clock * 2.2 + m.x;
            ctx.lineWidth = Math.max(1, s * 0.16 * top.k);
            for (let i = 0; i < 3; i++) {
                const a = a0 + i * Math.PI * 2 / 3;
                ctx.beginPath();
                ctx.moveTo(top.x, top.y);
                ctx.lineTo(top.x + Math.cos(a) * len, top.y + Math.sin(a) * len);
                ctx.stroke();
            }
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(top.x, top.y, Math.max(1.5, s * 0.15 * top.k), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        const hx = head.x, hy = head.y;
        const radius = Math.max(9, s * head.k * 1.5);
        this.picks.push({
            hit: {kind: 'marker', id: m.id, row: -1, index: -1, label: m.label ?? m.id},
            test: (sx, sy) => {
                const d = Math.min(Math.hypot(sx - hx, sy - hy), Math.hypot(sx - base.x, sy - base.y));
                return d <= radius ? d : Infinity;
            }
        });
    }

    /** Text printed onto the table: a local affine fit of the perspective at the anchor. */
    private planeText(ctx: CanvasRenderingContext2D, t: HoloText): void {
        const z = t.z ?? 0;
        const p0 = this.P(t.x, t.y, z), px = this.P(t.x + 1, t.y, z), py = this.P(t.x, t.y + 1, z);

        ctx.save();
        ctx.transform(px.x - p0.x, px.y - p0.y, py.x - p0.x, py.y - p0.y, p0.x, p0.y);
        ctx.font = `${t.weight ?? 500} ${t.size ?? 14}px ${ChartSurface.FONT_FAMILY}`;
        ctx.textAlign = t.align ?? 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = t.color ?? this.theme.title;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillText(t.text, 0, 0);
        ctx.restore();
    }

    private standingText(ctx: CanvasRenderingContext2D, t: HoloText): void {
        const p = this.P(t.x, t.y, t.z ?? 0);

        ctx.save();
        ctx.font = `${t.weight ?? 600} ${Math.max(9, (t.size ?? 14) * p.k)}px ${ChartSurface.FONT_FAMILY}`;
        ctx.textAlign = t.align ?? 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = t.color ?? this.theme.title;
        ctx.shadowColor = t.color ?? this.theme.title;
        ctx.shadowBlur = 6;
        ctx.fillText(t.text, p.x, p.y);
        ctx.restore();
    }

    private drawTooltip(ctx: CanvasRenderingContext2D): void {
        const h = this.hover;

        if (h === null || this.pointer === null || this.drag?.moved === true || h.kind === 'panel') {
            return;
        }

        let lines = h.label.split('\n');

        if (h.kind === 'ridge') {
            const r = this.scene.ridges.find((x) => x.id === h.id);
            const v = r?.rows[h.row]?.values[h.index];
            if (r !== undefined && v !== undefined) {
                lines = [h.label, `${r.labels?.[h.index] ?? '#' + (h.index + 1)}: ${this.format(v)}`];
            }
        }

        ctx.save();
        ctx.font = `12px ${ChartSurface.FONT_FAMILY}`;
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18;
        const hh = lines.length * 16 + 10;
        const x = Math.max(4, Math.min(this.width - w - 4, this.pointer.x + 14));
        const y = Math.max(4, Math.min(this.height - hh - 4, this.pointer.y + 14));

        ctx.fillStyle = 'rgba(4,10,16,0.92)';
        ctx.strokeStyle = 'rgba(80,200,255,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, w, hh, 5);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        lines.forEach((l, i) => {
            ctx.font = i === 0 ? `600 12px ${ChartSurface.FONT_FAMILY}` : `12px ${ChartSurface.FONT_FAMILY}`;
            ctx.fillStyle = i === 0 ? '#e6f7ff' : '#9fc3d6';
            ctx.fillText(l, x + 9, y + 6 + i * 16);
        });
        ctx.restore();
    }

    // ---- input ------------------------------------------------------------------------------------------------

    private pick(sx: number, sy: number): HoloHit | null {
        const f = this.frameNow;

        if (f === null) {
            return null;
        }

        const plane = HoloGeometry.unproject(f, sx, sy);
        const px = plane?.x ?? NaN, py = plane === null ? NaN : -plane.y;
        let best: Pick | null = null;
        let bs = Infinity;

        for (const p of this.picks) {
            const s = p.test(sx, sy, px, py);
            if (s < bs) {
                bs = s;
                best = p;
            }
        }
        if (best === null) {
            return null;
        }

        const hit: HoloHit = {...best.hit, x: px, y: py};

        if (hit.kind === 'ridge') {
            const r = this.scene.ridges.find((x) => x.id === hit.id);
            const n = r?.rows[hit.row]?.values.length ?? 0;
            if (r !== undefined && n > 0) {
                // nearest column on the screen along the row's base
                let bi = 0, bd = Infinity;
                const y = r.y + r.depth * (hit.row + 0.5) / r.rows.length;
                for (let k = 0; k < n; k++) {
                    const p = this.P(r.x + r.w * k / Math.max(1, n - 1), y);
                    const d = Math.abs(p.x - sx);
                    if (d < bd) {
                        bd = d;
                        bi = k;
                    }
                }
                hit.index = bi;
            }
        }

        return hit;
    }

    private readonly onDown = (e: PointerEvent): void => {
        if (!this.interactive) {
            return;
        }
        this.drag = {...this.local(e), cam: {...this.cam}, pan: e.button === 2 || e.shiftKey, moved: false};
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
            if (this.drag.moved) {
                this.flight = null;
                this.userMoved = true;
                if (this.drag.pan) {
                    const f = HoloGeometry.frame(this.drag.cam, this.width, this.height);
                    const a = HoloGeometry.unproject(f, this.drag.x, this.drag.y);
                    const b = HoloGeometry.unproject(f, p.x, p.y);
                    if (a !== null && b !== null) {
                        this.cam = {...this.drag.cam, tx: this.drag.cam.tx - (b.x - a.x), ty: this.drag.cam.ty - (b.y - a.y)};
                    }
                } else {
                    this.cam = {
                        ...this.drag.cam,
                        yaw: this.drag.cam.yaw - dx * 0.3,
                        pitch: Math.max(12, Math.min(89, this.drag.cam.pitch + dy * 0.25))
                    };
                }
                this.root.style.cursor = 'grabbing';
                this.events.emit('viewChange', this.getCamera());
                this.redraw();
                return;
            }
        }

        const hit = this.pick(p.x, p.y);
        const changed = (hit?.kind ?? '') !== (this.hover?.kind ?? '') || (hit?.id ?? '') !== (this.hover?.id ?? '')
            || (hit?.row ?? -1) !== (this.hover?.row ?? -1) || (hit?.index ?? -1) !== (this.hover?.index ?? -1);

        this.hover = hit;
        if (changed) {
            this.events.emit('hover', hit === null ? null : {...hit});
        }
        this.root.style.cursor = hit !== null && hit.kind !== 'panel' ? 'pointer' : this.interactive ? 'grab' : '';
        this.redraw();
    };

    private readonly onUp = (e: PointerEvent): void => {
        const d = this.drag;

        this.drag = null;
        if (this.root.hasPointerCapture(e.pointerId)) {
            this.root.releasePointerCapture(e.pointerId);
        }
        this.root.style.cursor = this.interactive ? 'grab' : '';
        if (d !== null && !d.moved && e.type === 'pointerup') {
            const hit = this.pick(this.local(e).x, this.local(e).y);
            if (hit !== null) {
                this.events.emit('click', {...hit});
            }
        }
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
        if (!this.interactive) {
            return;
        }
        e.preventDefault();
        this.flight = null;
        this.userMoved = true;
        this.cam = {...this.cam, distance: Math.max(150, Math.min(20000, this.cam.distance * Math.exp(e.deltaY * 0.0012)))};
        this.events.emit('viewChange', this.getCamera());
        this.redraw();
    };

    private readonly onDblClick = (): void => {
        if (this.interactive) {
            this.resetView();
        }
    };

    private readonly onContext = (e: Event): void => {
        if (this.interactive) {
            e.preventDefault();
        }
    };

}
