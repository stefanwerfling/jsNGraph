import { RectColor } from './RectColor';
import { RectGroupOptions } from './RectKitTypes';

/**
 * A titled container frame that holds other rect elements (boxes, pipelines,
 * nested groups) — the "NEURAL ENCODER (PRETRAIN)"-style grouping box of a
 * wiring diagram. The title sits on the top border; children are laid out in a
 * row or column. Plain DOM + inline styles, no stylesheet.
 */
export class RectGroup {

    public constructor(private readonly options: RectGroupOptions = {}) {}

    public render(): HTMLDivElement {
        const o = this.options;
        const border = o.accent ? RectColor.resolve(o.accent) : '#3a4a68';
        const vertical = o.layout === 'column';

        const el = document.createElement('div');
        el.style.cssText = `
            position: relative;
            display: inline-flex;
            flex-direction: ${vertical ? 'column' : 'row'};
            align-items: center;
            gap: ${o.gap ?? 14}px;
            padding: 20px 16px 14px;
            border-radius: 12px;
            border: 1px ${o.dashed ? 'dashed' : 'solid'} ${border};
            background: ${o.background ?? 'rgba(13, 18, 32, 0.45)'};
            font: 12px system-ui, sans-serif;
            color: #e8eefc;
        `;

        if (o.title !== undefined || o.badge !== undefined) {
            const header = document.createElement('div');
            header.style.cssText = `
                position: absolute; top: -9px; left: 14px;
                display: inline-flex; align-items: center; gap: 6px;
                padding: 1px 8px; border-radius: 6px;
                background: #0f1420;
            `;

            if (o.title !== undefined) {
                const title = document.createElement('span');
                title.textContent = o.title;
                title.style.cssText = `font-size:10.5px; font-weight:700; letter-spacing:0.08em; color:${o.accent ? border : '#8595b5'};`;
                header.appendChild(title);
            }

            if (o.badge !== undefined) {
                const badge = document.createElement('span');
                badge.textContent = o.badge;
                badge.style.cssText = `font-size:9px; font-weight:700; color:#0f1420; background:${border}; padding:0 5px; border-radius:5px;`;
                header.appendChild(badge);
            }

            el.appendChild(header);
        }

        for (const child of o.children ?? []) {
            el.appendChild(child);
        }

        return el;
    }

}
