import { Color } from '../util/Color';
import { ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import {
    BurstGroupSpan, BurstLength, BurstMode, BurstOrder, BurstScale, OutcomeBurstLayout as L
} from './OutcomeBurstLayout';

/** One description of the data (e.g. "contract = one year") with how often it occurs and how it ends. */
export interface BurstItem {
    id: string;
    /** The attribute it describes (group mode puts each group into its own sector). */
    group: string;
    /** The value or rule, e.g. "one year". */
    label: string;
    /** How many records match (frequency). */
    count: number;
    /** Probability of the positive outcome among them, 0…1. */
    probability: number;
    /** Lift of the majority outcome; default its probability ÷ its base rate (`baseRate`). */
    lift?: number;
}

/** The two outcomes: the positive one is the "yes" (e.g. churn), drawn from the centre outwards up to its probability. */
export interface BurstOutcomes {
    positive: {name: string; color: string};
    negative: {name: string; color: string};
}

export interface OutcomeBurstOptions {
    items?: BurstItem[];
    outcomes?: Partial<BurstOutcomes>;
    /** Share of the positive outcome in all records (for the default lift); default 0.5. */
    baseRate?: number;
    /** What the strand length shows (default 'count'; 'probability' = probability of the majority outcome). */
    length?: BurstLength;
    /** Order of the strands on each side, from the right (default 'probability'). */
    order?: BurstOrder;
    /** 'group' gives every attribute its own sector (default 'overview'). */
    mode?: BurstMode;
    /** Show only these items (null = all); the others shrink away and the rest close up. */
    filter?: ((item: BurstItem) => boolean) | null;
    /** Strands sway gently (keeps the render loop running; default false). */
    sway?: boolean;
    /** Percent labels at the ends of the sides (overview ordered by probability; default true). */
    sideLabels?: boolean;
    /** Unit of `count` in the tooltip (default 'records'). */
    unit?: string;
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
}

export interface BurstHover {
    item: BurstItem;
    lift: number;
    /** 'positive' or 'negative': the majority outcome. */
    majority: 'positive' | 'negative';
}

export interface OutcomeBurstEvents extends Record<string, unknown> {
    hover: BurstHover | null;
    click: BurstHover | null;
}

interface Anim {
    angle: number;
    frac: number;
    alpha: number;
    split: number;
}

interface Strand {
    item: BurstItem;
    lift: number;
    visible: boolean;
    target: Anim;
    now: Anim;
    /** Earliest time it starts moving (staggered entry). */
    start: number;
    seed: number;
    seed2: number;
    /** Angular room of its slot (radians), for the width. */
    slot: number;
    /** Screen centre line of the last frame (hit test). */
    line: number[];
    dot: [number, number];
}

/**
 * A burst of strands out of one hub, one per description of the data (an
 * attribute value or rule). Length = how often it occurs (or its probability
 * or lift); each strand is drawn in the positive outcome's colour from the
 * centre up to that outcome's probability, then in the negative colour, and
 * ends in a dot of the majority outcome. The positive majority fills the top
 * half, the negative one the bottom half, both strongest at the right — read
 * counter-clockwise from the right the positive probability falls all the way
 * round. Group mode gives every attribute a sector; filters let strands
 * shrink away while the rest close up.
 */
export class OutcomeBurst extends ChartSurface<OutcomeBurstEvents> {

    private static readonly DEFAULT_OUTCOMES: BurstOutcomes = {
        positive: {name: 'Yes', color: '#ff3d47'},
        negative: {name: 'No', color: '#2ed3e6'}
    };

    private items: BurstItem[] = [];
    private strands = new Map<string, Strand>();
    private outcomes: BurstOutcomes;
    private baseRate: number;
    private length: BurstLength;
    private order: BurstOrder;
    private mode: BurstMode;
    private filter: ((item: BurstItem) => boolean) | null;
    private sway: boolean;
    private sideLabels: boolean;
    private unit: string;
    private scaleNow: BurstScale = L.scale([], 'count');
    private groups: BurstGroupSpan[] = [];
    private hover: Strand | null = null;
    private selected: string | null = null;
    private highlighted: Set<string> | null = null;
    private pointer: {x: number; y: number} | null = null;
    private lastTime = -1;
    private born = -1;
    private geo = {cx: 0, cy: 0, R: 1, r0: 1};

    public constructor(container: HTMLElement, options: OutcomeBurstOptions = {}) {
        super(container, options.theme ?? 'dark');
        this.outcomes = {
            positive: {...OutcomeBurst.DEFAULT_OUTCOMES.positive, ...options.outcomes?.positive},
            negative: {...OutcomeBurst.DEFAULT_OUTCOMES.negative, ...options.outcomes?.negative}
        };
        this.baseRate = options.baseRate ?? 0.5;
        this.length = options.length ?? 'count';
        this.order = options.order ?? 'probability';
        this.mode = options.mode ?? 'overview';
        this.filter = options.filter ?? null;
        this.sway = options.sway ?? false;
        this.sideLabels = options.sideLabels ?? true;
        this.unit = options.unit ?? 'records';

        this.canvas.addEventListener('pointermove', this.onMove);
        this.canvas.addEventListener('pointerleave', this.onLeave);
        this.canvas.addEventListener('click', this.onClick);
        this.setItems(options.items ?? []);
    }

    // ---- data ---------------------------------------------------------------------------------------------------

    /** New items; strands with a known id morph to their new place, new ones grow, gone ones shrink away. */
    public setItems(items: BurstItem[]): void {
        this.items = items.map((i) => ({...i}));
        const keep = new Set(this.items.map((i) => i.id));

        for (const it of this.items) {
            const lift = it.lift ?? OutcomeBurst.defaultLift(it.probability, this.baseRate);
            const s = this.strands.get(it.id);

            if (s !== undefined) {
                s.item = it;
                s.lift = lift;
            } else {
                this.strands.set(it.id, {
                    item: it, lift, visible: true,
                    target: {angle: 0, frac: 0, alpha: 1, split: it.probability},
                    now: {angle: 0, frac: 0, alpha: 0, split: it.probability},
                    start: -1, seed: L.hash(it.id), seed2: L.hash(`${it.id}~`), slot: 0.02, line: [], dot: [0, 0]
                });
            }
        }
        for (const [id, s] of this.strands) {
            if (!keep.has(id)) {
                s.visible = false;
                s.target.frac = 0;
                s.target.alpha = 0;
            }
        }
        if (this.hover !== null && !keep.has(this.hover.item.id)) {
            this.hover = null;
        }
        this.relayout(true);
    }

    public setLength(length: BurstLength): void {
        this.length = length;
        this.relayout(false);
    }

    public setOrder(order: BurstOrder): void {
        this.order = order;
        this.relayout(false);
    }

    public setMode(mode: BurstMode): void {
        this.mode = mode;
        this.relayout(false);
    }

    public setFilter(filter: ((item: BurstItem) => boolean) | null): void {
        this.filter = filter;
        this.relayout(false);
    }

    public setSway(sway: boolean): void {
        this.sway = sway;
        this.redraw();
    }

    public setOutcomes(outcomes: Partial<BurstOutcomes>): void {
        this.outcomes = {
            positive: {...this.outcomes.positive, ...outcomes.positive},
            negative: {...this.outcomes.negative, ...outcomes.negative}
        };
        this.redraw();
    }

    /** Emphasise these items (null = none). */
    public highlight(ids: string[] | null): void {
        this.highlighted = ids === null ? null : new Set(ids);
        this.redraw();
    }

    /** Select one item (others dimmed while nothing is hovered); null clears. */
    public select(id: string | null): void {
        this.selected = id;
        this.redraw();
    }

    public getSelection(): string | null {
        return this.selected;
    }

    /** Items that pass the filter, in their drawn order (top half right → left, then bottom half). */
    public getVisible(): BurstItem[] {
        return [...this.strands.values()].filter((s) => s.visible)
            .sort((a, b) => a.target.angle - b.target.angle).map((s) => ({...s.item}));
    }

    public override destroy(): void {
        this.canvas.removeEventListener('pointermove', this.onMove);
        this.canvas.removeEventListener('pointerleave', this.onLeave);
        this.canvas.removeEventListener('click', this.onClick);
        super.destroy();
    }

    /** Lift of the majority outcome against its base rate. */
    public static defaultLift(probability: number, baseRate: number): number {
        return probability >= 0.5
            ? probability / Math.max(1e-9, baseRate)
            : (1 - probability) / Math.max(1e-9, 1 - baseRate);
    }

    // ---- layout -------------------------------------------------------------------------------------------------

    private relayout(newItems: boolean): void {
        const all = this.items.map((it) => ({...it, lift: this.strands.get(it.id)!.lift}));
        const shown = all.filter((it) => this.filter === null || this.filter(it));
        const shownIds = new Set(shown.map((i) => i.id));
        const {slots, groups} = L.slots(shown, this.order, this.mode);

        this.scaleNow = L.scale(all.map((it) => L.metric(it, this.length)), this.length);
        this.groups = groups;

        for (const it of all) {
            const s = this.strands.get(it.id)!;
            s.visible = shownIds.has(it.id);
            s.target.split = it.probability;
            if (!s.visible) {
                s.target.frac = 0;
                s.target.alpha = 0;
            }
        }
        for (const slot of slots) {
            const s = this.strands.get(slot.id)!;
            const fresh = s.now.alpha === 0 && s.now.frac === 0;

            s.target.angle = slot.angle;
            s.slot = slot.width;
            s.target.frac = L.frac(this.scaleNow, L.metric({...s.item, lift: s.lift}, this.length));
            s.target.alpha = 1;
            if (fresh) {
                // grow out where it will stand, staggered round the circle on first data
                s.now.angle = slot.angle;
                s.now.split = s.item.probability;
                s.start = newItems ? -(Math.abs(slot.angle) / Math.PI) : 0;
            }
        }
        this.born = -1;
        this.redraw();
    }

    private radiusOf(frac: number): number {
        const {R, r0} = this.geo;
        const base = r0 * 0.9;

        return base + (0.05 + 0.95 * frac) * (R - 12 - base);
    }

    // ---- drawing ------------------------------------------------------------------------------------------------

    protected draw(ctx: CanvasRenderingContext2D, timeMs: number): boolean {
        const dt = this.lastTime < 0 ? 16 : Math.min(100, timeMs - this.lastTime);
        this.lastTime = timeMs;
        if (this.born < 0) {
            this.born = timeMs;
        }

        const moving = this.step(dt, timeMs);
        this.measure();
        this.drawGuides(ctx);
        this.drawStrands(ctx, timeMs);
        this.drawLabels(ctx);
        if (this.hover !== null && this.hover.visible) {
            this.drawTooltip(ctx, this.hover);
        }

        if (!moving && !this.sway) {
            this.lastTime = -1;
        }

        return moving || this.sway;
    }

    /** Ease every strand towards its target; true while anything still moves. */
    private step(dt: number, timeMs: number): boolean {
        const k = 1 - Math.exp(-dt / 150);
        let moving = false;

        for (const [id, s] of this.strands) {
            // staggered entry: start < 0 = fraction of 0.45 s after the data arrived
            if (s.start < 0) {
                if (timeMs - this.born < -s.start * 450) {
                    moving = true;
                    continue;
                }
                s.start = 0;
            }
            const n = s.now, t = s.target;
            for (const key of ['angle', 'frac', 'alpha', 'split'] as const) {
                const d = t[key] - n[key];
                if (Math.abs(d) > 1e-4) {
                    n[key] += d * k;
                    moving = true;
                } else {
                    n[key] = t[key];
                }
            }
            if (!s.visible && n.alpha < 0.01 && !this.items.some((i) => i.id === id)) {
                this.strands.delete(id);
            }
        }

        return moving;
    }

    private measure(): void {
        const side = this.mode === 'group' ? 120 : this.sideLabels ? 150 : 24;
        const top = this.mode === 'group' ? 54 : 46;
        const R = Math.max(40, Math.min(this.width / 2 - side, this.height / 2 - top));

        this.geo = {cx: this.width / 2, cy: this.height / 2, R, r0: Math.max(9, R * 0.065)};
    }

    private drawGuides(ctx: CanvasRenderingContext2D): void {
        const {cx, cy, R} = this.geo;
        const theme = this.theme;
        const sc = this.scaleNow;

        ctx.save();
        ctx.strokeStyle = theme.axis;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        for (const v of sc.ticks) {
            ctx.moveTo(cx + this.radiusOf(L.frac(sc, v)), cy);
            ctx.arc(cx, cy, this.radiusOf(L.frac(sc, v)), 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // the axis to the right: where both sides start
        ctx.strokeStyle = theme.axis;
        ctx.beginPath();
        ctx.moveTo(cx, Math.round(cy) + 0.5);
        ctx.lineTo(cx + R + 8, Math.round(cy) + 0.5);
        ctx.stroke();

        ctx.font = `11px ${ChartSurface.FONT_FAMILY}`;
        ctx.fillStyle = theme.text;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        const fmt = (v: number): string => sc.kind === 'count' ? L.formatCount(v)
            : sc.kind === 'probability' ? `${Math.round(v * 100)} %` : `${Number(v.toFixed(2))}×`;
        for (const v of [...sc.ticks, sc.max]) {
            const r = v === sc.max ? R : this.radiusOf(L.frac(sc, v));
            ctx.fillText(fmt(v), cx + r + 3, cy + 3);
        }
        ctx.restore();
    }

    private focusOf(s: Strand): number {
        const focus = this.hover ?? (this.selected !== null ? this.strands.get(this.selected) ?? null : null);

        if (focus !== null) {
            return s === focus ? 1 : s.item.group === focus.item.group ? 0.42 : 0.14;
        }
        if (this.highlighted !== null) {
            return this.highlighted.has(s.item.id) ? 1 : 0.16;
        }

        return 1;
    }

    private drawStrands(ctx: CanvasRenderingContext2D, timeMs: number): void {
        const {cx, cy, r0} = this.geo;
        const pos = this.outcomes.positive.color, neg = this.outcomes.negative.color;
        const start = r0 * 0.55;
        const list = [...this.strands.values()].filter((s) => s.now.alpha > 0.005);
        const focus = this.hover ?? (this.selected !== null ? this.strands.get(this.selected) ?? null : null);

        // dimmed ones first, the focused one last
        list.sort((a, b) => this.focusOf(a) - this.focusOf(b) || (a === focus ? 1 : b === focus ? -1 : 0));

        ctx.save();
        for (const s of list) {
            const n = s.now;
            const r1 = this.radiusOf(n.frac);
            const sway = this.sway ? timeMs * 0.0007 * (0.6 + s.seed) : 0;
            const swirl = 0.045 + 0.025 * (s.seed - 0.5);
            const wave = 0.04 * (s.seed2 - 0.5) + (this.sway ? 0.012 * Math.sin(sway) : 0);
            const line = L.strand(cx, cy, n.angle, start, r1, swirl, wave, s.seed * Math.PI * 2 + sway * 0.5, 22);
            const f = this.focusOf(s);
            // as wide as its slot allows where it is widest (a bit past the middle), so neighbours keep a gap
            const room = s.slot * (start + 0.6 * (r1 - start)) * 0.5;
            const width = Math.max(1.1, Math.min(4.5, room)) * (s === focus ? 1.5 : 1);

            s.line = line;
            const tipX = line[line.length - 2]!, tipY = line[line.length - 1]!;
            const g = ctx.createLinearGradient(line[0]!, line[1]!, tipX, tipY);
            for (const st of L.stops(n.split)) {
                g.addColorStop(st.at, st.positive ? pos : neg);
            }

            ctx.globalAlpha = n.alpha * f;
            ctx.fillStyle = g;
            const poly = L.ribbon(line, width);
            ctx.beginPath();
            ctx.moveTo(poly[0]!, poly[1]!);
            for (let i = 2; i < poly.length; i += 2) {
                ctx.lineTo(poly[i]!, poly[i + 1]!);
            }
            ctx.closePath();
            ctx.fill();

            // the dot just past the tip, in the majority colour
            const ex = tipX - line[line.length - 4]!, ey = tipY - line[line.length - 3]!;
            const el = Math.hypot(ex, ey) || 1;
            const dx = tipX + ex / el * 7, dy = tipY + ey / el * 7;
            s.dot = [dx, dy];
            ctx.fillStyle = s.item.probability >= 0.5 ? pos : neg;
            ctx.beginPath();
            ctx.arc(dx, dy, s === focus ? 3.6 : 2.3, 0, Math.PI * 2);
            ctx.fill();
            if (s === focus) {
                ctx.globalAlpha = n.alpha;
                ctx.strokeStyle = this.theme.select;
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }
        }
        ctx.restore();

        // the hub covers where everything starts
        ctx.save();
        ctx.fillStyle = Color.lerp(this.theme.background, this.theme.title, 0.1);
        ctx.strokeStyle = this.theme.axis;
        ctx.beginPath();
        ctx.arc(cx, cy, r0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    private drawLabels(ctx: CanvasRenderingContext2D): void {
        const {cx, cy, R} = this.geo;
        const theme = this.theme;
        const {positive, negative} = this.outcomes;

        ctx.save();
        ctx.font = `13px ${ChartSurface.FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = theme.title;
        const ra = R + (this.mode === 'group' ? 40 : 24);
        ctx.fillText(positive.name, cx, cy - ra);
        ctx.fillText(negative.name, cx, cy + ra);

        // arrows: the positive probability falls counter-clockwise from the right
        ctx.strokeStyle = theme.axis;
        ctx.fillStyle = theme.axis;
        ctx.lineWidth = 1;
        const w = ctx.measureText(positive.name).width / 2 + 10;
        const wb = ctx.measureText(negative.name).width / 2 + 10;
        const off = (px: number): number => Math.asin(Math.min(0.9, px / ra));
        const arcs: Array<[number, number]> = [
            // top: drawn from the right end towards the left (screen)
            [-Math.PI / 2 + off(w) + 0.32, -Math.PI / 2 + off(w)],
            [-Math.PI / 2 - off(w), -Math.PI / 2 - off(w) - 0.32],
            // bottom: from the left towards the right
            [Math.PI / 2 + off(wb) + 0.32, Math.PI / 2 + off(wb)],
            [Math.PI / 2 - off(wb), Math.PI / 2 - off(wb) - 0.32]
        ];
        for (const [a, b] of arcs) {
            ctx.beginPath();
            ctx.arc(cx, cy, ra, a, b, b < a);
            ctx.stroke();
            // head at b, pointing along the travel direction
            const hx = cx + Math.cos(b) * ra, hy = cy + Math.sin(b) * ra;
            const dir = b < a ? -1 : 1;
            const tx = -Math.sin(b) * dir, ty = Math.cos(b) * dir;
            ctx.beginPath();
            ctx.moveTo(hx + tx * 2, hy + ty * 2);
            ctx.lineTo(hx - tx * 6 - ty * 3.5, hy - ty * 6 + tx * 3.5);
            ctx.lineTo(hx - tx * 6 + ty * 3.5, hy - ty * 6 - tx * 3.5);
            ctx.closePath();
            ctx.fill();
        }

        if (this.mode === 'group') {
            this.drawGroups(ctx);
        } else if (this.sideLabels && this.order === 'probability') {
            this.drawSideLabels(ctx);
        }
        ctx.restore();
    }

    private drawSideLabels(ctx: CanvasRenderingContext2D): void {
        const {cx, cy, R} = this.geo;
        const shown = [...this.strands.values()].filter((s) => s.visible);
        const sides = [0, 1].map((side) => shown.filter((s) => L.side(s.item.probability) === side)
            .map((s) => L.confidence(s.item.probability)));
        const names = [this.outcomes.positive.name, this.outcomes.negative.name];

        ctx.font = `12px ${ChartSurface.FONT_FAMILY}`;
        ctx.fillStyle = this.theme.text;
        ctx.textBaseline = 'middle';
        sides.forEach((vals, side) => {
            if (vals.length === 0) {
                return;
            }
            const y = cy + (side === 0 ? -9 : 9);
            const hi = Math.round(Math.max(...vals) * 100), lo = Math.round(Math.min(...vals) * 100);
            ctx.textAlign = 'left';
            ctx.fillText(`${hi} % ${names[side]}`, cx + R + 44, y);
            ctx.textAlign = 'right';
            ctx.fillText(`${lo} % ${names[side]}`, cx - R - 14, y);
        });
    }

    private drawGroups(ctx: CanvasRenderingContext2D): void {
        const {cx, cy, R} = this.geo;
        const ra = R + 8;
        const focusGroup = (this.hover ?? (this.selected !== null ? this.strands.get(this.selected) : undefined))?.item.group;

        ctx.font = `11px ${ChartSurface.FONT_FAMILY}`;
        ctx.textBaseline = 'middle';
        for (const g of this.groups) {
            const a = Math.min(g.from, g.to), b = Math.max(g.from, g.to);
            const lit = focusGroup === g.group;
            ctx.strokeStyle = lit ? this.theme.title : this.theme.axis;
            ctx.lineWidth = lit ? 2 : 1.2;
            ctx.beginPath();
            ctx.arc(cx, cy, ra, a + 0.004, b - 0.004);
            ctx.stroke();

            const mid = (a + b) / 2;
            const c = Math.cos(mid), s = Math.sin(mid);
            // only label sectors wide enough for a line of text
            if ((b - a) * ra < 11 && !lit) {
                continue;
            }
            ctx.fillStyle = lit ? this.theme.title : this.theme.text;
            ctx.textAlign = c > 0.15 ? 'left' : c < -0.15 ? 'right' : 'center';
            const text = g.group.length > 22 ? `${g.group.slice(0, 21)}…` : g.group;
            ctx.fillText(text, cx + c * (ra + 8), cy + s * (ra + 8) + (Math.abs(c) <= 0.15 ? Math.sign(s) * 5 : 0));
        }
    }

    private drawTooltip(ctx: CanvasRenderingContext2D, s: Strand): void {
        const it = s.item;
        const p = it.probability;
        const major = p >= 0.5 ? this.outcomes.positive : this.outcomes.negative;
        const lines = [
            `${it.group}: ${it.label}`,
            `${it.count.toLocaleString()} ${this.unit}`,
            `${Math.round(p * 100)} % ${this.outcomes.positive.name} · ${Math.round((1 - p) * 100)} % ${this.outcomes.negative.name}`,
            `lift ${s.lift.toFixed(2)} (${major.name})`
        ];
        const at = this.pointer ?? {x: s.dot[0], y: s.dot[1]};

        ctx.save();
        ctx.font = `12px ${ChartSurface.FONT_FAMILY}`;
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 22;
        const h = lines.length * 16 + 12;
        const x = Math.max(4, Math.min(this.width - w - 4, at.x + 14));
        const y = Math.max(4, Math.min(this.height - h - 4, at.y + 14));

        ctx.globalAlpha = 1;
        ctx.fillStyle = Color.withAlpha(this.theme.background, 0.94);
        ctx.strokeStyle = major.color;
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
        // probability bar
        const bx = x + 10, bw = w - 20, by = y + h - 4;
        ctx.fillStyle = this.outcomes.negative.color;
        ctx.fillRect(bx, by - 2, bw, 2);
        ctx.fillStyle = this.outcomes.positive.color;
        ctx.fillRect(bx, by - 2, bw * p, 2);
        ctx.restore();
    }

    // ---- input --------------------------------------------------------------------------------------------------

    private pick(x: number, y: number): Strand | null {
        const {cx, cy, R, r0} = this.geo;
        const d = Math.hypot(x - cx, y - cy);

        if (d < r0 || d > R + 16) {
            return null;
        }

        let best: Strand | null = null, bd = 6;

        for (const s of this.strands.values()) {
            if (!s.visible || s.line.length < 4) {
                continue;
            }
            const dist = Math.min(L.distanceToPath(x, y, s.line), Math.hypot(x - s.dot[0], y - s.dot[1]) - 1);
            if (dist < bd) {
                bd = dist;
                best = s;
            }
        }

        return best;
    }

    private info(s: Strand | null): BurstHover | null {
        return s === null ? null : {item: {...s.item}, lift: s.lift, majority: s.item.probability >= 0.5 ? 'positive' : 'negative'};
    }

    private readonly onMove = (e: PointerEvent): void => {
        this.pointer = this.local(e);
        const hit = this.pick(this.pointer.x, this.pointer.y);

        this.canvas.style.cursor = hit !== null ? 'pointer' : 'default';
        if (hit !== this.hover) {
            this.hover = hit;
            this.events.emit('hover', this.info(hit));
        }
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

    private readonly onClick = (e: MouseEvent): void => {
        const p = this.local(e);
        const hit = this.pick(p.x, p.y);

        this.selected = hit === null || hit.item.id === this.selected ? null : hit.item.id;
        this.events.emit('click', this.info(hit === null || this.selected === null ? null : hit));
        this.redraw();
    };

}
