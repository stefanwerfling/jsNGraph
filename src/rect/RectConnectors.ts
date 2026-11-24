import { RectColor } from './RectColor';
import { RectBranchOptions, RectElbowOptions, RectLoopOptions, RectSide } from './RectKitTypes';
import { RectSvg } from './RectSvg';

/**
 * An L-shaped (right-angle) connector between two perpendicular edges — the
 * "route around the corner" link of a wiring diagram. `from`/`to` name the
 * edges it leaves and arrives at; an arrowhead marks the arrival by default.
 */
export class RectElbow {

    public constructor(private readonly options: RectElbowOptions = {}) {}

    public render(): HTMLDivElement {
        const o = this.options;
        const from = o.from ?? 'left';
        const to = o.to ?? 'bottom';
        const w = o.width ?? 48;
        const h = o.height ?? 40;
        const stroke = RectColor.resolve(o.color, 'slate');

        const edge = (side: RectSide): [number, number] => {
            switch (side) {
                case 'left': return [0, h / 2];
                case 'right': return [w, h / 2];
                case 'top': return [w / 2, 0];
                default: return [w / 2, h];
            }
        };

        const [sx, sy] = edge(from);
        const [ex, ey] = edge(to);
        const fromHorizontal = from === 'left' || from === 'right';
        const toVertical = to === 'top' || to === 'bottom';
        // corner sits where the two edge-normals meet
        const corner: [number, number] = (fromHorizontal && toVertical)
            ? [ex, sy]
            : (!fromHorizontal && !toVertical)
                ? [sx, ey]
                : [ex, sy]; // same-orientation fallback

        const wrap = document.createElement('div');
        wrap.style.cssText = 'flex:0 0 auto; display:flex;';
        const svg = RectSvg.root(w, h);

        const path = RectSvg.el('path', {
            d: `M${sx} ${sy} L${corner[0]} ${corner[1]} L${ex} ${ey}`,
            fill: 'none', stroke: stroke, 'stroke-width': 1.6
        });
        RectSvg.applyDash(path, o.dashed, o.animated);
        svg.appendChild(path);

        if (o.arrow !== false) {
            svg.appendChild(RectSvg.head(ex, ey, RectSvg.sideToDir(to), stroke));
        }

        wrap.appendChild(svg);

        return wrap;
    }

}

/**
 * A curved feedback / loop connector: an arc that bows over (or under) a flow
 * and points back — the recurrence of a wiring diagram (e.g. "mask resampling"
 * feeding the input again, or a recurrent state feeding itself).
 */
export class RectLoop {

    public constructor(private readonly options: RectLoopOptions = {}) {}

    public render(): HTMLDivElement {
        const o = this.options;
        const self = o.self === true;
        const below = o.below === true;
        const w = o.width ?? (self ? 46 : 150);
        const h = o.height ?? (self ? 26 : 42);
        const stroke = RectColor.resolve(o.color, 'slate');

        const wrap = document.createElement('div');
        wrap.style.cssText = 'flex:0 0 auto; display:flex;';
        const svg = RectSvg.root(w, h);

        const baseY = below ? 1 : h - 1;
        const topY = below ? h - 1 : 1;

        let startX: number;
        let endX: number;
        let d: string;

        if (self) {
            const cx = w / 2;
            startX = cx + 7;
            endX = cx - 7;
            d = `M ${startX} ${baseY} C ${cx + 16} ${topY} ${cx - 16} ${topY} ${endX} ${baseY}`;
        } else {
            const inset = 8;
            startX = w - inset;
            endX = inset;
            d = `M ${startX} ${baseY} C ${startX} ${topY} ${endX} ${topY} ${endX} ${baseY}`;
        }

        const path = RectSvg.el('path', {d: d, fill: 'none', stroke: stroke, 'stroke-width': 1.6});
        RectSvg.applyDash(path, o.dashed, o.animated);
        svg.appendChild(path);
        svg.appendChild(RectSvg.head(endX, baseY, below ? 'up' : 'down', stroke));

        if (o.dots) {
            RectSvg.travelDots(svg, d, stroke);
        }

        if (o.label !== undefined) {
            const text = RectSvg.el('text', {
                x: w / 2, y: below ? h - 3 : 9, 'text-anchor': 'middle',
                fill: '#8595b5', 'font-size': 9.5, 'font-family': 'system-ui, sans-serif'
            });
            text.textContent = o.label;
            svg.appendChild(text);
        }

        wrap.appendChild(svg);

        return wrap;
    }

}

/**
 * A 1→n fan-out connector: a trunk from one side, a spine, and `count`
 * branches to the opposite side, each tipped with an arrowhead — the
 * "one source feeds many" split of a wiring diagram.
 */
export class RectBranch {

    public constructor(private readonly options: RectBranchOptions = {}) {}

    public render(): HTMLDivElement {
        const o = this.options;
        const count = Math.max(1, o.count ?? 3);
        const direction = o.direction ?? 'right';
        const vertical = direction === 'down' || direction === 'up';
        const w = o.width ?? (vertical ? 120 : 56);
        const h = o.height ?? (vertical ? 56 : 120);
        const stroke = RectColor.resolve(o.color, 'slate');

        const wrap = document.createElement('div');
        wrap.style.cssText = 'flex:0 0 auto; display:flex;';
        const svg = RectSvg.root(w, h);

        const line = (x1: number, y1: number, x2: number, y2: number): void => {
            const el = RectSvg.el('line', {x1: x1, y1: y1, x2: x2, y2: y2, stroke: stroke, 'stroke-width': 1.6});
            RectSvg.applyDash(el, o.dashed, o.animated);
            svg.appendChild(el);
        };

        const pad = 6;
        const slots = (extent: number): number[] => count === 1
            ? [extent / 2]
            : Array.from({length: count}, (_, i) => pad + ((extent - 2 * pad) * i) / (count - 1));

        if (!vertical) {
            const forward = direction === 'right';
            const startX = forward ? 0 : w;
            const endX = forward ? w : 0;
            const spineX = forward ? w * 0.4 : w * 0.6;
            const ys = slots(h);
            line(startX, h / 2, spineX, h / 2);                       // trunk
            line(spineX, ys[0] as number, spineX, ys[count - 1] as number); // spine
            for (const y of ys) {
                line(spineX, y, endX, y);                             // branch
                svg.appendChild(RectSvg.head(endX, y, direction, stroke));
            }
        } else {
            const forward = direction === 'down';
            const startY = forward ? 0 : h;
            const endY = forward ? h : 0;
            const spineY = forward ? h * 0.4 : h * 0.6;
            const xs = slots(w);
            line(w / 2, startY, w / 2, spineY);
            line(xs[0] as number, spineY, xs[count - 1] as number, spineY);
            for (const x of xs) {
                line(x, spineY, x, endY);
                svg.appendChild(RectSvg.head(x, endY, direction, stroke));
            }
        }

        wrap.appendChild(svg);

        return wrap;
    }

}
