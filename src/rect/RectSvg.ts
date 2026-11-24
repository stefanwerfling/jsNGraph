import { RectAnim } from './RectAnim';
import { RectDirection, RectSide } from './RectKitTypes';

/**
 * Small SVG helpers shared by the rect connectors: element factory, sized
 * root, dash/flow styling, arrowheads and travelling dots. Internal to the
 * rect kit (not exported from the package).
 */
export class RectSvg {

    public static readonly NS = 'http://www.w3.org/2000/svg';

    public static el(name: string, attrs: Record<string, string | number>): SVGElement {
        const node = document.createElementNS(RectSvg.NS, name);

        for (const key of Object.keys(attrs)) {
            node.setAttribute(key, String(attrs[key]));
        }

        return node;
    }

    public static root(width: number, height: number): SVGSVGElement {
        const svg = document.createElementNS(RectSvg.NS, 'svg') as SVGSVGElement;
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.style.display = 'block';

        return svg;
    }

    /** Apply dash / flowing-dash animation to a stroked SVG element. */
    public static applyDash(el: SVGElement, dashed: boolean | undefined, animated: boolean | undefined): void {
        if (animated) {
            RectAnim.ensure();
            el.setAttribute('stroke-dasharray', '5 4');
            (el as unknown as HTMLElement).style.animation = `${RectAnim.FLOW} 0.7s linear infinite`;
        } else if (dashed) {
            el.setAttribute('stroke-dasharray', '3 3');
        }
    }

    /** A tiny arrowhead polygon with its tip at (x, y), pointing the given way. */
    public static head(x: number, y: number, dir: RectDirection, fill: string): SVGElement {
        const s = 4.5;
        let points: string;

        switch (dir) {
            case 'right': points = `${x - 7},${y - s} ${x - 7},${y + s} ${x},${y}`; break;
            case 'left':  points = `${x + 7},${y - s} ${x + 7},${y + s} ${x},${y}`; break;
            case 'down':  points = `${x - s},${y - 7} ${x + s},${y - 7} ${x},${y}`; break;
            default:      points = `${x - s},${y + 7} ${x + s},${y + 7} ${x},${y}`; break;
        }

        return RectSvg.el('polygon', {points: points, fill: fill});
    }

    /** The arrowhead direction that points out of a given box edge. */
    public static sideToDir(side: RectSide): RectDirection {
        switch (side) {
            case 'left': return 'left';
            case 'right': return 'right';
            case 'top': return 'up';
            default: return 'down';
        }
    }

    /** Send travelling dots along an arbitrary SVG path (visible flow/recurrence). */
    public static travelDots(svg: SVGSVGElement, d: string, fill: string, count = 3): void {
        RectAnim.ensure();

        for (let i = 0; i < count; i++) {
            const dot = document.createElementNS(RectSvg.NS, 'circle');
            dot.setAttribute('r', '2');
            dot.setAttribute('cx', '0');
            dot.setAttribute('cy', '0');
            dot.setAttribute('fill', fill);
            dot.style.offsetPath = `path("${d}")`;
            dot.style.offsetRotate = '0deg';
            dot.style.animation = `${RectAnim.TRAVEL} 1.3s linear infinite`;
            dot.style.animationDelay = `${(i * 0.43).toFixed(2)}s`;
            svg.appendChild(dot);
        }
    }

}
