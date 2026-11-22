import { EventEmitter } from '../util/EventEmitter';
import { DayClockGeometry, DayClockItem, DayClockPlaced, DayClockState } from './DayClockGeometry';

export interface DayClockOptions {
    /** 'auto' (default) follows the OS colour scheme; 'light' / 'dark' fix it. */
    theme?: 'auto' | 'light' | 'dark';
    /** Drawing size in px — the dial scales down with its container, never above this (default 290). */
    size?: number;
    /** Rings for overlapping items; further overlaps share the innermost (default 4). */
    maxRings?: number;
    /** Locale(s) for the times (default: the browser's). */
    locale?: string | string[];
    /** Small text under the time in the centre (default 'Now'; '' hides it). */
    nowLabel?: string;
    /** Fixed "now" — default: the current time. */
    now?: Date;
    /** Redraw every 30 s with the current time while no fixed `now` is set (default false). */
    live?: boolean;
    /** Accessible name of the dial (default 'Day clock'). */
    ariaLabel?: string;
}

export interface DayClockEvents extends Record<string, unknown> {
    itemClick: {item: DayClockItem; state: DayClockState; originalEvent: MouseEvent};
    /** Pointer entered an item (null when it left). */
    itemHover: {item: DayClockItem; state: DayClockState} | null;
}

/** Names of the CSS custom properties, without the `--dc-` prefix. */
export type DayClockStyleVar =
    | 'surface' | 'surface2' | 'ink' | 'muted' | 'hair' | 'hair-strong' | 'grid' | 'past' | 'running' | 'upcoming';

const SVG_NS = 'http://www.w3.org/2000/svg';
const OUTER = 104;
const RING_GAP = 14;
const LIVE_MS = 30000;
const VIEW = 290;
/** Extra width left and right for the 06:00 / 18:00 labels. */
const SIDE = 16;

/**
 * Day clock — a whole day on one 24 h dial (00:00 top, 06:00 right, 12:00
 * bottom, 18:00 left). The elapsed part of the day is shaded and a hand marks
 * "now". Each item (appointment, shift, booking) is an arc from its start to
 * its end on a ring — overlapping items get separate rings — with a dot at
 * its start, coloured by state: done (muted), running (green), upcoming
 * (accent). SVG, zero dependencies; colours are `--dc-*` CSS variables.
 *
 *     const clock = new DayClock(el, {live: true});
 *     clock.setItems([{start, end, label: 'Site visit'}]);
 *     clock.on('itemClick', (e) => open(e.item.id));
 */
export class DayClock {

    private readonly root: HTMLDivElement;
    private readonly events = new EventEmitter<DayClockEvents>();
    private readonly size: number;
    private readonly maxRings: number;
    private readonly locale: string | string[] | undefined;
    private readonly nowLabel: string;
    private readonly ariaLabel: string;
    private items: DayClockItem[] = [];
    private fixedNow: Date | null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private placed: DayClockPlaced[] = [];

    public constructor(container: HTMLElement, options: DayClockOptions = {}) {
        DayClockStyles.ensure();

        this.size = options.size ?? 290;
        this.maxRings = Math.max(1, Math.min(6, options.maxRings ?? 4));
        this.locale = options.locale;
        this.nowLabel = options.nowLabel ?? 'Now';
        this.ariaLabel = options.ariaLabel ?? 'Day clock';
        this.fixedNow = options.now ?? null;

        this.root = document.createElement('div');
        this.root.className = 'dc-root';
        this.root.dataset.dcTheme = options.theme ?? 'auto';
        container.appendChild(this.root);

        this.root.addEventListener('click', this.onClick);
        this.root.addEventListener('pointerover', this.onOver);
        this.root.addEventListener('pointerout', this.onOut);

        this.setLive(options.live ?? false);
        this.render();
    }

    /** Same rule as the dial: past when ended, running when started, else upcoming. */
    public static state(item: DayClockItem, now: Date): DayClockState {
        return DayClockGeometry.state(item, now);
    }

    public get element(): HTMLElement {
        return this.root;
    }

    /** The items to show; only those touching the day of "now" are drawn. */
    public setItems(items: readonly DayClockItem[]): void {
        this.items = [...items];
        this.render();
    }

    /** Fix "now" (e.g. to show another day), or null for the current time. */
    public setNow(now: Date | null): void {
        this.fixedNow = now;
        this.render();
    }

    /** The "now" the dial is drawn for. */
    public get now(): Date {
        return this.fixedNow ?? new Date();
    }

    /** Redraw every 30 s with the current time (has no effect while `now` is fixed). */
    public setLive(live: boolean): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (live) {
            this.timer = setInterval(() => {
                if (this.fixedNow === null) {
                    this.render();
                }
            }, LIVE_MS);
        }
    }

    public setTheme(theme: 'auto' | 'light' | 'dark'): void {
        this.root.dataset.dcTheme = theme;
    }

    /** Override `--dc-*` colours on this clock (null removes an override). */
    public setStyleVars(vars: Partial<Record<DayClockStyleVar, string | null>>): void {
        for (const [key, value] of Object.entries(vars)) {
            if (value === null || value === undefined) {
                this.root.style.removeProperty(`--dc-${key}`);
            } else {
                this.root.style.setProperty(`--dc-${key}`, value);
            }
        }
    }

    public on<K extends keyof DayClockEvents>(event: K, handler: (payload: DayClockEvents[K]) => void): this {
        this.events.on(event, handler);
        this.root.classList.toggle('dc-clickable', this.events.has('itemClick'));
        return this;
    }

    public off<K extends keyof DayClockEvents>(event: K, handler: (payload: DayClockEvents[K]) => void): this {
        this.events.off(event, handler);
        this.root.classList.toggle('dc-clickable', this.events.has('itemClick'));
        return this;
    }

    public destroy(): void {
        this.setLive(false);
        this.root.removeEventListener('click', this.onClick);
        this.root.removeEventListener('pointerover', this.onOver);
        this.root.removeEventListener('pointerout', this.onOut);
        this.events.clear();
        this.root.remove();
    }

    /** "08:30" in the clock's locale. */
    public formatTime(date: Date): string {
        return date.toLocaleTimeString(this.locale, {hour: '2-digit', minute: '2-digit'});
    }

    /** Draw the dial again (setters call it; for a host that changed something else). */
    public render(): void {
        const now = this.now;
        const c = VIEW / 2;
        const day = DayClockGeometry.dayStart(now);
        const nowMin = DayClockGeometry.minutes(now, day);
        // Drawn in a fixed 290 × 290 view box (plus room for the side labels); `size` caps the dial width.
        const svg = el('svg', {viewBox: `${-SIDE} 0 ${VIEW + (2 * SIDE)} ${VIEW}`, width: '100%', role: 'img', class: 'dc-svg'});

        svg.style.maxWidth = `${Math.round(this.size * (VIEW + (2 * SIDE)) / VIEW)}px`;

        // face + elapsed part of the day
        svg.appendChild(el('circle', {cx: c, cy: c, r: OUTER + 8, class: 'dc-face'}));
        const wedge = DayClockGeometry.wedgePath(nowMin, OUTER + 8, c);
        if (wedge !== '') {
            svg.appendChild(el('path', {d: wedge, class: 'dc-elapsed'}));
        }

        // hour ticks + labels
        for (let h = 0; h < 24; h++) {
            const major = h % 6 === 0;
            const [x1, y1] = DayClockGeometry.point(h * 60, OUTER + 8, c);
            const [x2, y2] = DayClockGeometry.point(h * 60, OUTER + (major ? 15 : 12), c);

            svg.appendChild(el('line', {x1, y1, x2, y2, class: major ? 'dc-tick dc-tick-major' : 'dc-tick'}));

            if (major) {
                // Top/bottom labels centre on their tick; 06:00 / 18:00 start beside it, outward.
                const side = h === 6 ? 'start' : h === 18 ? 'end' : 'middle';
                const [lx, ly] = DayClockGeometry.point(h * 60, OUTER + (side === 'middle' ? 23 : 19), c);
                const label = el('text', {x: lx, y: ly, class: 'dc-hour', 'text-anchor': side, 'dominant-baseline': 'middle'});

                label.textContent = this.formatTime(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h));
                svg.appendChild(label);
            }
        }

        // ring guides
        for (let i = 0; i < this.maxRings; i++) {
            svg.appendChild(el('circle', {cx: c, cy: c, r: OUTER - (i * RING_GAP), class: 'dc-ring'}));
        }

        // items
        this.placed = DayClockGeometry.place(this.items, now, this.maxRings);
        this.placed.forEach((p, index) => {
            const r = OUTER - (p.lane * RING_GAP);
            const d = DayClockGeometry.arcPath(p.from, p.to, r, c);
            const [dx, dy] = DayClockGeometry.point(p.from, r, c);
            const item = el('g', {class: `dc-item dc-${p.state}`, 'data-dc-item': index});
            const title = el('title', {});

            if (p.item.color !== undefined) {
                item.style.setProperty('--dc-c', p.item.color);
            }
            title.textContent = `${this.formatTime(p.item.start)}–${this.formatTime(p.item.end)} ${p.item.label}`;
            item.append(
                title,
                el('path', {d, class: 'dc-hit'}),
                el('path', {d, class: 'dc-arc'}),
                el('circle', {cx: dx, cy: dy, r: 5, class: 'dc-dot'})
            );
            svg.appendChild(item);
        });

        // hand + centre
        const [hx, hy] = DayClockGeometry.point(nowMin, OUTER + 8, c);

        svg.appendChild(el('line', {x1: c, y1: c, x2: hx, y2: hy, class: 'dc-hand'}));
        svg.appendChild(el('circle', {cx: hx, cy: hy, r: 3, class: 'dc-hand-tip'}));
        svg.appendChild(el('circle', {cx: c, cy: c, r: 30, class: 'dc-center'}));

        const time = el('text', {x: c, y: c - 2, class: 'dc-time', 'text-anchor': 'middle'});
        time.textContent = this.formatTime(now);
        svg.appendChild(time);

        if (this.nowLabel !== '') {
            const sub = el('text', {x: c, y: c + 13, class: 'dc-sub', 'text-anchor': 'middle'});
            sub.textContent = this.nowLabel;
            svg.appendChild(sub);
        }

        const counts = {past: 0, running: 0, upcoming: 0};
        this.placed.forEach((p) => counts[p.state]++);
        svg.setAttribute('aria-label', `${this.ariaLabel}, ${this.formatTime(now)}: ` +
            `${counts.running} running, ${counts.upcoming} upcoming, ${counts.past} done`);

        this.root.replaceChildren(svg);
    }

    private readonly onClick = (e: MouseEvent): void => {
        const p = this.placedAt(e.target);

        if (p !== null) {
            this.events.emit('itemClick', {item: p.item, state: p.state, originalEvent: e});
        }
    };

    private readonly onOver = (e: PointerEvent): void => {
        const p = this.placedAt(e.target);

        if (p !== null) {
            this.events.emit('itemHover', {item: p.item, state: p.state});
        }
    };

    private readonly onOut = (e: PointerEvent): void => {
        const from = this.placedAt(e.target);

        if (from !== null && from !== this.placedAt(e.relatedTarget)) {
            this.events.emit('itemHover', null);
        }
    };

    private placedAt(target: EventTarget | null): DayClockPlaced | null {
        const g = target instanceof Element ? target.closest('[data-dc-item]') : null;

        return g === null ? null : this.placed[Number(g.getAttribute('data-dc-item'))] ?? null;
    }

}

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
    const node = document.createElementNS(SVG_NS, tag);

    for (const [key, value] of Object.entries(attrs)) {
        node.setAttribute(key, String(value));
    }

    return node;
}

/** Default look, injected once: zero-specificity `:where()` rules over `--dc-*` variables. */
export class DayClockStyles {

    private static injected = false;

    public static ensure(): void {
        if (DayClockStyles.injected || typeof document === 'undefined') {
            return;
        }
        DayClockStyles.injected = true;

        const style = document.createElement('style');

        style.dataset.jsngraph = 'dayclock';
        style.textContent = DayClockStyles.css();
        document.head.appendChild(style);
    }

    public static css(): string {
        const light = '--dc-surface:#ffffff;--dc-surface2:#f7f9fc;--dc-ink:#151a23;--dc-muted:#5b6472;--dc-hair:#dde3ea;' +
            '--dc-hair-strong:#cdd5df;--dc-grid:#e7ecf2;--dc-past:#5b6472;--dc-running:#1f9d63;--dc-upcoming:#2b6cb0';
        const dark = '--dc-surface:#181d27;--dc-surface2:#1f2530;--dc-ink:#e7ebf2;--dc-muted:#97a1b2;--dc-hair:#28303c;' +
            '--dc-hair-strong:#333d4c;--dc-grid:#262f3b;--dc-past:#97a1b2;--dc-running:#35b877;--dc-upcoming:#5aa0e0';

        return [
            `:where(.dc-root){${light};font-family:inherit}`,
            `:where(.dc-root[data-dc-theme="dark"]){${dark}}`,
            `@media (prefers-color-scheme:dark){:where(.dc-root[data-dc-theme="auto"]){${dark}}}`,
            ':where(.dc-svg){display:block;margin:0 auto;height:auto;overflow:visible}',
            ':where(.dc-face){fill:var(--dc-surface2);stroke:var(--dc-hair)}',
            ':where(.dc-elapsed){fill:var(--dc-grid);opacity:.9}',
            ':where(.dc-tick){stroke:var(--dc-hair-strong);stroke-width:1}',
            ':where(.dc-tick-major){stroke:var(--dc-muted);stroke-width:1.5}',
            ':where(.dc-hour){font-size:9px;fill:var(--dc-muted)}',
            ':where(.dc-ring){fill:none;stroke:var(--dc-hair);stroke-dasharray:2 3}',
            ':where(.dc-item){--dc-c:var(--dc-upcoming)}',
            ':where(.dc-item.dc-past){--dc-c:var(--dc-past)}',
            ':where(.dc-item.dc-running){--dc-c:var(--dc-running)}',
            ':where(.dc-arc){fill:none;stroke:var(--dc-c);stroke-width:5;stroke-linecap:round;opacity:.9;transition:stroke-width .12s}',
            ':where(.dc-past .dc-arc){opacity:.55}',
            ':where(.dc-hit){fill:none;stroke:transparent;stroke-width:14;stroke-linecap:round}',
            ':where(.dc-dot){fill:var(--dc-c);stroke:var(--dc-c);stroke-width:2}',
            ':where(.dc-upcoming .dc-dot){fill:var(--dc-surface)}',
            ':where(.dc-item:hover .dc-arc){stroke-width:7}',
            ':where(.dc-clickable .dc-item){cursor:pointer}',
            ':where(.dc-hand){stroke:var(--dc-ink);stroke-width:1.6;stroke-linecap:round}',
            ':where(.dc-hand-tip){fill:var(--dc-ink)}',
            ':where(.dc-center){fill:var(--dc-surface);stroke:var(--dc-hair);filter:drop-shadow(0 1px 3px rgba(18,26,40,.15))}',
            ':where(.dc-time){font-size:15px;font-weight:700;fill:var(--dc-ink)}',
            ':where(.dc-sub){font-size:9px;fill:var(--dc-muted)}',
            '@media (prefers-reduced-motion:reduce){:where(.dc-arc){transition:none}}'
        ].join('');
    }

}
