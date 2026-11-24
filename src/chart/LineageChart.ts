import { Color } from '../util/Color';
import { Camera } from '../view/Camera';
import { ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { LineageBand, LineageLayout as L, LineageNode, LineagePlaced, LineagePoint, LineageResult, LineageScale } from './LineageLayout';

export interface LineageChartOptions {
    nodes?: LineageNode[];
    bands?: LineageBand[];
    /** Axis range in years (default: a year before the first node up to the current year). */
    from?: number;
    to?: number;
    /** 'linear' or 'compressed' (quiet decades shrink; default). */
    scale?: LineageScale;
    /** Colours from the earliest to the latest year (default green → cyan → violet). */
    colors?: string[];
    /** Legend text of marked nodes; '' hides that legend entry (default 'Marked'). */
    markLabel?: string;
    /** Show only what existed up to this year (null = everything). */
    time?: number | null;
    /** World width of the picture (default 1400). */
    width?: number;
    rowHeight?: number;
    /** Legend in the bottom-left corner (default true). */
    legend?: boolean;
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
}

export interface LineageHover {
    node: LineageNode;
    parent: LineageNode | null;
    children: LineageNode[];
    /** Every descendant. */
    descendants: number;
}

export interface LineageChartEvents extends Record<string, unknown> {
    hover: LineageHover | null;
    click: LineageHover | null;
}

interface PNode extends LineagePlaced {
    color: string;
    vis: number;
}

/**
 * A family tree on a time axis: every member a dot at the year it appeared,
 * successors continue their parent's row, offshoots branch off on rounded
 * risers, lines run on to the end of the axis while a member lives. Year tags
 * along the top, bands (e.g. embedded systems) stacked below, colour from
 * early to modern. Hover lights a member's ancestry and descendants;
 * `setTime` replays how the tree grew. Pan/zoom like a poster.
 */
export class LineageChart extends ChartSurface<LineageChartEvents> {

    private static readonly COLORS = ['#3ddc84', '#22c5ee', '#7d6cf2'];
    private static readonly R = 6;

    private nodes: LineageNode[] = [];
    private bands: LineageBand[] = [];
    private pn: PNode[] = [];
    private byId = new Map<string, PNode>();
    private res: LineageResult | null = null;
    private from = 0;
    private to = 1;
    private readonly fixedFrom: number | undefined;
    private readonly fixedTo: number | undefined;
    private scale: LineageScale;
    private readonly colors: string[];
    private readonly markLabel: string;
    private readonly worldW: number;
    private readonly rowH: number;
    private readonly showLegend: boolean;
    private time: number | null;
    private shownTime = 0;
    private readonly top = 64;
    private readonly camera = new Camera(0.1, 8);
    private userMoved = false;
    private fitW = 0;
    private fitH = 0;
    private hover: string | null = null;
    private pinned: string | null = null;
    private external: Set<string> | null = null;
    private pointer: {x: number; y: number} | null = null;
    private drag: {x: number; y: number; moved: boolean} | null = null;
    private lastTime = -1;

    public constructor(container: HTMLElement, options: LineageChartOptions = {}) {
        super(container, options.theme ?? 'dark');
        this.fixedFrom = options.from;
        this.fixedTo = options.to;
        this.scale = options.scale ?? 'compressed';
        this.colors = (options.colors ?? LineageChart.COLORS).slice();
        this.markLabel = options.markLabel ?? 'Marked';
        this.worldW = options.width ?? 1400;
        this.rowH = options.rowHeight ?? 40;
        this.showLegend = options.legend ?? true;
        this.time = options.time ?? null;

        this.canvas.addEventListener('pointerdown', this.onDown);
        this.canvas.addEventListener('pointermove', this.onMove);
        this.canvas.addEventListener('pointerup', this.onUp);
        this.canvas.addEventListener('pointercancel', this.onUp);
        this.canvas.addEventListener('pointerleave', this.onLeave);
        this.canvas.addEventListener('wheel', this.onWheel, {passive: false});
        this.canvas.addEventListener('dblclick', this.onDblClick);
        this.setData(options.nodes ?? [], options.bands);
    }

    // ---- public API ------------------------------------------------------------------------------------------

    public setData(nodes: LineageNode[], bands?: LineageBand[]): void {
        this.nodes = nodes.map((n) => ({...n}));
        if (bands !== undefined) {
            this.bands = bands.map((b) => ({...b}));
        }
        this.prepare();
        this.shownTime = this.time ?? this.to;
        this.userMoved = false;
        this.redraw();
    }

    public setScale(scale: LineageScale): void {
        this.scale = scale;
        this.prepare();
        this.redraw();
    }

    /** Show what existed up to `year` (null = everything); lines grow towards it. */
    public setTime(year: number | null): void {
        this.time = year;
        this.redraw();
    }

    public getTime(): number | null {
        return this.time;
    }

    public getRange(): {from: number; to: number} {
        return {from: this.from, to: this.to};
    }

    /** Light these members from outside (null clears); hover and click win. */
    public highlight(ids: Iterable<string> | null): void {
        this.external = ids === null ? null : new Set(ids);
        this.redraw();
    }

    /** Pin a member like a click would (null clears). */
    public select(id: string | null): void {
        this.pinned = id;
        this.redraw();
    }

    /** Ancestors + descendants of a member. */
    public lineage(id: string): Set<string> {
        return L.lineage(this.nodes, id);
    }

    /** Fly to a member. */
    public focusNode(id: string, scale = 1.6): void {
        const p = this.byId.get(id);
        if (p === undefined) {
            return;
        }
        this.userMoved = true;
        this.camera.flyTo(this.camera.centerState(p.x, p.y, this.width, this.height, scale), 450);
        this.redraw();
    }

    /** Frame the whole tree (animated by default). */
    public fit(animate = true): void {
        this.userMoved = false;
        this.camera.flyTo(this.fitState(), animate ? 350 : 0);
        this.redraw();
    }

    /** Frame the whole tree again (same as `fit()`). */
    public resetView(): void {
        this.fit(true);
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

    // ---- layout ------------------------------------------------------------------------------------------------

    private prepare(): void {
        const years = this.nodes.map((n) => n.year);
        const min = years.length > 0 ? Math.min(...years) : new Date().getFullYear() - 10;
        this.from = this.fixedFrom ?? Math.floor(min) - 1;
        this.to = this.fixedTo ?? Math.max(new Date().getFullYear(), ...this.nodes.map((n) => Math.ceil(n.end ?? n.year)));
        this.res = L.layout(this.nodes, {
            from: this.from, to: this.to, scale: this.scale, x0: 70, x1: this.worldW - 20, top: this.top,
            rowHeight: this.rowH, bands: this.bands
        });
        const span = Math.max(1, this.to - this.from);
        const old = new Map(this.pn.map((p) => [p.node.id, p.vis]));
        this.pn = this.res.placed.map((p) => ({
            ...p,
            color: p.node.color ?? L.colorAt((p.node.year - this.from) / span, this.colors),
            vis: old.get(p.node.id) ?? 1
        }));
        this.byId = new Map(this.pn.map((p) => [p.node.id, p]));
    }

    private fitState(): ReturnType<Camera['fitState']> {
        const bottom = (this.res?.bottom ?? 200) + 34;

        return this.camera.fitState({minX: 0, minY: 0, maxX: this.worldW, maxY: bottom}, this.width, this.height, 12, 12);
    }

    // ---- focus -------------------------------------------------------------------------------------------------

    /** Members to keep bright (null = all). */
    private lit(): Set<string> | null {
        // a pinned member that does not exist yet at the shown time lights nothing
        const pin = this.pinned !== null && (this.byId.get(this.pinned)?.vis ?? 0) > 0.5 ? this.pinned : null;
        const f = this.hover ?? pin;
        if (f !== null) {
            return L.lineage(this.nodes, f);
        }

        return this.external;
    }

    private info(id: string | null): LineageHover | null {
        const p = id !== null ? this.byId.get(id) : undefined;
        if (p === undefined) {
            return null;
        }
        const n = p.node;
        const children = this.nodes.filter((c) => c.parent === n.id);
        const desc = L.lineage(this.nodes, n.id);
        let anc = 0, q = n.parent !== undefined ? this.byId.get(n.parent)?.node : undefined;
        while (q !== undefined && anc < this.nodes.length) {
            anc++;
            q = q.parent !== undefined ? this.byId.get(q.parent)?.node : undefined;
        }

        return {
            node: {...n},
            parent: LineageChart.copyNode(n.parent !== undefined ? this.byId.get(n.parent)?.node ?? null : null),
            children: children.map((c) => ({...c})),
            descendants: desc.size - 1 - anc
        };
    }

    // ---- drawing -------------------------------------------------------------------------------------------

    protected draw(ctx: CanvasRenderingContext2D, timeMs: number): boolean {
        const dt = this.lastTime < 0 ? 16 : Math.min(100, timeMs - this.lastTime);
        this.lastTime = timeMs;

        if (!this.userMoved && (this.fitW !== this.width || this.fitH !== this.height)) {
            this.camera.setState(this.fitState());
            this.fitW = this.width;
            this.fitH = this.height;
        }
        ctx.fillStyle = this.theme.background;
        ctx.fillRect(0, 0, this.width, this.height);
        const flying = this.camera.step(timeMs);
        const moving = this.step(dt);
        const res = this.res;

        if (res !== null) {
            const lit = this.lit();
            ctx.save();
            this.camera.apply(ctx);
            this.drawBands(ctx, res);
            this.drawGrid(ctx, res);
            this.drawLines(ctx, res, lit);
            this.drawNodes(ctx, lit);
            ctx.restore();
            if (this.showLegend) {
                this.drawLegend(ctx);
            }
            this.drawTooltip(ctx);
        }
        if (!moving && !flying) {
            this.lastTime = -1;
        }

        return moving || flying;
    }

    /** Ease the shown time and the node fades; true while moving. */
    private step(dt: number): boolean {
        const target = this.time ?? this.to;
        const k = 1 - Math.exp(-dt / 140);
        let moving = false;
        const d = target - this.shownTime;
        if (Math.abs(d) > 0.01) {
            this.shownTime += d * Math.min(1, k * 1.2);
            moving = true;
        } else {
            this.shownTime = target;
        }
        for (const p of this.pn) {
            const v = p.node.year <= this.shownTime + 1e-6 ? 1 : 0;
            const dv = v - p.vis;
            if (Math.abs(dv) > 0.01) {
                p.vis += dv * k;
                moving = true;
            } else {
                p.vis = v;
            }
        }

        return moving;
    }

    private get dark(): boolean {
        const c = Color.parse(this.theme.background);

        return c === null || c.r + c.g + c.b < 384;
    }

    private drawBands(ctx: CanvasRenderingContext2D, res: LineageResult): void {
        const x0 = res.x(this.from), x1 = res.x(this.to);
        for (const b of res.bands) {
            if (b.id === '') {
                continue;
            }
            ctx.fillStyle = this.dark ? 'rgba(70,120,190,0.16)' : 'rgba(40,90,160,0.07)';
            ctx.fillRect(x0 - 50, b.y0 - 8, x1 - x0 + 70, b.y1 - b.y0 + 30);
            ctx.fillStyle = this.theme.title;
            ctx.font = `600 13px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(b.label, (x0 + x1) / 2, b.y1 + 16);
            // the band's top edge doubles as a year ruler
            ctx.strokeStyle = this.theme.axis;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x0 - 50, b.y0 - 8);
            ctx.lineTo(x1 + 20, b.y0 - 8);
            for (let y = Math.ceil(this.from); y <= this.to; y++) {
                const x = res.x(y);
                const len = y % 10 === 0 ? 7 : y % 5 === 0 ? 5 : 3;
                ctx.moveTo(x, b.y0 - 8 - len / 2);
                ctx.lineTo(x, b.y0 - 8 + len / 2);
            }
            ctx.stroke();
        }
    }

    private drawGrid(ctx: CanvasRenderingContext2D, res: LineageResult): void {
        const shown = this.pn.filter((p) => p.vis > 0.5);
        const years = shown.map((p) => Math.floor(p.node.year));
        const tags = L.tags(years, res.x, 34);
        const bottom = res.bottom + 20;

        ctx.strokeStyle = this.theme.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const y of new Set(years)) {
            const x = res.x(y);
            ctx.moveTo(x, this.top - 26);
            ctx.lineTo(x, bottom);
        }
        // frame line under the tags
        ctx.moveTo(res.x(this.from) - 50, this.top - 34);
        ctx.lineTo(res.x(this.to) + 20, this.top - 34);
        ctx.stroke();

        ctx.font = '700 9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const t of tags) {
            const y = this.top - 52 + t.level * 15;
            ctx.fillStyle = this.theme.marker;
            ctx.beginPath();
            ctx.roundRect(t.x - 15, y - 6, 30, 12, 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.fillText(String(t.year), t.x, y + 0.5);
        }
        // the time cursor while replaying
        if (this.time !== null && this.shownTime < this.to) {
            const x = res.x(this.shownTime);
            ctx.strokeStyle = this.theme.marker;
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(x, this.top - 30);
            ctx.lineTo(x, bottom);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    private drawLines(ctx: CanvasRenderingContext2D, res: LineageResult, lit: Set<string> | null): void {
        const clipX = res.x(this.shownTime);
        const base = this.dark ? '#eef3fb' : '#3a4660';

        ctx.save();
        ctx.beginPath();
        ctx.rect(-1e5, -1e5, clipX + 1e5, 2e5);
        ctx.clip();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // dimmed first, the lit lineage on top
        for (const pass of [false, true]) {
            for (const p of this.pn) {
                const on = lit === null || lit.has(p.node.id);
                if (on !== pass && lit !== null) {
                    continue;
                }
                if (lit === null && pass) {
                    continue;
                }
                const alpha = p.vis * (on ? 1 : 0.18);
                if (alpha < 0.01) {
                    continue;
                }
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = lit !== null && on ? Color.lerp(base, p.color, 0.45) : base;
                ctx.lineWidth = lit !== null && on ? 3 : 2.2;
                if (p.incoming.length > 1) {
                    LineageChart.rounded(ctx, p.incoming, 9);
                }
                if (p.tail.length > 1) {
                    const [a, b] = [p.tail[0]!, p.tail[1]!];
                    ctx.beginPath();
                    ctx.moveTo(a[0], a[1]);
                    ctx.lineTo(b[0], b[1]);
                    ctx.stroke();
                    if (p.ended && b[0] - a[0] > 2) {
                        // a short bar where it stopped
                        ctx.beginPath();
                        ctx.moveTo(b[0], b[1] - 4);
                        ctx.lineTo(b[0], b[1] + 4);
                        ctx.stroke();
                    }
                }
            }
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    /** Stroke a polyline with rounded corners (radius clamped to half the shorter leg). */
    private static rounded(ctx: CanvasRenderingContext2D, pts: ReadonlyArray<LineagePoint>, r: number): void {
        ctx.beginPath();
        ctx.moveTo(pts[0]![0], pts[0]![1]);
        for (let i = 1; i < pts.length - 1; i++) {
            const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!, [cx, cy] = pts[i + 1]!;
            const rr = Math.min(r, Math.hypot(bx - ax, by - ay) / 2, Math.hypot(cx - bx, cy - by) / 2);
            ctx.arcTo(bx, by, cx, cy, Math.max(0, rr));
        }
        const last = pts[pts.length - 1]!;
        ctx.lineTo(last[0], last[1]);
        ctx.stroke();
    }

    private drawNodes(ctx: CanvasRenderingContext2D, lit: Set<string> | null): void {
        const sel = this.hover ?? this.pinned;
        const labelZoom = this.camera.scale;

        for (const p of this.pn) {
            if (p.vis < 0.01) {
                continue;
            }
            const on = lit === null || lit.has(p.node.id);
            const pop = 0.6 + 0.4 * p.vis;
            ctx.globalAlpha = p.vis * (on ? 1 : 0.25);
            const r = LineageChart.R * pop * (p.node.id === sel ? 1.25 : 1);
            ctx.fillStyle = Color.withAlpha(p.color, 0.3);
            ctx.beginPath();
            ctx.arc(p.x, p.y, r + 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            if (p.node.mark === true) {
                ctx.strokeStyle = this.theme.background;
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2);
                ctx.stroke();
            }
            if (p.node.id === sel) {
                ctx.strokeStyle = this.theme.select;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
                ctx.stroke();
            }
            // labels: hidden when too small on screen
            if (labelZoom * 10 < 6) {
                continue;
            }
            const lines = p.node.label.split('\n');
            const pos = p.node.labelPosition ?? 'below';
            ctx.fillStyle = this.theme.title;
            ctx.font = `700 10px system-ui, sans-serif`;
            ctx.textBaseline = 'middle';
            const lh = 12;
            // a halo in the background colour keeps text readable over lines
            ctx.strokeStyle = this.theme.background;
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            const text = (t: string, x: number, y: number): void => {
                ctx.strokeText(t, x, y);
                ctx.fillText(t, x, y);
            };
            if (pos === 'right') {
                // right of the dot, just above its line
                ctx.textAlign = 'left';
                lines.forEach((t, i) => text(t, p.x + r + 5, p.y - 8 - (lines.length - 1 - i) * lh));
            } else {
                ctx.textAlign = 'center';
                const y0 = pos === 'above' ? p.y - r - 9 - (lines.length - 1) * lh : p.y + r + 10;
                lines.forEach((t, i) => text(t, p.x, y0 + i * lh));
            }
        }
        ctx.globalAlpha = 1;
    }

    private drawLegend(ctx: CanvasRenderingContext2D): void {
        const showMark = this.markLabel !== '' && this.nodes.some((n) => n.mark === true);
        const w = 128, h = showMark ? 82 : 62;
        const x = 10, y = this.height - h - 10;

        ctx.font = ChartSurface.FONT;
        ctx.fillStyle = this.dark ? '#ffffff' : '#f6f8fc';
        ctx.globalAlpha = this.dark ? 0.96 : 1;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 3);
        ctx.fill();
        ctx.globalAlpha = 1;
        const g = ctx.createLinearGradient(0, y + 10, 0, y + 46);
        this.colors.forEach((c, i) => g.addColorStop(i / Math.max(1, this.colors.length - 1), c));
        ctx.fillStyle = g;
        ctx.fillRect(x + 10, y + 10, 6, 36);
        ctx.fillStyle = '#273142';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('Earlier', x + 22, y + 14);
        ctx.fillText('Modern', x + 22, y + 42);
        if (showMark) {
            const c = this.colors[Math.floor(this.colors.length / 2)] ?? '#22c5ee';
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(x + 13, y + 64, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(x + 13, y + 64, 2.5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#273142';
            ctx.fillText(this.markLabel, x + 22, y + 64);
        }
    }

    private drawTooltip(ctx: CanvasRenderingContext2D): void {
        const info = this.info(this.hover);
        if (info === null || this.pointer === null || this.drag?.moved === true) {
            return;
        }
        const n = info.node;
        const fmt = (y: number): string => String(Math.floor(y));
        const lines = [
            n.label.replace(/\n/g, ' '),
            n.end !== undefined ? `${fmt(n.year)} – ${fmt(n.end)}` : `since ${fmt(n.year)}`,
            ...(n.description !== undefined ? [n.description] : []),
            ...(info.parent !== null ? [`from ${info.parent.label.replace(/\n/g, ' ')}`] : []),
            ...(info.descendants > 0 ? [`${info.descendants} descendant${info.descendants === 1 ? '' : 's'}`] : [])
        ];
        ctx.font = ChartSurface.FONT;
        const w = Math.max(...lines.map((t, i) => ctx.measureText(t).width + (i === 0 ? 14 : 0))) + 20;
        const h = lines.length * 16 + 10;
        let x = this.pointer.x + 14, y = this.pointer.y + 14;
        if (x + w > this.width - 4) {
            x = this.pointer.x - w - 14;
        }
        if (y + h > this.height - 4) {
            y = this.pointer.y - h - 14;
        }
        ctx.fillStyle = this.dark ? 'rgba(14,20,36,0.96)' : 'rgba(255,255,255,0.97)';
        ctx.strokeStyle = this.byId.get(n.id)?.color ?? this.theme.axis;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 5);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        lines.forEach((t, i) => {
            ctx.fillStyle = i === 0 ? this.theme.title : this.theme.text;
            ctx.font = i === 0 ? `600 12px system-ui, sans-serif` : ChartSurface.FONT;
            ctx.fillText(t, x + 10, y + 13 + i * 16);
        });
    }

    // ---- input -------------------------------------------------------------------------------------------------

    private pick(sx: number, sy: number): string | null {
        const {x, y} = this.camera.toWorld(sx, sy);
        const tol = 5 / this.camera.scale;
        let best: string | null = null, bd = LineageChart.R + tol;
        for (const p of this.pn) {
            if (p.vis < 0.5) {
                continue;
            }
            const d = Math.hypot(p.x - x, p.y - y);
            if (d < bd) {
                bd = d;
                best = p.node.id;
            }
        }
        if (best !== null) {
            return best;
        }
        // lines belong to the member they lead to (incoming) or run after (tail)
        bd = tol;
        for (const p of this.pn) {
            if (p.vis < 0.5) {
                continue;
            }
            const d = Math.min(L.distanceToPath(x, y, p.incoming), L.distanceToPath(x, y, p.tail));
            if (d < bd) {
                bd = d;
                best = p.node.id;
            }
        }

        return best;
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
        if (hit !== this.hover) {
            this.hover = hit;
            this.events.emit('hover', this.info(hit));
        }
        this.redraw();
    };

    private readonly onUp = (e: PointerEvent): void => {
        const d = this.drag;
        this.drag = null;
        if (this.canvas.hasPointerCapture(e.pointerId)) {
            this.canvas.releasePointerCapture(e.pointerId);
        }
        if (d !== null && !d.moved && e.type === 'pointerup') {
            const p = this.local(e);
            const hit = this.pick(p.x, p.y);
            this.pinned = hit === null || hit === this.pinned ? null : hit;
            this.events.emit('click', this.info(this.pinned));
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

    private static copyNode(node: LineageNode | null): LineageNode | null {
        return node === null ? null : {...node};
    }

}
