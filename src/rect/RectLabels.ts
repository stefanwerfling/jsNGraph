import { RectAnim } from './RectAnim';
import { RectColor } from './RectColor';
import { RectChipOptions, RectHeaderOptions, RectLegendOptions } from './RectKitTypes';

/**
 * A section heading — an optional kicker, a large accent-coloured title and a
 * dim subtitle. The "SET B · NOW" / "B1 · …" banner of a wiring diagram.
 */
export class RectHeader {

    public constructor(private readonly options: RectHeaderOptions) {}

    public render(): HTMLDivElement {
        const o = this.options;
        const accent = RectColor.resolve(o.accent, 'blue');

        const el = document.createElement('div');
        el.style.cssText = 'display:flex; flex-direction:column; gap:2px; font-family:system-ui,sans-serif;';

        if (o.kicker !== undefined) {
            const kicker = document.createElement('span');
            kicker.textContent = o.kicker;
            kicker.style.cssText = `font-size:11px; font-weight:700; letter-spacing:0.08em; color:${accent};`;
            el.appendChild(kicker);
        }

        const title = document.createElement('span');
        title.textContent = o.title;
        title.style.cssText = `font-size:19px; font-weight:800; letter-spacing:0.04em; color:${accent};`;
        el.appendChild(title);

        if (o.subtitle !== undefined) {
            const sub = document.createElement('span');
            sub.textContent = o.subtitle;
            sub.style.cssText = 'font-size:12px; color:#8595b5;';
            el.appendChild(sub);
        }

        return el;
    }

}

/** A small token/label chip — the little coloured label squares of a diagram. */
export class RectChip {

    public constructor(private readonly options: RectChipOptions) {}

    public render(): HTMLSpanElement {
        const o = this.options;
        const color = RectColor.resolve(o.color, 'slate');

        const el = document.createElement('span');
        el.textContent = o.label;
        el.style.cssText = o.filled
            ? `display:inline-block; font:10px system-ui,sans-serif; font-weight:600; color:#0f1420; background:${color}; padding:1px 7px; border-radius:999px;`
            : `display:inline-block; font:10px system-ui,sans-serif; color:#c9d6ec; border:1px solid ${color}; padding:1px 7px; border-radius:6px;`;

        if (o.animated) {
            RectAnim.ensure();
            el.style.animation = `${RectAnim.PULSE} 1.4s ease-in-out infinite`;
        }

        return el;
    }

}

/** A legend: a row/column of colour swatches with labels. */
export class RectLegend {

    public constructor(private readonly options: RectLegendOptions) {}

    public render(): HTMLDivElement {
        const vertical = this.options.layout === 'column';
        const el = document.createElement('div');
        el.style.cssText = `display:inline-flex; flex-direction:${vertical ? 'column' : 'row'}; gap:${vertical ? 6 : 14}px; font-family:system-ui,sans-serif;`;

        for (const item of this.options.items) {
            const color = RectColor.resolve(item.color, 'slate');
            const row = document.createElement('span');
            row.style.cssText = 'display:inline-flex; align-items:center; gap:6px; font-size:11px; color:#8595b5;';

            const dot = document.createElement('span');
            dot.style.cssText = `width:9px; height:9px; border-radius:3px; background:${color};`;
            row.appendChild(dot);

            const label = document.createElement('span');
            label.textContent = item.label;
            row.appendChild(label);

            el.appendChild(row);
        }

        return el;
    }

}
