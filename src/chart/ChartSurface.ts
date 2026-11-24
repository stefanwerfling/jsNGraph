import { EventEmitter } from '../util/EventEmitter';
import { RenderLoop } from '../view/RenderLoop';
import { ChartRange, ChartRect, ChartScale } from './ChartScale';
import { ChartTheme, ChartThemeTokens } from './ChartTheme';

/**
 * Shared base of the charts: a root element with one canvas, sized to the
 * container (device-pixel sharp), an on-demand render loop and the axis
 * drawing both charts use. Subclasses draw in CSS pixels.
 */
export abstract class ChartSurface<Events extends Record<string, unknown>> {

    /** Font of axis labels and legends. */
    public static readonly FONT = '11px system-ui, -apple-system, sans-serif';

    /** Font family of the charts that size their own text. */
    public static readonly FONT_FAMILY = 'system-ui, -apple-system, sans-serif';

    protected readonly root: HTMLDivElement;
    protected readonly canvas: HTMLCanvasElement;
    protected readonly ctx: CanvasRenderingContext2D;
    protected readonly events = new EventEmitter<Events>();
    protected theme: ChartThemeTokens;
    protected width = 0;
    protected height = 0;

    private readonly loop: RenderLoop;
    private readonly resizeObserver: ResizeObserver;

    protected constructor(container: HTMLElement, theme: 'dark' | 'light' | Partial<ChartThemeTokens> | undefined) {
        this.theme = ChartTheme.resolve(theme);
        this.root = document.createElement('div');
        this.root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;touch-action:none;user-select:none';
        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block';
        this.root.appendChild(this.canvas);
        container.appendChild(this.root);

        const ctx = this.canvas.getContext('2d');

        if (ctx === null) {
            throw new Error('Chart: 2d context unavailable');
        }

        this.ctx = ctx;
        this.loop = new RenderLoop((t) => this.frame(t));
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.root);
        this.resize();
    }

    /** The chart's root element (for styling or overlays). */
    public get element(): HTMLDivElement {
        return this.root;
    }

    /** Subscribe to an event; chainable. */
    public on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): this {
        this.events.on(event, listener);

        return this;
    }

    /** Unsubscribe a listener; chainable. */
    public off<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): this {
        this.events.off(event, listener);

        return this;
    }

    public setTheme(theme: 'dark' | 'light' | Partial<ChartThemeTokens>): void {
        this.theme = ChartTheme.resolve(theme);
        this.themeChanged();
        this.redraw();
    }

    /** Ask for a frame (coalesced; nothing runs while the picture is unchanged). */
    public redraw(): void {
        this.loop.request();
    }

    public destroy(): void {
        this.resizeObserver.disconnect();
        this.loop.destroy();
        this.events.clear();
        this.root.remove();
    }

    /** Draw one frame in CSS pixels; return true to get another frame (animation). */
    protected abstract draw(ctx: CanvasRenderingContext2D, timeMs: number): boolean;

    /** Hook for subclasses with DOM overlays that follow the theme. */
    protected themeChanged(): void {
        // nothing by default
    }

    /** Pointer position relative to the chart. */
    protected local(e: MouseEvent): {x: number; y: number} {
        const r = this.root.getBoundingClientRect();

        return {x: e.clientX - r.left, y: e.clientY - r.top};
    }

    /** Tick labels and short tick marks under `rect`; with `grid`, vertical grid lines (and bands) inside it. */
    protected drawXAxis(rect: ChartRect, range: ChartRange, options: {grid?: boolean; maxTicks?: number; line?: boolean} = {}): void {
        const {ctx, theme} = this;
        const maxTicks = options.maxTicks ?? Math.max(2, Math.floor(rect.w / 90));
        const ticks = ChartScale.ticks(range, maxTicks);
        const step = ChartScale.niceStep(range.max - range.min, maxTicks);
        const bottom = rect.y + rect.h;

        ctx.save();
        if (options.grid === true) {
            if (theme.band !== '') {
                ctx.fillStyle = theme.band;
                ticks.forEach((v, i) => {
                    if (i % 2 === 0) {
                        const a = ChartScale.toPx(v, range, rect.x, rect.x + rect.w);
                        const b = ChartScale.toPx(v + step, range, rect.x, rect.x + rect.w);
                        ctx.fillRect(a, rect.y, Math.min(b, rect.x + rect.w) - a, rect.h);
                    }
                });
            }
            ctx.strokeStyle = theme.grid;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (const v of ticks) {
                const x = Math.round(ChartScale.toPx(v, range, rect.x, rect.x + rect.w)) + 0.5;
                ctx.moveTo(x, rect.y);
                ctx.lineTo(x, bottom);
            }
            ctx.stroke();
        }

        ctx.strokeStyle = theme.axis;
        ctx.beginPath();
        if (options.line !== false) {
            ctx.moveTo(rect.x, Math.round(bottom) + 0.5);
            ctx.lineTo(rect.x + rect.w, Math.round(bottom) + 0.5);
        }
        for (const v of ticks) {
            const x = Math.round(ChartScale.toPx(v, range, rect.x, rect.x + rect.w)) + 0.5;
            ctx.moveTo(x, bottom);
            ctx.lineTo(x, bottom + 4);
        }
        ctx.stroke();

        ctx.fillStyle = theme.text;
        ctx.font = ChartSurface.FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const v of ticks) {
            ctx.fillText(ChartScale.format(v, step), ChartScale.toPx(v, range, rect.x, rect.x + rect.w), bottom + 7);
        }
        ctx.restore();
    }

    /** Tick labels left of `rect`; with `grid`, horizontal grid lines inside it. */
    protected drawYAxis(rect: ChartRect, range: ChartRange,
        options: {grid?: boolean; maxTicks?: number; line?: boolean; format?: (v: number) => string} = {}): void {
        const {ctx, theme} = this;
        const maxTicks = options.maxTicks ?? Math.max(2, Math.floor(rect.h / 34));
        const ticks = ChartScale.ticks(range, maxTicks);
        const step = ChartScale.niceStep(range.max - range.min, maxTicks);

        ctx.save();
        if (options.grid === true) {
            ctx.strokeStyle = theme.grid;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (const v of ticks) {
                const y = Math.round(ChartScale.toPx(v, range, rect.y + rect.h, rect.y)) + 0.5;
                ctx.moveTo(rect.x, y);
                ctx.lineTo(rect.x + rect.w, y);
            }
            ctx.stroke();
        }

        ctx.strokeStyle = theme.axis;
        ctx.beginPath();
        if (options.line !== false) {
            ctx.moveTo(Math.round(rect.x) - 0.5, rect.y);
            ctx.lineTo(Math.round(rect.x) - 0.5, rect.y + rect.h);
        }
        for (const v of ticks) {
            const y = Math.round(ChartScale.toPx(v, range, rect.y + rect.h, rect.y)) + 0.5;
            ctx.moveTo(rect.x - 4, y);
            ctx.lineTo(rect.x, y);
        }
        ctx.stroke();

        ctx.fillStyle = theme.text;
        ctx.font = ChartSurface.FONT;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (const v of ticks) {
            ctx.fillText(options.format?.(v) ?? ChartScale.format(v, step), rect.x - 7, ChartScale.toPx(v, range, rect.y + rect.h, rect.y));
        }
        ctx.restore();
    }

    private resize(): void {
        const r = this.root.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.width = r.width;
        this.height = r.height;
        this.canvas.width = Math.max(1, Math.round(r.width * dpr));
        this.canvas.height = Math.max(1, Math.round(r.height * dpr));
        this.redraw();
    }

    private frame(timeMs: number): boolean {
        if (this.width <= 0 || this.height <= 0) {
            return false;
        }

        const dpr = window.devicePixelRatio || 1;

        // Clear and fill whole device pixels: with a fractional CSS size the last column would
        // otherwise only be blended and keep stale colour (visible after a theme switch).
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = this.theme.background;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        return this.draw(this.ctx, timeMs);
    }

}

/** @deprecated use ChartSurface.FONT */
export const CHART_FONT = ChartSurface.FONT;
