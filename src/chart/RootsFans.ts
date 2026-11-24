import { Color } from '../util/Color';
import { ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { RootsActor, RootsCategory } from './RootsChart';
import { RootsLayout as L } from './RootsLayout';

export interface RootsFansOptions {
    categories?: RootsCategory[];
    actors?: RootsActor[];
    /** Which categories get a fan (default all), in this order; an entry may join several ids. */
    fans?: Array<string | {ids: string[]; label?: string}>;
    from?: number;
    to?: number;
    /** Year at the bottom of every fan (default the middle of from…to): stretches the side that has more going on. */
    split?: number;
    /** Show only actors up to this year (null = all). */
    time?: number | null;
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
}

export interface RootsFansEvents extends Record<string, unknown> {
    /** The hovered fan's category ids (null = none). */
    hover: string[] | null;
    click: string[] | null;
}

interface Fan {
    ids: string[];
    label: string;
    color: string;
    years: number[];
}

/**
 * Small multiples for `RootsChart`: per category one dial over the time
 * axis — the earliest year just left of the top, counter-clockwise down to
 * `split` at the bottom and up the right side to the latest — with a ray
 * for every actor, so you see when a discipline joined in.
 */
export class RootsFans extends ChartSurface<RootsFansEvents> {

    private categories: RootsCategory[];
    private actors: RootsActor[];
    private fanSpec: RootsFansOptions['fans'];
    private fans: Fan[] = [];
    private from: number;
    private to: number;
    private split: number;
    private time: number | null;
    private hover = -1;
    private focusIds: Set<string> | null = null;
    private cells: Array<{cx: number; cy: number; r: number}> = [];

    public constructor(container: HTMLElement, options: RootsFansOptions = {}) {
        super(container, options.theme ?? 'dark');
        this.categories = (options.categories ?? []).map((c) => ({...c}));
        this.actors = RootsFans.copyActors(options.actors ?? []);
        this.fanSpec = options.fans?.map((f) => (typeof f === 'string' ? f : {...f, ids: f.ids.slice()}));
        const ys = this.actors.map((a) => a.year);
        this.from = options.from ?? (ys.length > 0 ? Math.floor(Math.min(...ys) / 10) * 10 : 0);
        this.to = options.to ?? (ys.length > 0 ? Math.ceil((Math.max(...ys) + 1) / 10) * 10 : 10);
        this.split = options.split ?? (this.from + this.to) / 2;
        this.time = options.time ?? null;
        this.build();

        this.canvas.addEventListener('pointermove', this.onMove);
        this.canvas.addEventListener('pointerleave', this.onLeave);
        this.canvas.addEventListener('click', this.onClick);
    }

    public setData(actors: RootsActor[], categories?: RootsCategory[]): void {
        this.actors = RootsFans.copyActors(actors);
        if (categories !== undefined) {
            this.categories = categories.map((c) => ({...c}));
        }
        this.build();
        this.redraw();
    }

    public setTime(year: number | null): void {
        this.time = year;
        this.redraw();
    }

    /** Emphasise the fans of these category ids (null = none). */
    public focus(ids: string[] | null): void {
        this.focusIds = ids === null ? null : new Set(ids);
        this.redraw();
    }

    public override destroy(): void {
        this.canvas.removeEventListener('pointermove', this.onMove);
        this.canvas.removeEventListener('pointerleave', this.onLeave);
        this.canvas.removeEventListener('click', this.onClick);
        super.destroy();
    }

    private static copyActors(actors: readonly RootsActor[]): RootsActor[] {
        return actors.map((a) => ({...a, categories: a.categories.slice()}));
    }

    private build(): void {
        const spec = this.fanSpec ?? this.categories.map((c) => c.id);

        this.fans = spec.map((s) => {
            const ids = typeof s === 'string' ? [s] : s.ids;
            const cats = ids.map((id) => this.categories.find((c) => c.id === id)).filter((c): c is RootsCategory => c !== undefined);
            const label = typeof s !== 'string' && s.label !== undefined ? s.label : cats.map((c) => c.name).join(', ');

            return {
                ids, label, color: cats[0]?.color ?? this.theme.line,
                years: this.actors.filter((a) => a.categories.some((c) => ids.includes(c))).map((a) => a.year)
            };
        });
    }

    protected draw(ctx: CanvasRenderingContext2D): boolean {
        const n = Math.max(1, this.fans.length);
        const labelH = 30;
        // as many per row as keep each dial at least 110 px
        const perRow = Math.max(1, Math.min(n, Math.floor(this.width / 110)));
        const rows = Math.ceil(n / perRow);
        const cw = this.width / perRow, ch = this.height / rows;
        const r = Math.max(12, Math.min(cw / 2 - 18, (ch - labelH) / 2 - 12));
        const ticks = this.tickYears();

        this.cells = [];
        this.fans.forEach((fan, i) => {
            const cx = (i % perRow + 0.5) * cw;
            const cy = Math.floor(i / perRow) * ch + (ch - labelH) / 2 + 4;
            const lit = this.hover === i || (this.focusIds !== null && fan.ids.some((id) => this.focusIds!.has(id)));
            const dim = (this.hover >= 0 || this.focusIds !== null) && !lit;
            this.cells.push({cx, cy, r});

            ctx.save();
            ctx.globalAlpha = dim ? 0.35 : 1;
            // year ticks round the dial
            ctx.strokeStyle = this.theme.grid;
            ctx.lineWidth = 1;
            ctx.font = `9px ${ChartSurface.FONT_FAMILY}`;
            ctx.fillStyle = this.theme.text;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const y of ticks) {
                const a = L.fanAngle(y, this.from, this.split, this.to);
                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(a) * r * 0.25, cy + Math.sin(a) * r * 0.25);
                ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
                ctx.stroke();
                if (r > 30) {
                    // first and last meet at the top: push them apart
                    ctx.textAlign = y === this.from ? 'right' : y === this.to ? 'left' : 'center';
                    ctx.fillText(String(y), cx + Math.cos(a) * (r + 11), cy + Math.sin(a) * (r + 9));
                }
            }
            // one ray per actor
            ctx.strokeStyle = fan.color;
            ctx.lineWidth = lit ? 1.6 : 1.2;
            ctx.globalAlpha = (dim ? 0.3 : 0.75);
            ctx.lineCap = 'round';
            ctx.beginPath();
            for (const y of fan.years) {
                if (this.time !== null && y > this.time) {
                    continue;
                }
                const a = L.fanAngle(y, this.from, this.split, this.to);
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            }
            ctx.stroke();
            ctx.globalAlpha = dim ? 0.35 : 1;
            ctx.fillStyle = fan.color;
            ctx.beginPath();
            ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.textAlign = 'center';
            ctx.font = `${lit ? 600 : 400} 11px ${ChartSurface.FONT_FAMILY}`;
            ctx.fillStyle = Color.lerp(fan.color, '#ffffff', 0.15);
            ctx.textBaseline = 'top';
            const label = fan.label.length > 30 ? `${fan.label.slice(0, 29)}…` : fan.label;
            ctx.fillText(label, cx, cy + r + 16, cw - 8);
            ctx.restore();
        });

        return false;
    }

    private tickYears(): number[] {
        const out = [this.from];
        const step = L.yearStep(this.to - this.from, 8);

        for (let y = Math.ceil((this.from + 1) / step) * step; y < this.to; y += step) {
            out.push(y);
        }
        out.push(this.to);

        return out;
    }

    private pick(x: number, y: number): number {
        return this.cells.findIndex((c) => Math.hypot(x - c.cx, y - c.cy) <= c.r + 20);
    }

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);
        const i = this.pick(p.x, p.y);

        this.canvas.style.cursor = i >= 0 ? 'pointer' : 'default';
        if (i !== this.hover) {
            this.hover = i;
            this.events.emit('hover', i >= 0 ? this.fans[i]!.ids : null);
            this.redraw();
        }
    };

    private readonly onLeave = (): void => {
        if (this.hover >= 0) {
            this.hover = -1;
            this.events.emit('hover', null);
            this.redraw();
        }
    };

    private readonly onClick = (e: MouseEvent): void => {
        const p = this.local(e);
        const i = this.pick(p.x, p.y);

        this.events.emit('click', i >= 0 ? this.fans[i]!.ids : null);
    };

}
