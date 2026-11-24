import { Tween, Widget, WidgetOptions } from './WidgetBase';

/** One figure of a `StatList`. */
export interface StatItem {
    value: number;
    label?: string;
    color?: string;
    /** A second, dimmed number beside the value (e.g. the remainder: 30 | 70). */
    secondary?: number;
}

export interface StatListOptions extends WidgetOptions {
    items?: StatItem[];
    /** 'column' (default), 'row' or 'grid' (two columns). */
    layout?: 'column' | 'row' | 'grid';
    /** Font size of the values in px (default 28). */
    size?: number;
    /** Appended to every value (e.g. '%'). */
    suffix?: string;
    /** Decimals shown (default 0). */
    decimals?: number;
    /** A short bar in the item colour under the value (default false). */
    underline?: boolean;
    format?: (value: number, item: StatItem) => string;
}

/**
 * Big coloured figures with small captions — the "60 % / 75 %" column of a
 * dashboard. Values count up/down when they change. DOM, zero dependencies.
 */
export class StatList extends Widget<Record<string, never>> {

    private items: StatItem[] = [];
    private readonly layout: 'column' | 'row' | 'grid';
    private readonly size: number;
    private readonly format: (value: number, item: StatItem) => string;
    private readonly underline: boolean;
    private values: HTMLSpanElement[] = [];
    private secondaries: (HTMLSpanElement | null)[] = [];
    private readonly box: HTMLDivElement;
    private readonly tween: Tween;

    public constructor(container: HTMLElement, options: StatListOptions = {}) {
        super(container, 'wg-statlist', options);
        this.layout = options.layout ?? 'column';
        this.size = options.size ?? 28;
        this.underline = options.underline ?? false;

        const suffix = options.suffix ?? '';
        const decimals = options.decimals ?? 0;

        this.format = options.format ?? ((v) => `${v.toFixed(decimals)}${suffix}`);
        this.box = document.createElement('div');
        this.box.className = `wg-stats wg-stats-${this.layout}`;
        this.root.appendChild(this.box);
        this.tween = new Tween((v) => this.paint(v), this.duration);
        this.setItems(options.items ?? []);
    }

    public setItems(items: readonly StatItem[], animate = this.animate): void {
        const rebuild = items.length !== this.items.length ||
            items.some((it, i) => it.label !== this.items[i]?.label || (it.secondary === undefined) !== (this.items[i]?.secondary === undefined));

        this.items = items.map((it) => ({...it}));
        if (rebuild) {
            this.build();
        }
        this.tween.set(this.flat(), animate);
    }

    /** New values in order (secondaries keep theirs). */
    public setValues(values: readonly number[], animate = this.animate): void {
        values.forEach((v, i) => {
            const it = this.items[i];
            if (it !== undefined) {
                it.value = v;
            }
        });
        this.tween.set(this.flat(), animate);
    }

    public getItems(): ReadonlyArray<Readonly<StatItem>> {
        return this.items.map((it) => ({...it}));
    }

    public override destroy(): void {
        this.tween.stop();
        super.destroy();
    }

    private flat(): number[] {
        return this.items.flatMap((it) => [it.value, it.secondary ?? 0]);
    }

    private build(): void {
        this.box.replaceChildren();
        this.values = [];
        this.secondaries = [];

        this.items.forEach((item, i) => {
            const color = item.color ?? Widget.paletteColor(i);
            const cell = document.createElement('div');
            const line = document.createElement('div');
            const value = document.createElement('span');

            line.className = 'wg-stat-value';
            line.style.fontSize = `${this.size}px`;
            value.style.color = color;
            line.appendChild(value);

            let secondary: HTMLSpanElement | null = null;
            if (item.secondary !== undefined) {
                secondary = document.createElement('span');
                secondary.className = 'wg-stat-secondary';
                line.appendChild(secondary);
            }
            cell.appendChild(line);

            if (this.underline) {
                const bar = document.createElement('div');
                bar.className = 'wg-stat-bar';
                bar.style.color = color;
                bar.style.width = `${Math.round(this.size * 1.1)}px`;
                cell.appendChild(bar);
            }
            if (item.label !== undefined) {
                const label = document.createElement('div');
                label.className = 'wg-stat-label';
                label.textContent = item.label;
                cell.appendChild(label);
            }

            this.box.appendChild(cell);
            this.values.push(value);
            this.secondaries.push(secondary);
        });
    }

    private paint(v: number[]): void {
        this.items.forEach((item, i) => {
            const value = this.values[i];
            const secondary = this.secondaries[i];

            if (value !== undefined) {
                value.textContent = this.format(v[i * 2] ?? 0, item);
            }
            if (secondary) {
                secondary.textContent = this.format(v[(i * 2) + 1] ?? 0, item);
            }
        });
    }

}
