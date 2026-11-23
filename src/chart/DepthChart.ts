import { Color } from '../util/Color';
import { ChartRange, ChartRect, ChartScale } from './ChartScale';
import { CHART_FONT, ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { DepthBook, DepthLayout, DepthLevel, DepthOrder } from './DepthLayout';

export interface DepthChartOptions {
    /** Buy orders (price, quantity); equal prices are merged. */
    bids?: DepthOrder[];
    /** Sell orders. */
    asks?: DepthOrder[];
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
    title?: string;
    bidColor?: string;
    askColor?: string;
    /** 'linear' (default) or 'log' quantities. */
    scale?: 'linear' | 'log';
    /** Staircase (default, exact) or straight lines between price levels. */
    step?: boolean;
    /** Shown prices: a fixed range, or a share of the mid price on each side (e.g. 0.5 = mid ± 50 %); default all orders. */
    window?: ChartRange | number;
    /** Price text (default: 2 decimals). */
    format?: (price: number) => string;
    /** Quantity text (default: thousands separated). */
    quantityFormat?: (quantity: number) => string;
    /** Tooltip texts (defaults: '<n> buy orders at <price> or higher' / '<n> sell orders at <price> or lower'). */
    bidText?: (quantity: string, price: string) => string;
    askText?: (quantity: string, price: string) => string;
    /** Spread label between the sides (default true). */
    spread?: boolean;
    /** Wheel zoom on prices, drag pan, double-click reset (default true). */
    zoom?: boolean;
}

export interface DepthChartEvents extends Record<string, unknown> {
    /** Side and depth under the pointer, or null (also null in the spread). */
    hover: {side: 'bid' | 'ask'; price: number; quantity: number} | null;
    rangeChange: ChartRange;
}

/**
 * Market depth chart: cumulative buy orders falling away to the left of the
 * spread, sell orders rising to the right, each as a filled staircase; a
 * crosshair tells "n buy orders at p or higher". Linear or log quantities,
 * price zoom/pan, the quantity axis eases when the book changes (live).
 * Canvas, zero dependencies.
 */
export class DepthChart extends ChartSurface<DepthChartEvents> {

    private book: DepthBook = DepthLayout.book([], []);
    private title: string;
    private readonly bidColor: string;
    private readonly askColor: string;
    private scale: 'linear' | 'log';
    private step: boolean;
    private window: ChartRange | number | null;
    private readonly format: (p: number) => string;
    private readonly quantityFormat: (q: number) => string;
    private readonly bidText: (q: string, p: string) => string;
    private readonly askText: (q: string, p: string) => string;
    private readonly spreadOn: boolean;
    private readonly zoomOn: boolean;
    private view: ChartRange | null = null;
    private yMax: number | null = null;
    private plot: ChartRect = {x: 0, y: 0, w: 1, h: 1};
    private hoverX: number | null = null;
    private press: {x: number; view: ChartRange} | null = null;

    public constructor(container: HTMLElement, options: DepthChartOptions = {}) {
        super(container, options.theme);
        this.title = options.title ?? '';
        this.bidColor = options.bidColor ?? '#6c93d6';
        this.askColor = options.askColor ?? '#a4d007';
        this.scale = options.scale ?? 'linear';
        this.step = options.step ?? true;
        this.window = options.window ?? null;
        this.format = options.format ?? ((p) => p.toFixed(2));
        this.quantityFormat = options.quantityFormat ?? ((q) => Math.round(q).toLocaleString('en-US'));
        this.bidText = options.bidText ?? ((q, p) => `${q} buy orders at ${p} or higher`);
        this.askText = options.askText ?? ((q, p) => `${q} sell orders at ${p} or lower`);
        this.spreadOn = options.spread ?? true;
        this.zoomOn = options.zoom ?? true;
        this.canvas.addEventListener('pointerdown', this.onDown);
        this.canvas.addEventListener('pointermove', this.onMove);
        this.canvas.addEventListener('pointerup', this.onUp);
        this.canvas.addEventListener('pointerleave', this.onLeave);
        this.canvas.addEventListener('wheel', this.onWheel, {passive: false});
        this.canvas.addEventListener('dblclick', this.onDblClick);
        this.setOrders(options.bids ?? [], options.asks ?? []);
    }

    /** New book (live updates keep the zoom; the quantity axis eases). */
    public setOrders(bids: DepthOrder[], asks: DepthOrder[]): void {
        this.book = DepthLayout.book(bids, asks);
        this.redraw();
    }

    public getBook(): DepthBook {
        return this.book;
    }

    public setScale(scale: 'linear' | 'log'): void {
        this.scale = scale;
        this.yMax = null;
        this.redraw();
    }

    public setStep(step: boolean): void {
        this.step = step;
        this.redraw();
    }

    public setWindow(window: ChartRange | number | null): void {
        this.window = window;
        this.view = null;
        this.redraw();
    }

    public setTitle(title: string): void {
        this.title = title;
        this.redraw();
    }

    public setRange(range: ChartRange | null): void {
        this.view = range;
        this.events.emit('rangeChange', this.priceRange());
        this.redraw();
    }

    public override destroy(): void {
        this.canvas.removeEventListener('pointerdown', this.onDown);
        this.canvas.removeEventListener('pointermove', this.onMove);
        this.canvas.removeEventListener('pointerup', this.onUp);
        this.canvas.removeEventListener('pointerleave', this.onLeave);
        this.canvas.removeEventListener('wheel', this.onWheel);
        this.canvas.removeEventListener('dblclick', this.onDblClick);
        super.destroy();
    }

    /** Prices of all orders (or the window). */
    private fullRange(): ChartRange {
        const b = this.book;
        const w = this.window;

        if (w !== null && typeof w === 'object') {
            return w;
        }
        if (typeof w === 'number' && b.mid !== null) {
            return {min: Math.max(0, b.mid * (1 - w)), max: b.mid * (1 + w)};
        }

        const lo = b.bids[b.bids.length - 1]?.price ?? b.asks[0]?.price ?? 0;
        const hi = b.asks[b.asks.length - 1]?.price ?? b.bids[0]?.price ?? 1;

        return hi > lo ? {min: lo, max: hi} : {min: lo - 1, max: hi + 1};
    }

    private priceRange(): ChartRange {
        return this.view ?? this.fullRange();
    }

    private qy(q: number): number {
        return this.scale === 'log' ? Math.log10(1 + Math.max(0, q)) : q;
    }

    private sy(q: number): number {
        const p = this.plot;

        return p.y + p.h - this.qy(q) / this.qy(this.yMax ?? 1) * p.h;
    }

    private sx(price: number, range: ChartRange): number {
        return ChartScale.toPx(price, range, this.plot.x, this.plot.x + this.plot.w);
    }

    protected draw(ctx: CanvasRenderingContext2D): boolean {
        const theme = this.theme;
        const range = this.priceRange();
        const b = this.book;
        // largest depth inside the shown prices
        const visible = Math.max(
            DepthLayout.depthAt(b.bids, range.min, 'bid'),
            DepthLayout.depthAt(b.asks, range.max, 'ask'),
            1
        );
        const ticks = this.scale === 'log'
            ? this.logTicks(visible)
            : ChartScale.ticks({min: 0, max: visible * 1.08}, Math.max(2, Math.floor(this.height / 30)));
        const target = this.scale === 'log' ? Math.max(visible, ticks[ticks.length - 1] ?? 1) : Math.max(visible * 1.08, ticks[ticks.length - 1] ?? 1);
        let moving = false;

        if (this.yMax === null) {
            this.yMax = target;
        } else if (Math.abs(this.yMax - target) > target * 0.003) {
            this.yMax += (target - this.yMax) * 0.22;
            moving = true;
        } else {
            this.yMax = target;
        }

        ctx.font = CHART_FONT;

        const shown = ticks.filter((v) => v <= this.yMax! * 1.0001);
        const left = Math.ceil(Math.max(...shown.map((v) => ctx.measureText(this.quantityFormat(v)).width), 10)) + 14;
        const top = 10 + (this.title !== '' ? 22 : 0);

        this.plot = {x: left, y: top, w: Math.max(10, this.width - left - 14), h: Math.max(10, this.height - top - 26)};

        const p = this.plot;

        if (this.title !== '') {
            ctx.fillStyle = theme.title;
            ctx.font = '13px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(this.title, 4, 6);
        }

        // grid + axes
        const xTicks = ChartScale.ticks(range, Math.max(2, Math.floor(p.w / 70)));

        ctx.strokeStyle = theme.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const v of shown) {
            const y = Math.round(this.sy(v)) + 0.5;
            ctx.moveTo(p.x, y);
            ctx.lineTo(p.x + p.w, y);
        }
        for (const v of xTicks) {
            const x = Math.round(this.sx(v, range)) + 0.5;
            ctx.moveTo(x, p.y);
            ctx.lineTo(x, p.y + p.h);
        }
        ctx.stroke();
        ctx.strokeStyle = theme.axis;
        ctx.strokeRect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, Math.round(p.w), Math.round(p.h));

        ctx.save();
        ctx.beginPath();
        ctx.rect(p.x, p.y, p.w, p.h);
        ctx.clip();
        this.drawSide(ctx, b.bids, 'bid', range);
        this.drawSide(ctx, b.asks, 'ask', range);
        this.drawSpread(ctx, range);
        ctx.restore();

        ctx.fillStyle = theme.text;
        ctx.font = CHART_FONT;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (const v of shown) {
            ctx.fillText(this.quantityFormat(v), p.x - 8, this.sy(v));
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const v of xTicks) {
            ctx.fillText(this.format(v), this.sx(v, range), p.y + p.h + 7);
        }

        this.drawHover(ctx, range);

        return moving;
    }

    private logTicks(max: number): number[] {
        const out = [0];

        for (let v = 1; v <= max * 10 && out.length < 12; v *= 10) {
            out.push(v);
        }

        return out;
    }

    private drawSide(ctx: CanvasRenderingContext2D, levels: DepthLevel[], side: 'bid' | 'ask', range: ChartRange): void {
        if (levels.length === 0) {
            return;
        }

        const color = side === 'bid' ? this.bidColor : this.askColor;
        const edge = side === 'bid' ? Math.min(range.min, levels[levels.length - 1]!.price) : Math.max(range.max, levels[levels.length - 1]!.price);
        const line = new Path2D();
        const first = levels[0]!;
        const base = this.sy(0);

        line.moveTo(this.sx(first.price, range), base);
        if (this.step) {
            levels.forEach((l, i) => {
                const x = this.sx(l.price, range);
                const prev = i === 0 ? 0 : levels[i - 1]!.cumulative;

                line.lineTo(x, this.sy(prev));
                line.lineTo(x, this.sy(l.cumulative));
            });
        } else {
            for (const l of levels) {
                line.lineTo(this.sx(l.price, range), this.sy(l.cumulative));
            }
        }
        line.lineTo(this.sx(edge, range), this.sy(levels[levels.length - 1]!.cumulative));

        const area = new Path2D(line);

        area.lineTo(this.sx(edge, range), base);
        area.closePath();

        const g = ctx.createLinearGradient(0, this.plot.y, 0, this.plot.y + this.plot.h);

        g.addColorStop(0, Color.withAlpha(color, 0.38));
        g.addColorStop(1, Color.withAlpha(color, 0.12));
        ctx.fillStyle = g;
        ctx.fill(area);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke(line);
    }

    private drawSpread(ctx: CanvasRenderingContext2D, range: ChartRange): void {
        const b = this.book;

        if (!this.spreadOn || b.bestBid === null || b.bestAsk === null || b.mid === null) {
            return;
        }

        const x = Math.round(this.sx(b.mid, range)) + 0.5;
        const p = this.plot;
        const pct = b.mid > 0 && b.spread !== null ? ` (${(b.spread / b.mid * 100).toFixed(1)}%)` : '';
        const text = `spread ${this.format(b.spread ?? 0)}${pct}`;

        ctx.strokeStyle = Color.withAlpha(this.theme.text, 0.6);
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(x, p.y);
        ctx.lineTo(x, p.y + p.h);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = this.theme.text;
        ctx.font = CHART_FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(text, x, p.y + 6);
    }

    /** What the pointer x means: side, the level that sets the depth there, and the depth. */
    private probe(price: number): {side: 'bid' | 'ask'; price: number; quantity: number} | null {
        const b = this.book;

        if (b.bestBid !== null && price <= b.bestBid) {
            let level = b.bids[0]!;
            for (const l of b.bids) {
                if (l.price >= price) {
                    level = l;
                } else {
                    break;
                }
            }
            return {side: 'bid', price: level.price, quantity: level.cumulative};
        }
        if (b.bestAsk !== null && price >= b.bestAsk) {
            let level = b.asks[0]!;
            for (const l of b.asks) {
                if (l.price <= price) {
                    level = l;
                } else {
                    break;
                }
            }
            return {side: 'ask', price: level.price, quantity: level.cumulative};
        }

        return null;
    }

    private drawHover(ctx: CanvasRenderingContext2D, range: ChartRange): void {
        const px = this.hoverX;

        if (px === null) {
            return;
        }

        const hit = this.probe(ChartScale.fromPx(px, range, this.plot.x, this.plot.x + this.plot.w));

        if (hit === null) {
            return;
        }

        const p = this.plot;
        const y = this.sy(hit.quantity);
        const color = hit.side === 'bid' ? this.bidColor : this.askColor;
        const theme = this.theme;

        ctx.save();
        ctx.strokeStyle = Color.withAlpha(theme.select, 0.45);
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(px) + 0.5, p.y);
        ctx.lineTo(Math.round(px) + 0.5, p.y + p.h);
        ctx.moveTo(p.x, Math.round(y) + 0.5);
        ctx.lineTo(p.x + p.w, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(px, y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = theme.background;
        ctx.stroke();

        const q = this.quantityFormat(hit.quantity);
        const pr = this.format(hit.price);
        const text = hit.side === 'bid' ? this.bidText(q, pr) : this.askText(q, pr);

        ctx.font = `600 ${CHART_FONT}`;

        const w = ctx.measureText(text).width + 18;
        const tx = px + 12 + w > p.x + p.w ? px - 12 - w : px + 12;
        const ty = Math.max(p.y + 4, Math.min(p.y + p.h - 26, y - 30));

        ctx.beginPath();
        ctx.roundRect(tx, ty, w, 22, 4);
        ctx.fillStyle = Color.withAlpha(theme.background, 0.94);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = theme.title;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, tx + 9, ty + 11.5);
        ctx.restore();
    }

    private inPlot(x: number, y: number): boolean {
        const p = this.plot;

        return x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
    }

    private readonly onDown = (e: PointerEvent): void => {
        const pt = this.local(e);

        if (!this.zoomOn || e.button !== 0 || !this.inPlot(pt.x, pt.y)) {
            return;
        }
        this.press = {x: pt.x, view: this.priceRange()};
        this.canvas.setPointerCapture(e.pointerId);
    };

    private readonly onMove = (e: PointerEvent): void => {
        const pt = this.local(e);

        if (this.press !== null) {
            const span = this.press.view.max - this.press.view.min;
            const moved = ChartScale.pan(this.press.view, -(pt.x - this.press.x) / this.plot.w * span);
            this.view = moved;
            this.hoverX = null;
            this.events.emit('rangeChange', moved);
            this.redraw();
            return;
        }

        const inside = this.inPlot(pt.x, pt.y);
        const before = this.hoverX;

        this.hoverX = inside ? pt.x : null;
        if (inside || before !== null) {
            const range = this.priceRange();
            this.events.emit('hover', inside ? this.probe(ChartScale.fromPx(pt.x, range, this.plot.x, this.plot.x + this.plot.w)) : null);
            this.redraw();
        }
    };

    private readonly onUp = (e: PointerEvent): void => {
        if (this.canvas.hasPointerCapture(e.pointerId)) {
            this.canvas.releasePointerCapture(e.pointerId);
        }
        this.press = null;
    };

    private readonly onLeave = (): void => {
        if (this.hoverX !== null) {
            this.hoverX = null;
            this.events.emit('hover', null);
            this.redraw();
        }
    };

    private readonly onWheel = (e: WheelEvent): void => {
        const pt = this.local(e);

        if (!this.zoomOn || !this.inPlot(pt.x, pt.y)) {
            return;
        }
        e.preventDefault();

        const range = this.priceRange();
        const at = ChartScale.fromPx(pt.x, range, this.plot.x, this.plot.x + this.plot.w);
        const full = this.fullRange();

        this.view = ChartScale.zoom(range, at, Math.exp(e.deltaY * 0.0015), full, (full.max - full.min) / 200);
        this.events.emit('rangeChange', this.view);
        this.redraw();
    };

    private readonly onDblClick = (): void => {
        this.setRange(null);
    };

}
