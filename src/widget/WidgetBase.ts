import { EventEmitter } from '../util/EventEmitter';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Options every dashboard widget understands. */
export interface WidgetOptions {
    /** 'auto' (default) follows the OS colour scheme; 'light' / 'dark' fix it. */
    theme?: 'auto' | 'light' | 'dark';
    /** Ease value changes (default true; off under `prefers-reduced-motion`). */
    animate?: boolean;
    /** Length of a value animation in ms (default 650). */
    duration?: number;
    /** Accessible name. */
    ariaLabel?: string;
}

/** Names of the shared CSS custom properties, without the `--wg-` prefix. */
export type WidgetStyleVar =
    | 'ink' | 'muted' | 'track' | 'grid' | 'knob' | 'surface' | 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6';

/** Default colour of the i-th item: one of the six palette variables. */
export function paletteColor(i: number): string {
    return `var(--wg-c${(i % 6) + 1})`;
}

/** Create an SVG element with attributes. */
export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
    const node = document.createElementNS(SVG_NS, tag);

    for (const [key, value] of Object.entries(attrs)) {
        node.setAttribute(key, String(value));
    }

    return node;
}

/** Set attributes on an existing element (numbers rounded to 0.01). */
export function setAttrs(node: Element, attrs: Record<string, string | number>): void {
    for (const [key, value] of Object.entries(attrs)) {
        node.setAttribute(key, typeof value === 'number' ? String(Math.round(value * 100) / 100) : value);
    }
}

/**
 * Eases a list of numbers towards a target (ease-out cubic) and hands every
 * intermediate list to `apply`. New entries start from 0, so a widget grows in.
 */
export class Tween {

    private current: number[] = [];
    private from: number[] = [];
    private to: number[] = [];
    private started = 0;
    private raf = 0;

    public constructor(private readonly apply: (values: number[]) => void, private readonly duration: number) {
    }

    /** The values as last applied. */
    public get values(): readonly number[] {
        return this.current;
    }

    public set(target: readonly number[], animate: boolean): void {
        this.stop();

        const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (!animate || reduced || this.duration <= 0 || typeof requestAnimationFrame !== 'function') {
            this.current = target.slice();
            this.apply(this.current);
            return;
        }

        this.from = target.map((_, i) => this.current[i] ?? 0);
        this.to = target.slice();
        this.started = 0;
        this.raf = requestAnimationFrame(this.step);
    }

    public stop(): void {
        if (this.raf !== 0) {
            cancelAnimationFrame(this.raf);
            this.raf = 0;
        }
    }

    private readonly step = (now: number): void => {
        if (this.started === 0) {
            this.started = now;
        }

        const t = Math.min(1, (now - this.started) / this.duration);
        const k = 1 - ((1 - t) ** 3);

        this.current = this.to.map((v, i) => {
            const a = this.from[i] ?? 0;
            return a + ((v - a) * k);
        });
        this.apply(this.current);
        this.raf = t < 1 ? requestAnimationFrame(this.step) : 0;
    };

}

/**
 * Shared shell of the dashboard widgets (`RingGauge`, `SegmentGauge`,
 * `SegmentBar`, `ProgressBars`, `MonthCalendar`, `StatList`, `WorldMap`): a
 * root element carrying the theme, typed events and the `--wg-*` colours.
 */
export abstract class Widget<Events extends Record<string, unknown>> {

    protected readonly root: HTMLDivElement;
    protected readonly events = new EventEmitter<Events>();
    protected readonly animate: boolean;
    protected readonly duration: number;
    private resizeObserver: ResizeObserver | null = null;
    private lastWidth = 0;

    protected constructor(container: HTMLElement, className: string, options: WidgetOptions) {
        WidgetStyles.ensure();
        this.animate = options.animate ?? true;
        this.duration = options.duration ?? 650;
        this.root = document.createElement('div');
        this.root.className = `wg-root ${className}`;
        this.root.dataset.wgTheme = options.theme ?? 'auto';
        if (options.ariaLabel !== undefined) {
            this.root.setAttribute('aria-label', options.ariaLabel);
        }
        container.appendChild(this.root);
    }

    public get element(): HTMLElement {
        return this.root;
    }

    /**
     * Call `onChange` with the root's width in px whenever it changes — for widgets
     * that lay out in real pixels so their text keeps its size.
     */
    protected watchWidth(onChange: (width: number) => void): void {
        if (typeof ResizeObserver === 'undefined') {
            return;
        }
        this.resizeObserver = new ResizeObserver(() => {
            const w = Math.round(this.root.clientWidth);

            if (w > 0 && w !== this.lastWidth) {
                this.lastWidth = w;
                onChange(w);
            }
        });
        this.resizeObserver.observe(this.root);
    }

    public setTheme(theme: 'auto' | 'light' | 'dark'): void {
        this.root.dataset.wgTheme = theme;
    }

    /** Override `--wg-*` colours on this widget (null removes an override). */
    public setStyleVars(vars: Partial<Record<WidgetStyleVar, string | null>>): void {
        for (const [key, value] of Object.entries(vars)) {
            if (value === null || value === undefined) {
                this.root.style.removeProperty(`--wg-${key}`);
            } else {
                this.root.style.setProperty(`--wg-${key}`, value);
            }
        }
    }

    public on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): this {
        this.events.on(event, handler);
        return this;
    }

    public off<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): this {
        this.events.off(event, handler);
        return this;
    }

    public destroy(): void {
        this.resizeObserver?.disconnect();
        this.events.clear();
        this.root.remove();
    }

}

/** Default look of the dashboard widgets, injected once: zero-specificity `:where()` rules over `--wg-*`. */
export class WidgetStyles {

    private static injected = false;

    public static ensure(): void {
        if (WidgetStyles.injected || typeof document === 'undefined') {
            return;
        }
        WidgetStyles.injected = true;

        const style = document.createElement('style');

        style.dataset.jsngraph = 'widgets';
        style.textContent = WidgetStyles.css();
        document.head.appendChild(style);
    }

    public static css(): string {
        const light = '--wg-surface:#ffffff;--wg-ink:#1a2430;--wg-muted:#64707e;--wg-track:#e1e7ed;--wg-grid:#e9eef2;' +
            '--wg-knob:#ffffff;--wg-c1:#1597c4;--wg-c2:#e0365a;--wg-c3:#dc9a06;--wg-c4:#12a86b;--wg-c5:#7c5ce0;--wg-c6:#0e9488';
        const dark = '--wg-surface:#0f1d20;--wg-ink:#e6f0f1;--wg-muted:#86a0a4;--wg-track:#1f383b;--wg-grid:#1b2f32;' +
            '--wg-knob:#ffffff;--wg-c1:#2ec5e8;--wg-c2:#f0506e;--wg-c3:#f7b928;--wg-c4:#22d68b;--wg-c5:#a08af5;--wg-c6:#2bbfb3';

        return [
            `:where(.wg-root){${light};color:var(--wg-ink);font-family:inherit;font-variant-numeric:tabular-nums}`,
            `:where(.wg-root[data-wg-theme="dark"]){${dark}}`,
            `@media (prefers-color-scheme:dark){:where(.wg-root[data-wg-theme="auto"]){${dark}}}`,
            ':where(.wg-svg){display:block;width:100%;height:auto;overflow:visible}',
            ':where(.wg-track){stroke:var(--wg-track);fill:none}',
            ':where(.wg-text){fill:var(--wg-ink)}',
            ':where(.wg-muted){fill:var(--wg-muted)}',
            ':where(.wg-grid){stroke:var(--wg-grid);stroke-width:1}',
            // ring gauge
            ':where(.wg-ring-value){fill:none;cursor:default}',
            ':where(.wg-center){font-weight:700;text-anchor:middle;dominant-baseline:central}',
            // segment bar
            ':where(.wg-seg-off){fill:var(--wg-track)}',
            ':where(.wg-seg-label){font-size:11px;font-weight:600}',
            // progress bars
            ':where(.wg-pb-knob){stroke:var(--wg-knob);stroke-width:2.5}',
            ':where(.wg-pb-editable .wg-pb-row){cursor:ew-resize}',
            ':where(.wg-axis){font-size:9px;fill:var(--wg-muted)}',
            // calendar
            ':where(.wg-cal-day){font-size:12px;text-anchor:middle;dominant-baseline:central;fill:var(--wg-ink);pointer-events:none}',
            ':where(.wg-cal-out){fill:var(--wg-muted);opacity:.45}',
            ':where(.wg-cal-weekend){fill:var(--wg-c2)}',
            ':where(.wg-cal-head){font-size:11px;font-weight:700;text-anchor:middle;fill:var(--wg-ink)}',
            ':where(.wg-cal-head.wg-cal-weekend){fill:var(--wg-c2)}',
            ':where(.wg-cal-range){fill:var(--wg-c3)}',
            ':where(.wg-cal-in){fill:var(--wg-surface);font-weight:600}',
            ':where(.wg-cal-cell){fill:transparent}',
            ':where(.wg-cal-select .wg-cal-cell){cursor:pointer}',
            ':where(.wg-cal-select .wg-cal-cell:hover){fill:var(--wg-track)}',
            ':where(.wg-cal-today){fill:none;stroke:var(--wg-c1);stroke-width:1.5}',
            ':where(.wg-cal-title){font-size:13px;font-weight:700;fill:var(--wg-ink)}',
            ':where(.wg-cal-nav){fill:var(--wg-muted);cursor:pointer;font-size:15px;text-anchor:middle;dominant-baseline:central}',
            ':where(.wg-cal-nav:hover){fill:var(--wg-ink)}',
            // stat list
            ':where(.wg-stats){display:flex;gap:10px 22px}',
            ':where(.wg-stats-column){flex-direction:column}',
            ':where(.wg-stats-row){flex-direction:row;flex-wrap:wrap}',
            ':where(.wg-stats-grid){display:grid;grid-template-columns:repeat(2,auto);justify-content:start}',
            ':where(.wg-stat-value){font-weight:800;line-height:1;white-space:nowrap}',
            ':where(.wg-stat-secondary){color:var(--wg-muted);opacity:.55;margin-left:.35em}',
            ':where(.wg-stat-bar){height:3px;margin-top:5px;border-radius:2px;background:currentColor;opacity:.9}',
            ':where(.wg-stat-label){font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--wg-muted);margin-top:3px}',
            // world map
            ':where(.wg-map){display:flex;align-items:center;gap:14px}',
            ':where(.wg-map-legend-bottom){flex-direction:column;align-items:stretch}',
            ':where(.wg-map .wg-svg){flex:1 1 auto;min-width:0}',
            ':where(.wg-land){fill:var(--wg-track)}',
            ':where(.wg-land-dot){fill:var(--wg-track)}',
            ':where(.wg-marker){cursor:default}',
            ':where(.wg-marker-dot){stroke:var(--wg-surface);stroke-width:.6}',
            ':where(.wg-marker-pulse){fill:none;stroke-width:.8;transform-box:fill-box;transform-origin:center;' +
                'animation:wg-pulse 1.8s ease-out infinite}',
            '@keyframes wg-pulse{from{transform:scale(1);opacity:.9}to{transform:scale(3.2);opacity:0}}',
            ':where(.wg-legend){display:flex;flex-direction:column;gap:8px;font-size:11px;color:var(--wg-muted)}',
            ':where(.wg-map-legend-bottom .wg-legend){flex-direction:row;flex-wrap:wrap;gap:6px 16px}',
            ':where(.wg-legend-item){display:flex;align-items:center;gap:7px;white-space:nowrap}',
            ':where(.wg-legend-dot){width:9px;height:9px;border-radius:50%;flex:none}',
            '@media (prefers-reduced-motion:reduce){:where(.wg-marker-pulse){animation:none;opacity:0}}'
        ].join('');
    }

}
