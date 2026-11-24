import { Color } from '../util/Color';
import { ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { ScopeGeometry, ScopePoint } from './ScopeGeometry';

/** One echo on the scope. */
export interface ScopeTarget {
    id: string;
    /** Degrees, 0 = up (north / ahead), clockwise. */
    bearing: number;
    /** Distance in range units (same as `maxRange`). */
    range: number;
    /** Echo radius in range units (default 3 % of `maxRange`). */
    size?: number;
    /** Kind id (colour, legend, clustering). */
    kind?: string;
    label?: string;
    /** Echo strength 0…1 (default 1). */
    intensity?: number;
}

export interface ScopeKind {
    label: string;
    color: string;
    /** Join clusters (default true). */
    cluster?: boolean;
}

/** A shaded sector (e.g. a blind arc or a search area). */
export interface ScopeSector {
    from: number;
    to: number;
    /** Outer range (default the whole scope). */
    range?: number;
    color?: string;
}

/** A filled outline on the scope, e.g. a coastline, in range units relative to the centre (x east, y north). */
export interface ScopeShape {
    points: ScopePoint[];
    /** Fill (default: a bright land echo). */
    color?: string;
}

/** Colours of the scope face. */
export interface ScopeColors {
    face: string;
    ring: string;
    bezel: string;
    label: string;
    /** Afterglow fill behind the beam. */
    sweep: string;
    /** The beam line. */
    beam: string;
    echo: string;
    cluster: string;
}

export interface RadarScopeOptions {
    targets?: ScopeTarget[];
    kinds?: Record<string, ScopeKind>;
    /** Outer range (default: the farthest target, rounded up). */
    maxRange?: number;
    /** Number of range rings (default 3; dashed). */
    rings?: number;
    /** Range ring text (default none). */
    rangeFormat?: (range: number) => string;
    /** Bearing label step in degrees (default 20; 0 hides labels). */
    bearingStep?: number;
    sectors?: ScopeSector[];
    /** Land and other fixed outlines (always lit, under the echoes). */
    shapes?: ScopeShape[];
    /** Rotating beam: degrees per second (default 72; 0 = no sweep, echoes always lit). */
    sweepSpeed?: number;
    /** Afterglow trail in degrees (default 70). */
    trail?: number;
    /** How long an echo stays visible after the beam passed, in seconds (default: one turn). */
    persistence?: number;
    /** Join echoes closer than this (range units) into outlined clusters; false = none (default 8 % of maxRange). */
    cluster?: number | false;
    /** Random speckles of sea clutter per turn (default 40). */
    clutter?: number;
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
    colors?: Partial<ScopeColors>;
}

export interface RadarScopeEvents extends Record<string, unknown> {
    targetHover: {target: ScopeTarget} | null;
    targetClick: {target: ScopeTarget};
    clusterHover: {targets: ScopeTarget[]} | null;
    clusterClick: {targets: ScopeTarget[]};
}

interface Lit {
    /** Last time (ms) the beam passed the target. */
    at: number;
}

/**
 * Radar scope (PPI): a compass bezel with bearing labels, dashed range rings,
 * shaded sectors, a rotating beam with afterglow that lights echoes as it
 * passes (they fade until the next turn), irregular echo blobs coloured by
 * kind, sea clutter, and orange loops around clusters of echoes. Hover and
 * click echoes or clusters; live updates keep each echo's glow by id.
 * Canvas, zero dependencies.
 */
export class RadarScope extends ChartSurface<RadarScopeEvents> {

    private static readonly COLORS: ScopeColors = {
        face: '#0b4256',
        ring: 'rgba(255,255,255,0.55)',
        bezel: '#0a2f3e',
        label: '#ffffff',
        sweep: 'rgba(120,220,255,0.28)',
        beam: 'rgba(170,235,255,0.9)',
        echo: '#58c6f2',
        cluster: '#f39a2b'
    };

    private targets: ScopeTarget[] = [];
    private kinds: Record<string, ScopeKind>;
    private readonly hiddenKinds = new Set<string>();
    private fixedRange: number | null;
    private rings: number;
    private readonly rangeFormat: ((r: number) => string) | undefined;
    private readonly bearingStep: number;
    private sectors: ScopeSector[];
    private shapes: ScopeShape[];
    private sweepSpeed: number;
    private readonly trail: number;
    private readonly persistence: number | undefined;
    private clusterDistance: number | false | undefined;
    private readonly clutter: number;
    private readonly colors: ScopeColors;
    private readonly lit = new Map<string, Lit>();
    private sweep = 0;
    private lastFrame = 0;
    private pausedState = false;
    private clutterDots: {b: number; r: number; at: number}[] = [];
    private clusters: number[][] = [];
    private highlighted: Set<string> | null = null;
    private hoverTarget: number = -1;
    private hoverCluster: number = -1;
    private pointer: {x: number; y: number} | null = null;
    private center = {x: 0, y: 0};
    private radius = 1;
    private seed = 1;

    public constructor(container: HTMLElement, options: RadarScopeOptions = {}) {
        super(container, options.theme);
        this.kinds = RadarScope.copyKinds(options.kinds ?? {});
        this.fixedRange = options.maxRange ?? null;
        this.rings = options.rings ?? 3;
        this.rangeFormat = options.rangeFormat;
        this.bearingStep = options.bearingStep ?? 20;
        this.sectors = (options.sectors ?? []).map((s) => ({...s}));
        this.shapes = (options.shapes ?? []).map((s) => ({...s}));
        this.sweepSpeed = options.sweepSpeed ?? 72;
        this.trail = options.trail ?? 70;
        this.persistence = options.persistence;
        this.clusterDistance = options.cluster;
        this.clutter = options.clutter ?? 40;
        this.colors = {...RadarScope.COLORS, ...options.colors};
        this.root.addEventListener('pointermove', this.onMove);
        this.root.addEventListener('pointerleave', this.onLeave);
        this.root.addEventListener('click', this.onClick);
        this.setTargets(options.targets ?? []);
    }

    /** New echoes; a target keeps its glow when its id stays. */
    public setTargets(targets: ScopeTarget[]): void {
        this.targets = targets.map((t) => ({...t}));

        const ids = new Set(targets.map((t) => t.id));

        for (const id of Array.from(this.lit.keys())) {
            if (!ids.has(id)) {
                this.lit.delete(id);
            }
        }
        this.recluster();
        this.redraw();
    }

    /** A copy of the echoes. */
    public getTargets(): ReadonlyArray<ScopeTarget> {
        return this.targets.map((t) => ({...t}));
    }

    /** Current clusters as lists of target ids. */
    public getClusters(): string[][] {
        return this.clusters.map((g) => g.map((i) => this.targets[i]!.id));
    }

    public setKinds(kinds: Record<string, ScopeKind>): void {
        this.kinds = RadarScope.copyKinds(kinds);
        this.recluster();
        this.redraw();
    }

    public setKindVisible(kind: string, visible: boolean): void {
        if (visible) {
            this.hiddenKinds.delete(kind);
        } else {
            this.hiddenKinds.add(kind);
        }
        this.recluster();
        this.redraw();
    }

    public setSectors(sectors: ScopeSector[]): void {
        this.sectors = sectors.map((s) => ({...s}));
        this.redraw();
    }

    /** Fixed outlines such as a coastline (relative to the centre; move them when the centre moves). */
    public setShapes(shapes: ScopeShape[]): void {
        this.shapes = shapes.map((s) => ({...s}));
        this.redraw();
    }

    /** Degrees per second; 0 switches the beam off (every echo stays lit). */
    public setSweepSpeed(speed: number): void {
        this.sweepSpeed = speed;
        this.redraw();
    }

    /** Freeze the beam (echoes keep their glow). */
    public setPaused(paused: boolean): void {
        this.pausedState = paused;
        this.lastFrame = 0;
        this.redraw();
    }

    /** True while the sweep is stopped. */
    public get paused(): boolean {
        return this.pausedState;
    }

    /** Current beam bearing in degrees. */
    public getSweep(): number {
        return this.sweep;
    }

    public setMaxRange(range: number | null): void {
        this.fixedRange = range;
        this.recluster();
        this.redraw();
    }

    public setCluster(distance: number | false | undefined): void {
        this.clusterDistance = distance;
        this.recluster();
        this.redraw();
    }

    /** Outline these target ids (null: none). */
    public highlight(ids: string[] | null): void {
        this.highlighted = ids === null ? null : new Set(ids);
        this.redraw();
    }

    public override destroy(): void {
        this.root.removeEventListener('pointermove', this.onMove);
        this.root.removeEventListener('pointerleave', this.onLeave);
        this.root.removeEventListener('click', this.onClick);
        super.destroy();
    }

    private static copyKinds(kinds: Record<string, ScopeKind>): Record<string, ScopeKind> {
        return Object.fromEntries(Object.entries(kinds).map(([id, k]) => [id, {...k}]));
    }

    // ---- geometry --------------------------------------------------------

    private maxRange(): number {
        if (this.fixedRange !== null) {
            return this.fixedRange;
        }

        const far = Math.max(1, ...this.targets.map((t) => t.range + (t.size ?? 0)));
        const mag = 10 ** Math.floor(Math.log10(far));

        return Math.ceil(far / mag * 2) / 2 * mag;
    }

    private visible(t: ScopeTarget): boolean {
        return t.kind === undefined || !this.hiddenKinds.has(t.kind);
    }

    private recluster(): void {
        const max = this.maxRange();
        const d = this.clusterDistance === undefined ? max * 0.08 : this.clusterDistance;

        if (d === false) {
            this.clusters = [];
            return;
        }

        const idx = this.targets.map((_, i) => i).filter((i) => {
            const t = this.targets[i]!;
            return this.visible(t) && (t.kind === undefined || this.kinds[t.kind]?.cluster !== false);
        });
        const pts = idx.map((i) => ScopeGeometry.toPlane(this.targets[i]!.bearing, this.targets[i]!.range));

        this.clusters = ScopeGeometry.cluster(pts, d).map((g) => g.map((k) => idx[k]!));
    }

    private toScreen(p: ScopePoint): {x: number; y: number} {
        const k = this.radius / this.maxRange();

        return {x: this.center.x + p.x * k, y: this.center.y - p.y * k};
    }

    private targetScreen(t: ScopeTarget): {x: number; y: number; r: number} {
        const s = this.toScreen(ScopeGeometry.toPlane(t.bearing, t.range));

        return {...s, r: Math.max(3, (t.size ?? this.maxRange() * 0.03) * this.radius / this.maxRange())};
    }

    private color(t: ScopeTarget): string {
        return (t.kind !== undefined ? this.kinds[t.kind]?.color : undefined) ?? this.colors.echo;
    }

    // ---- drawing ---------------------------------------------------------

    protected draw(ctx: CanvasRenderingContext2D, timeMs: number): boolean {
        const c = this.colors;
        const labelBand = this.bearingStep > 0 ? 26 : 6;

        this.radius = Math.max(10, Math.min(this.width, this.height) / 2 - labelBand - 4);
        this.center = {x: this.width / 2, y: this.height / 2};

        // advance the beam; light echoes it swept over since the last frame
        const running = this.sweepSpeed > 0 && !this.pausedState;

        if (running) {
            const dt = this.lastFrame === 0 ? 0 : Math.min(0.25, (timeMs - this.lastFrame) / 1000);
            const from = this.sweep;
            const step = dt * this.sweepSpeed;

            this.sweep = (this.sweep + step) % 360;
            for (const t of this.targets) {
                if (ScopeGeometry.sweepAge(t.bearing, this.sweep) <= step + 1e-9) {
                    this.lit.set(t.id, {at: timeMs});
                }
            }
            if (Math.floor((from + step) / 360) > 0 || this.clutterDots.length === 0) {
                this.newClutter(timeMs);
            }
            for (const d of this.clutterDots) {
                if (d.at < 0 && ScopeGeometry.sweepAge(d.b, this.sweep) <= step + 1e-9) {
                    d.at = timeMs;
                }
            }
        }
        this.lastFrame = running ? timeMs : 0;

        const {x: cx, y: cy} = this.center;
        const R = this.radius;

        // bezel + face
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R + labelBand, 0, Math.PI * 2);
        ctx.fillStyle = c.bezel;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
        g.addColorStop(0, Color.lerp(c.face, '#ffffff', 0.06));
        g.addColorStop(1, c.face);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.clip();

        for (const s of this.sectors) {
            const a0 = (s.from - 90) * Math.PI / 180;
            const a1 = (s.to - 90) * Math.PI / 180;
            const r = (s.range ?? this.maxRange()) * R / this.maxRange();

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, a0, a1 < a0 ? a1 + Math.PI * 2 : a1);
            ctx.closePath();
            ctx.fillStyle = s.color ?? 'rgba(255,255,255,0.1)';
            ctx.fill();
        }

        // land: a solid return with a brighter rim, like a coast on a real scope
        for (const shape of this.shapes) {
            if (shape.points.length < 3) {
                continue;
            }
            ctx.beginPath();
            shape.points.forEach((q, k) => {
                const p = this.toScreen(q);
                if (k === 0) {
                    ctx.moveTo(p.x, p.y);
                } else {
                    ctx.lineTo(p.x, p.y);
                }
            });
            ctx.closePath();
            ctx.fillStyle = shape.color ?? 'rgba(255,214,120,0.55)';
            ctx.fill();
            ctx.strokeStyle = shape.color ?? 'rgba(255,230,160,0.9)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // rings
        ctx.strokeStyle = c.ring;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 5]);
        for (let i = 1; i <= this.rings; i++) {
            ctx.beginPath();
            ctx.arc(cx, cy, R * i / (this.rings + 1), 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // beam with afterglow (drawn under the echoes)
        if (this.sweepSpeed > 0) {
            const steps = 24;
            for (let k = 0; k < steps; k++) {
                const b0 = this.sweep - this.trail * (k + 1) / steps;
                const b1 = this.sweep - this.trail * k / steps;

                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.arc(cx, cy, R, (b0 - 90) * Math.PI / 180, (b1 - 90) * Math.PI / 180);
                ctx.closePath();
                ctx.fillStyle = Color.withAlpha(c.sweep, (1 - k / steps) ** 2);
                ctx.fill();
            }

            const a = (this.sweep - 90) * Math.PI / 180;

            ctx.strokeStyle = c.beam;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
            ctx.stroke();
        }

        const persist = (this.persistence ?? (this.sweepSpeed > 0 ? 360 / this.sweepSpeed : 1)) * 1000;
        const glow = (id: string): number => {
            if (this.sweepSpeed <= 0) {
                return 1;
            }

            const l = this.lit.get(id);

            return l === undefined ? 0 : Math.max(0, 1 - (timeMs - l.at) / persist);
        };

        // clutter
        ctx.fillStyle = c.echo;
        for (const d of this.clutterDots) {
            const a = d.at < 0 ? (this.sweepSpeed > 0 ? 0 : 0.35) : Math.max(0, 0.45 * (1 - (timeMs - d.at) / persist));

            if (a <= 0) {
                continue;
            }

            const p = this.toScreen(ScopeGeometry.toPlane(d.b, d.r));

            ctx.globalAlpha = a;
            ctx.fillRect(p.x, p.y, 1.6, 1.6);
        }
        ctx.globalAlpha = 1;

        // echoes
        this.targets.forEach((t, i) => {
            if (!this.visible(t)) {
                return;
            }

            const s = this.targetScreen(t);
            const alpha = glow(t.id) * (t.intensity ?? 1);

            if (alpha <= 0.01 && i !== this.hoverTarget) {
                return;
            }

            const shape = ScopeGeometry.blob(ScopeGeometry.hash(t.id));
            const n = shape.length;
            const color = this.color(t);

            ctx.beginPath();
            for (let k = 0; k <= n; k++) {
                const kk = k % n;
                const kn = (k + 1) % n;
                const a = kk / n * Math.PI * 2;
                const an = (kk + 0.5) / n * Math.PI * 2;
                const r = s.r * shape[kk]!;
                const rm = s.r * (shape[kk]! + shape[kn]!) / 2;

                if (k === 0) {
                    ctx.moveTo(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
                } else {
                    ctx.quadraticCurveTo(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r,
                        s.x + Math.cos(an) * rm, s.y + Math.sin(an) * rm);
                }
            }
            ctx.closePath();
            ctx.globalAlpha = Math.max(alpha, i === this.hoverTarget ? 0.6 : 0);
            ctx.shadowColor = color;
            ctx.shadowBlur = 8 * alpha;
            ctx.fillStyle = color;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
            if (i === this.hoverTarget || this.highlighted?.has(t.id) === true) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        });

        // cluster loops
        this.clusters.forEach((group, gi) => {
            const pts = group.map((i) => ScopeGeometry.toPlane(this.targets[i]!.bearing, this.targets[i]!.range));
            const pad = Math.max(...group.map((i) => this.targets[i]!.size ?? this.maxRange() * 0.03)) * 1.9;
            const loop = ScopeGeometry.loop(pts, pad).map((p) => this.toScreen(p));
            const lit = Math.max(...group.map((i) => glow(this.targets[i]!.id)));

            if (loop.length < 3 || (lit <= 0.05 && gi !== this.hoverCluster)) {
                return;
            }

            ctx.beginPath();
            loop.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.closePath();
            ctx.strokeStyle = c.cluster;
            ctx.globalAlpha = gi === this.hoverCluster ? 1 : 0.35 + 0.65 * lit;
            ctx.lineWidth = gi === this.hoverCluster ? 4 : 3;
            ctx.lineJoin = 'round';
            ctx.stroke();
            ctx.globalAlpha = 1;
        });
        ctx.restore();

        this.drawBezel(ctx, labelBand);
        this.drawTooltip(ctx);

        return running;
    }

    private newClutter(timeMs: number): void {
        const max = this.maxRange();
        let s = (this.seed = (this.seed * 16807) % 2147483647);
        const rnd = (): number => {
            s = (s * 16807) % 2147483647;
            return (s - 1) / 2147483646;
        };

        this.clutterDots = Array.from({length: this.clutter}, () => ({
            b: rnd() * 360,
            // sea clutter is strongest near the ship
            r: max * (0.05 + 0.6 * rnd() ** 1.8),
            at: this.sweepSpeed > 0 ? -1 : timeMs
        }));
    }

    private drawBezel(ctx: CanvasRenderingContext2D, band: number): void {
        const c = this.colors;
        const {x: cx, y: cy} = this.center;
        const R = this.radius;

        ctx.save();
        ctx.strokeStyle = c.label;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.stroke();

        if (this.bearingStep > 0) {
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let d = 0; d < 360; d += 2) {
                const a = (d - 90) * Math.PI / 180;
                const len = d % 10 === 0 ? 7 : 4;
                ctx.moveTo(cx + Math.cos(a) * (R + band), cy + Math.sin(a) * (R + band));
                ctx.lineTo(cx + Math.cos(a) * (R + band - len), cy + Math.sin(a) * (R + band - len));
            }
            ctx.stroke();
            ctx.fillStyle = c.label;
            ctx.font = `${Math.max(9, Math.min(13, R / 11))}px system-ui, -apple-system, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (let d = 0; d < 360; d += this.bearingStep) {
                const a = (d - 90) * Math.PI / 180;
                const r = R + band / 2 - 2;
                ctx.fillText(String(d), cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            }
        }

        if (this.rangeFormat !== undefined) {
            ctx.fillStyle = Color.withAlpha(c.label, 0.7);
            ctx.font = '10px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            for (let i = 1; i <= this.rings; i++) {
                const r = this.maxRange() * i / (this.rings + 1);
                ctx.fillText(this.rangeFormat(r), cx + 3, cy - R * i / (this.rings + 1) - 2);
            }
        }
        ctx.restore();
    }

    private drawTooltip(ctx: CanvasRenderingContext2D): void {
        const at = this.pointer;
        let text: string | null = null;
        let color = this.colors.cluster;

        if (at === null) {
            return;
        }

        const t = this.targets[this.hoverTarget];

        if (t !== undefined) {
            const kind = t.kind !== undefined ? this.kinds[t.kind]?.label : undefined;
            const range = this.rangeFormat?.(t.range) ?? String(Math.round(t.range * 10) / 10);

            text = `${t.label ?? kind ?? t.id} · ${Math.round(t.bearing)}° · ${range}`;
            color = this.color(t);
        } else if (this.hoverCluster >= 0) {
            const group = this.clusters[this.hoverCluster] ?? [];
            const counts = new Map<string, number>();

            for (const i of group) {
                const k = this.targets[i]!.kind;
                const label = (k !== undefined ? this.kinds[k]?.label : undefined) ?? 'echo';
                counts.set(label, (counts.get(label) ?? 0) + 1);
            }
            text = `Cluster: ${Array.from(counts, ([l, n]) => `${n} ${l}`).join(', ')}`;
        }
        if (text === null) {
            return;
        }

        ctx.save();
        ctx.font = '600 11px system-ui, -apple-system, sans-serif';

        const w = ctx.measureText(text).width + 18;
        const x = Math.max(4, Math.min(this.width - w - 4, at.x + 12));
        const y = Math.max(4, at.y - 30);

        ctx.beginPath();
        ctx.roundRect(x, y, w, 22, 4);
        ctx.fillStyle = Color.withAlpha(this.colors.bezel, 0.95);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = this.colors.label;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 9, y + 11.5);
        ctx.restore();
    }

    // ---- interaction -----------------------------------------------------

    private hit(px: number, py: number): {target: number; cluster: number} {
        let target = -1;
        let best = Infinity;

        this.targets.forEach((t, i) => {
            if (!this.visible(t)) {
                return;
            }

            const s = this.targetScreen(t);
            const d = Math.hypot(px - s.x, py - s.y);

            if (d <= s.r + 4 && d < best) {
                best = d;
                target = i;
            }
        });

        let cluster = -1;

        if (target < 0) {
            const p = {
                x: (px - this.center.x) * this.maxRange() / this.radius,
                y: -(py - this.center.y) * this.maxRange() / this.radius
            };

            cluster = this.clusters.findIndex((group) => {
                const pts = group.map((i) => ScopeGeometry.toPlane(this.targets[i]!.bearing, this.targets[i]!.range));
                const pad = Math.max(...group.map((i) => this.targets[i]!.size ?? this.maxRange() * 0.03)) * 1.9;
                return RadarScope.inside(p, ScopeGeometry.loop(pts, pad));
            });
        } else {
            cluster = this.clusters.findIndex((g) => g.includes(target));
        }

        return {target, cluster};
    }

    private static inside(p: ScopePoint, poly: ScopePoint[]): boolean {
        let c = false;

        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i]!;
            const b = poly[j]!;

            if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) {
                c = !c;
            }
        }

        return c;
    }

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);
        const h = this.hit(p.x, p.y);
        const tChanged = h.target !== this.hoverTarget;
        const cChanged = h.cluster !== this.hoverCluster;

        this.pointer = p;
        this.hoverTarget = h.target;
        this.hoverCluster = h.cluster;
        this.root.style.cursor = h.target >= 0 || h.cluster >= 0 ? 'pointer' : '';
        if (tChanged) {
            const t = this.targets[h.target];
            this.events.emit('targetHover', t === undefined ? null : {target: {...t}});
        }
        if (cChanged) {
            const g = this.clusters[h.cluster];
            this.events.emit('clusterHover', g === undefined ? null : {targets: g.map((i) => ({...this.targets[i]!}))});
        }
        this.redraw();
    };

    private readonly onLeave = (): void => {
        this.pointer = null;
        if (this.hoverTarget >= 0) {
            this.events.emit('targetHover', null);
        }
        if (this.hoverCluster >= 0) {
            this.events.emit('clusterHover', null);
        }
        this.hoverTarget = -1;
        this.hoverCluster = -1;
        this.redraw();
    };

    private readonly onClick = (e: MouseEvent): void => {
        const p = this.local(e);
        const h = this.hit(p.x, p.y);
        const t = this.targets[h.target];

        if (t !== undefined) {
            this.events.emit('targetClick', {target: {...t}});
        } else if (h.cluster >= 0) {
            this.events.emit('clusterClick', {targets: this.clusters[h.cluster]!.map((i) => ({...this.targets[i]!}))});
        }
    };

}
