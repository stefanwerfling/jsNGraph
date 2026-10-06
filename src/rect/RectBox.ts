import { RectColor } from './RectColor';
import { RectArrowOptions, RectBoxOptions, RectPipelineOptions } from './RectKitTypes';

/**
 * A labeled rectangle block in the style of a wiring diagram: title, optional
 * subtitle, a top-left badge, a dashed or accent-coloured border and an inner
 * body (usually one of the rect-kit mini-charts). Plain DOM with inline styles
 * — no stylesheet needed — so it drops into any container and scales with it.
 */
export class RectBox {

    public constructor(private readonly options: RectBoxOptions = {}) {}

    public render(): HTMLDivElement {
        const o = this.options;
        const el = document.createElement('div');
        const border = o.accent ? RectColor.resolve(o.accent) : '#33415f';
        const glow = RectBox.ring(border, o.accent !== undefined);

        el.style.cssText = `
            position: relative;
            display: inline-flex;
            flex-direction: column;
            gap: 6px;
            padding: 9px 11px 10px;
            border-radius: 10px;
            background: ${o.background ?? 'rgba(18, 25, 42, 0.78)'};
            border: 1px ${o.dashed ? 'dashed' : 'solid'} ${border};
            box-shadow: ${glow};
            color: #e8eefc;
            font: 12px system-ui, sans-serif;
        `;

        if (o.badge !== undefined) {
            const badge = document.createElement('div');
            badge.textContent = o.badge;
            badge.style.cssText = `
                position: absolute; top: -8px; left: 10px;
                font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
                padding: 1px 6px; border-radius: 6px;
                background: #0f1420; border: 1px solid ${border}; color: #8595b5;
            `;
            el.appendChild(badge);
        }

        if (o.title !== undefined) {
            const title = document.createElement('div');
            title.textContent = o.title;
            title.style.cssText = 'font-size:12px; font-weight:700; line-height:1.12;';
            el.appendChild(title);
        }

        if (o.subtitle !== undefined) {
            const sub = document.createElement('div');
            sub.textContent = o.subtitle;
            sub.style.cssText = 'font-size:10.5px; color:#8595b5; line-height:1.12; margin-top:-2px;';
            el.appendChild(sub);
        }

        if (o.body !== undefined) {
            const body = document.createElement('div');
            body.style.cssText = 'margin-top:3px; display:flex;';
            body.appendChild(o.body);
            el.appendChild(body);
        }

        if (o.caption !== undefined) {
            const caption = document.createElement('div');
            caption.textContent = o.caption;
            caption.style.cssText = 'font-size:10px; color:#8595b5; text-align:center; margin-top:4px;';
            el.appendChild(caption);
        }

        return el;
    }

    private static ring(border: string, accented: boolean): string {
        const base = '0 6px 20px rgba(0, 0, 0, 0.28)';

        if (accented && border.startsWith('#')) {
            return `0 0 0 1px ${border}2e, ${base}`;
        }

        return base;
    }

}

/**
 * A short arrow connector drawn as inline SVG, meant to sit between two
 * RectBox blocks in a RectPipeline.
 */
export class RectArrow {

    private static readonly NS = 'http://www.w3.org/2000/svg';

    public constructor(private readonly options: RectArrowOptions = {}) {}

    public render(): HTMLDivElement {
        const width = this.options.width ?? 36;
        const height = this.options.height ?? 22;
        const stroke = RectColor.resolve(this.options.color, 'slate');
        const mid = height / 2;

        const wrap = document.createElement('div');
        wrap.style.cssText = 'flex:0 0 auto; display:flex; align-items:center;';

        const svg = document.createElementNS(RectArrow.NS, 'svg');
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

        const line = document.createElementNS(RectArrow.NS, 'line');
        line.setAttribute('x1', '2');
        line.setAttribute('y1', String(mid));
        line.setAttribute('x2', String(width - 8));
        line.setAttribute('y2', String(mid));
        line.setAttribute('stroke', stroke);
        line.setAttribute('stroke-width', '1.6');

        if (this.options.dashed) {
            line.setAttribute('stroke-dasharray', '3 3');
        }

        const head = document.createElementNS(RectArrow.NS, 'path');
        head.setAttribute('d', `M${width - 9} ${mid - 4} L${width - 2} ${mid} L${width - 9} ${mid + 4} Z`);
        head.setAttribute('fill', stroke);

        svg.appendChild(line);
        svg.appendChild(head);
        wrap.appendChild(svg);

        return wrap;
    }

}

/**
 * A horizontal row of RectBox stages wired left-to-right with RectArrow
 * connectors between them — the canonical "signal → … → output" pipeline.
 */
export class RectPipeline {

    public constructor(
        private readonly stages: Array<RectBox | HTMLElement>,
        private readonly options: RectPipelineOptions = {}
    ) {}

    public render(): HTMLDivElement {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; flex-wrap:nowrap;';

        this.stages.forEach((stage, i) => {
            if (i > 0) {
                row.appendChild(new RectArrow({
                    width: this.options.gap,
                    color: this.options.arrowColor,
                    dashed: this.options.dashed
                }).render());
            }

            row.appendChild(stage instanceof RectBox ? stage.render() : stage);
        });

        return row;
    }

}
