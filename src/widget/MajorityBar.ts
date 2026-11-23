import { paletteColor, Tween, Widget, WidgetOptions } from './WidgetBase';

/** One side (or a middle part) of a majority bar. */
export interface MajorityPart {
    id?: string;
    label: string;
    value: number;
    /** Any CSS colour (default: the palette). */
    color?: string;
}

export interface MajorityBarOptions extends WidgetOptions {
    /** The first part grows from the left, the last from the right, middle ones follow the first. */
    parts?: MajorityPart[];
    /** Whole bar (default: the sum; more leaves an undecided gap in the middle). */
    total?: number;
    /** The value needed to win, marked on the bar. */
    threshold?: number;
    /** Text at the threshold (default '<threshold> to win'). */
    thresholdLabel?: string;
    /** Value text (default: thousands separated, integers). */
    format?: (value: number) => string;
}

export interface MajorityBarEvents extends Record<string, unknown> {
    partClick: {part: MajorityPart; index: number; originalEvent: MouseEvent};
}

/**
 * Majority bar ("tug of war"): the first side fills from the left, the last
 * from the right, undecided stays in the middle; a mark shows what it takes
 * to win and the figures count up. DOM, zero dependencies.
 */
export class MajorityBar extends Widget<MajorityBarEvents> {

    private parts: MajorityPart[] = [];
    private total: number | undefined;
    private threshold: number | undefined;
    private thresholdLabel: string | undefined;
    private readonly format: (v: number) => string;
    private readonly head: HTMLDivElement;
    private readonly bar: HTMLDivElement;
    private readonly mark: HTMLDivElement;
    private readonly markLabel: HTMLDivElement;
    private segs: HTMLDivElement[] = [];
    private figures: HTMLElement[] = [];
    private readonly tween: Tween;

    public constructor(container: HTMLElement, options: MajorityBarOptions = {}) {
        super(container, 'wg-major', options);
        this.total = options.total;
        this.threshold = options.threshold;
        this.thresholdLabel = options.thresholdLabel;
        this.format = options.format ?? ((v) => Math.round(v).toLocaleString('en-US'));

        this.head = document.createElement('div');
        this.head.className = 'wg-major-head';
        this.bar = document.createElement('div');
        this.bar.className = 'wg-major-bar';
        this.mark = document.createElement('div');
        this.mark.className = 'wg-major-mark';
        this.markLabel = document.createElement('div');
        this.markLabel.className = 'wg-major-mark-label';
        this.bar.appendChild(this.mark);
        this.root.append(this.head, this.bar);
        this.head.appendChild(this.markLabel);
        this.tween = new Tween((v) => this.paint(v), this.duration);
        this.bar.addEventListener('click', this.onClick);
        this.setParts(options.parts ?? []);
    }

    public setParts(parts: MajorityPart[], total = this.total): void {
        const rebuild = parts.length !== this.parts.length || parts.some((p, i) => p.label !== this.parts[i]?.label);

        this.parts = parts.map((p) => ({...p}));
        this.total = total;
        if (rebuild) {
            this.build();
        }
        this.tween.set(this.parts.map((p) => Math.max(0, p.value)), this.animate);
    }

    public getParts(): ReadonlyArray<MajorityPart> {
        return this.parts;
    }

    /** Count up from zero again. */
    public replay(): void {
        this.tween.set(this.parts.map(() => 0), false);
        this.tween.set(this.parts.map((p) => Math.max(0, p.value)), this.animate);
    }

    public setThreshold(threshold: number | undefined, label?: string): void {
        this.threshold = threshold;
        this.thresholdLabel = label;
        this.paint(this.tween.values);
    }

    public override destroy(): void {
        this.tween.stop();
        this.bar.removeEventListener('click', this.onClick);
        super.destroy();
    }

    private color(i: number): string {
        return this.parts[i]?.color ?? paletteColor(i);
    }

    private build(): void {
        for (const s of this.segs) {
            s.remove();
        }
        for (const f of this.figures) {
            f.parentElement?.remove();
        }

        const n = this.parts.length;

        this.segs = this.parts.map((_, i) => {
            const s = document.createElement('div');

            s.className = 'wg-major-seg';
            s.style.background = this.color(i);
            s.dataset['part'] = String(i);
            this.bar.insertBefore(s, this.mark);
            return s;
        });

        // figures for the two outer sides; middle parts only get a tooltip
        this.figures = [];
        this.parts.forEach((p, i) => {
            if (n > 1 && i !== 0 && i !== n - 1) {
                return;
            }

            const side = document.createElement('div');
            const label = document.createElement('span');
            const fig = document.createElement('b');

            side.className = `wg-major-side ${i === 0 ? 'wg-major-left' : 'wg-major-right'}`;
            side.style.color = this.color(i);
            label.textContent = `${p.label} `;
            side.append(label, fig);
            this.head.appendChild(side);
            this.figures.push(fig);
        });
    }

    private paint(values: readonly number[]): void {
        const total = Math.max(this.total ?? 0, this.parts.reduce((a, p) => a + Math.max(0, p.value), 0), 1);
        const n = this.parts.length;
        let left = 0;

        values.forEach((v, i) => {
            const seg = this.segs[i];
            const w = v / total * 100;

            if (seg === undefined) {
                return;
            }
            if (i === n - 1 && n > 1) {
                seg.style.left = '';
                seg.style.right = '0';
            } else {
                seg.style.right = '';
                seg.style.left = `${left}%`;
                left += w;
            }
            seg.style.width = `${w}%`;
            seg.title = `${this.parts[i]?.label ?? ''}: ${this.format(this.parts[i]?.value ?? 0)}`;
        });

        this.figures.forEach((f, k) => {
            const i = k === 0 ? 0 : n - 1;
            f.textContent = this.format(values[i] ?? 0);
        });

        const t = this.threshold;

        if (t === undefined) {
            this.mark.style.display = 'none';
            this.markLabel.style.display = 'none';
            return;
        }

        const at = `${Math.min(100, t / total * 100)}%`;

        this.mark.style.display = '';
        this.mark.style.left = at;
        this.markLabel.style.display = '';
        this.markLabel.style.left = at;
        this.markLabel.textContent = this.thresholdLabel ?? `${this.format(t)} to win`;
    }

    private readonly onClick = (e: MouseEvent): void => {
        const el = e.target instanceof Element ? e.target.closest<HTMLElement>('.wg-major-seg') : null;
        const index = Number(el?.dataset['part'] ?? -1);
        const part = this.parts[index];

        if (part !== undefined) {
            this.events.emit('partClick', {part, index, originalEvent: e});
        }
    };

}
