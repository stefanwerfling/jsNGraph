import { RectAnim } from './RectAnim';
import { RectColor } from './RectColor';
import { RectArrowOptions, RectBoxOptions, RectDirection, RectPipelineOptions } from './RectKitTypes';

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
        const shadow = RectBox.ring(border, o.accent !== undefined);

        el.style.cssText = `
            position: relative;
            display: inline-flex;
            flex-direction: column;
            gap: 6px;
            padding: 9px 11px 10px;
            border-radius: 10px;
            background: ${o.background ?? 'rgba(18, 25, 42, 0.78)'};
            border: 1px ${o.dashed ? 'dashed' : 'solid'} ${border};
            box-shadow: ${shadow};
            color: #e8eefc;
            font: 12px system-ui, sans-serif;
        `;

        if (o.glow) {
            RectAnim.ensure();
            const ring = document.createElement('div');
            ring.style.cssText = `
                position: absolute; inset: -1px; border-radius: 10px; pointer-events: none;
                border: 1.5px solid ${border}; animation: ${RectAnim.PULSE} 1.6s ease-in-out infinite;
            `;
            el.appendChild(ring);
        }

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
 * RectBox blocks in a RectPipeline. Points right by default; set `direction`
 * to 'down' / 'left' / 'up' for vertical or reversed flows.
 */
export class RectArrow {

    private static readonly NS = 'http://www.w3.org/2000/svg';

    public constructor(private readonly options: RectArrowOptions = {}) {}

    public render(): HTMLDivElement {
        const direction = this.options.direction ?? 'right';
        const vertical = direction === 'down' || direction === 'up';
        const width = this.options.width ?? (vertical ? 22 : 36);
        const height = this.options.height ?? (vertical ? 36 : 22);
        const stroke = RectColor.resolve(this.options.color, 'slate');

        const wrap = document.createElement('div');
        // label sits above a horizontal arrow / beside a vertical one
        wrap.style.cssText = `flex:0 0 auto; display:flex; align-items:center; justify-content:center; gap:3px; flex-direction:${vertical ? 'row' : 'column'};`;

        if (this.options.label !== undefined && !vertical) {
            wrap.appendChild(RectArrow.labelEl(this.options.label));
        }

        const svg = document.createElementNS(RectArrow.NS, 'svg');
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

        const {line, head} = RectArrow.geometry(direction, width, height);

        const lineEl = document.createElementNS(RectArrow.NS, 'line');
        lineEl.setAttribute('x1', String(line[0]));
        lineEl.setAttribute('y1', String(line[1]));
        lineEl.setAttribute('x2', String(line[2]));
        lineEl.setAttribute('y2', String(line[3]));
        lineEl.setAttribute('stroke', stroke);
        lineEl.setAttribute('stroke-width', '1.6');

        if (this.options.animated) {
            RectAnim.ensure();
            lineEl.setAttribute('stroke-dasharray', '5 4');
            lineEl.style.animation = `${RectAnim.FLOW} 0.7s linear infinite`;
        } else if (this.options.dashed) {
            lineEl.setAttribute('stroke-dasharray', '3 3');
        }

        const headEl = document.createElementNS(RectArrow.NS, 'path');
        headEl.setAttribute('d', head);
        headEl.setAttribute('fill', stroke);

        svg.appendChild(lineEl);
        svg.appendChild(headEl);

        if (this.options.dots) {
            RectAnim.ensure();
            const d = `path("M ${line[0]} ${line[1]} L ${line[2]} ${line[3]}")`;
            for (let i = 0; i < 3; i++) {
                const dot = document.createElementNS(RectArrow.NS, 'circle');
                dot.setAttribute('r', '2');
                dot.setAttribute('cx', '0');
                dot.setAttribute('cy', '0');
                dot.setAttribute('fill', stroke);
                dot.style.offsetPath = d;
                dot.style.offsetRotate = '0deg';
                dot.style.animation = `${RectAnim.TRAVEL} 1.1s linear infinite`;
                dot.style.animationDelay = `${(i * 0.37).toFixed(2)}s`;
                svg.appendChild(dot);
            }
        }

        wrap.appendChild(svg);

        if (this.options.label !== undefined && vertical) {
            wrap.appendChild(RectArrow.labelEl(this.options.label));
        }

        return wrap;
    }

    private static labelEl(text: string): HTMLSpanElement {
        const span = document.createElement('span');
        span.textContent = text;
        span.style.cssText = 'font:9.5px system-ui,sans-serif; color:#8595b5; white-space:nowrap;';

        return span;
    }

    /** Line endpoints [x1,y1,x2,y2] and arrowhead path for a given direction. */
    private static geometry(direction: RectDirection, w: number, h: number): {line: [number, number, number, number]; head: string} {
        const mx = w / 2;
        const my = h / 2;

        switch (direction) {
            case 'down':
                return {line: [mx, 2, mx, h - 8], head: `M${mx - 4} ${h - 9} L${mx} ${h - 2} L${mx + 4} ${h - 9} Z`};
            case 'up':
                return {line: [mx, h - 2, mx, 8], head: `M${mx - 4} 9 L${mx} 2 L${mx + 4} 9 Z`};
            case 'left':
                return {line: [w - 2, my, 8, my], head: `M9 ${my - 4} L2 ${my} L9 ${my + 4} Z`};
            default:
                return {line: [2, my, w - 8, my], head: `M${w - 9} ${my - 4} L${w - 2} ${my} L${w - 9} ${my + 4} Z`};
        }
    }

}

/**
 * A row (or column) of RectBox stages wired with RectArrow connectors between
 * them — the canonical "signal → … → output" pipeline. Horizontal by default;
 * set `direction: 'down'` for a top-to-bottom flow.
 */
export class RectPipeline {

    public constructor(
        private readonly stages: Array<RectBox | HTMLElement>,
        private readonly options: RectPipelineOptions = {}
    ) {}

    public render(): HTMLDivElement {
        const direction = this.options.direction ?? 'right';
        const vertical = direction === 'down' || direction === 'up';

        const row = document.createElement('div');
        row.style.cssText = `display:flex; align-items:center; flex-wrap:nowrap; flex-direction:${vertical ? 'column' : 'row'};`;

        this.stages.forEach((stage, i) => {
            if (i > 0) {
                const span = this.options.gap;
                const label = this.options.labels?.[i - 1];
                row.appendChild(new RectArrow({
                    direction: direction,
                    width: vertical ? undefined : span,
                    height: vertical ? span : undefined,
                    color: this.options.arrowColor,
                    dashed: this.options.dashed,
                    animated: this.options.animated,
                    dots: this.options.dots,
                    label: label
                }).render());
            }

            row.appendChild(stage instanceof RectBox ? stage.render() : stage);
        });

        return row;
    }

}
