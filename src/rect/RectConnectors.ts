import { RectAnim } from './RectAnim';
import { RectColor } from './RectColor';
import { RectBranchOptions, RectDirection, RectElbowOptions, RectSide } from './RectKitTypes';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(name: string, attrs: Record<string, string | number>): SVGElement {
    const node = document.createElementNS(NS, name);

    for (const key of Object.keys(attrs)) {
        node.setAttribute(key, String(attrs[key]));
    }

    return node;
}

function svgRoot(width: number, height: number): SVGSVGElement {
    const svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.display = 'block';

    return svg;
}

/** Apply dash / flowing-dash animation to a stroked SVG element. */
function applyDash(el: SVGElement, dashed: boolean | undefined, animated: boolean | undefined): void {
    if (animated) {
        RectAnim.ensure();
        el.setAttribute('stroke-dasharray', '5 4');
        (el as unknown as HTMLElement).style.animation = `${RectAnim.FLOW} 0.7s linear infinite`;
    } else if (dashed) {
        el.setAttribute('stroke-dasharray', '3 3');
    }
}

/** A tiny arrowhead polygon with its tip at (x, y), pointing the given way. */
function head(x: number, y: number, dir: RectDirection, fill: string): SVGElement {
    const s = 4.5;
    let points: string;

    switch (dir) {
        case 'right': points = `${x - 7},${y - s} ${x - 7},${y + s} ${x},${y}`; break;
        case 'left':  points = `${x + 7},${y - s} ${x + 7},${y + s} ${x},${y}`; break;
        case 'down':  points = `${x - s},${y - 7} ${x + s},${y - 7} ${x},${y}`; break;
        default:      points = `${x - s},${y + 7} ${x + s},${y + 7} ${x},${y}`; break;
    }

    return svgEl('polygon', {points: points, fill: fill});
}

/** The arrowhead direction that points out of a given box edge. */
function sideToDir(side: RectSide): RectDirection {
    switch (side) {
        case 'left': return 'left';
        case 'right': return 'right';
        case 'top': return 'up';
        default: return 'down';
    }
}

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
        const svg = svgRoot(w, h);

        const path = svgEl('path', {
            d: `M${sx} ${sy} L${corner[0]} ${corner[1]} L${ex} ${ey}`,
            fill: 'none', stroke: stroke, 'stroke-width': 1.6
        });
        applyDash(path, o.dashed, o.animated);
        svg.appendChild(path);

        if (o.arrow !== false) {
            svg.appendChild(head(ex, ey, sideToDir(to), stroke));
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
        const svg = svgRoot(w, h);

        const line = (x1: number, y1: number, x2: number, y2: number): void => {
            const el = svgEl('line', {x1: x1, y1: y1, x2: x2, y2: y2, stroke: stroke, 'stroke-width': 1.6});
            applyDash(el, o.dashed, o.animated);
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
                svg.appendChild(head(endX, y, direction, stroke));
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
                svg.appendChild(head(x, endY, direction, stroke));
            }
        }

        wrap.appendChild(svg);

        return wrap;
    }

}
