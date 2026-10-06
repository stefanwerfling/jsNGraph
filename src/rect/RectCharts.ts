import { RectColor } from './RectColor';
import { RectRandom } from './RectRandom';
import {
    BarStripOptions,
    FeatureColumnOptions,
    HeatmapOptions,
    SparklineOptions,
    TimelineOptions
} from './RectKitTypes';

/**
 * Base for the rect-kit mini-charts: shared inline-SVG construction helpers so
 * each chart just describes its shapes. Every chart renders to a standalone
 * <svg> that scales crisply (unlike a canvas) under a transformed board.
 */
abstract class RectChart {

    protected static readonly NS = 'http://www.w3.org/2000/svg';

    public abstract render(): SVGSVGElement;

    protected static svg(width: number, height: number): SVGSVGElement {
        const node = document.createElementNS(RectChart.NS, 'svg') as SVGSVGElement;
        node.setAttribute('width', String(width));
        node.setAttribute('height', String(height));
        node.setAttribute('viewBox', `0 0 ${width} ${height}`);
        node.style.display = 'block';

        return node;
    }

    protected static shape(name: string, attrs: Record<string, string | number>): SVGElement {
        const node = document.createElementNS(RectChart.NS, name);

        for (const key of Object.keys(attrs)) {
            node.setAttribute(key, String(attrs[key]));
        }

        return node;
    }

}

/**
 * Grid of cells coloured by (deterministic) intensity — the "spike / channel"
 * matrix look.
 */
export class Heatmap extends RectChart {

    public constructor(private readonly options: HeatmapOptions = {}) {
        super();
    }

    public render(): SVGSVGElement {
        const rows = this.options.rows ?? 5;
        const cols = this.options.cols ?? 10;
        const cell = this.options.cell ?? 9;
        const gap = this.options.gap ?? 2;
        const accent = this.options.accent ?? 'cyan';
        const rand = new RectRandom(this.options.seed ?? 7);

        const width = cols * (cell + gap) - gap;
        const height = rows * (cell + gap) - gap;
        const svg = RectChart.svg(width, height);

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const v = Math.pow(rand.next(), 1.4);
                svg.appendChild(RectChart.shape('rect', {
                    x: c * (cell + gap), y: r * (cell + gap), width: cell, height: cell,
                    rx: 1.5, fill: RectColor.shade(accent, 0.1 + v * 0.9)
                }));
            }
        }

        return svg;
    }

}

/** Vertical bar chart — the "binning / feature extraction" look. */
export class BarStrip extends RectChart {

    public constructor(private readonly options: BarStripOptions = {}) {
        super();
    }

    public render(): SVGSVGElement {
        const count = this.options.count ?? 12;
        const barWidth = this.options.barWidth ?? 6;
        const gap = this.options.gap ?? 3;
        const height = this.options.height ?? 52;
        const accent = this.options.accent ?? 'amber';
        const rand = new RectRandom(this.options.seed ?? 11);

        const width = count * (barWidth + gap) - gap;
        const svg = RectChart.svg(width, height);
        svg.appendChild(RectChart.shape('line', {
            x1: 0, y1: height - 0.5, x2: width, y2: height - 0.5,
            stroke: 'rgba(255,255,255,0.12)', 'stroke-width': 1
        }));

        for (let i = 0; i < count; i++) {
            const v = 0.18 + rand.next() * 0.82;
            const barHeight = Math.max(2, v * (height - 4));
            svg.appendChild(RectChart.shape('rect', {
                x: i * (barWidth + gap), y: height - barHeight, width: barWidth, height: barHeight,
                rx: 1.5, fill: RectColor.shade(accent, 0.45 + v * 0.55)
            }));
        }

        return svg;
    }

}

/** Tall stacked column — the "feature vector" look. */
export class FeatureColumn extends RectChart {

    public constructor(private readonly options: FeatureColumnOptions = {}) {
        super();
    }

    public render(): SVGSVGElement {
        const rows = this.options.rows ?? 10;
        const width = this.options.width ?? 16;
        const cellHeight = this.options.cellHeight ?? 9;
        const gap = this.options.gap ?? 2;
        const accent = this.options.accent ?? 'cyan';
        const rand = new RectRandom(this.options.seed ?? 5);

        const height = rows * (cellHeight + gap) - gap;
        const svg = RectChart.svg(width, height);

        for (let r = 0; r < rows; r++) {
            const v = rand.next();
            svg.appendChild(RectChart.shape('rect', {
                x: 0, y: r * (cellHeight + gap), width: width, height: cellHeight,
                rx: 2, fill: RectColor.shade(accent, 0.15 + v * 0.85)
            }));
        }

        return svg;
    }

}

/** Filled line chart — the "decoder output" look. */
export class Sparkline extends RectChart {

    public constructor(private readonly options: SparklineOptions = {}) {
        super();
    }

    public render(): SVGSVGElement {
        const count = this.options.count ?? 24;
        const width = this.options.width ?? 110;
        const height = this.options.height ?? 44;
        const accent = RectColor.resolve(this.options.accent, 'green');
        const rand = new RectRandom(this.options.seed ?? 13);

        const svg = RectChart.svg(width, height);
        const points: Array<[number, number]> = [];
        let y = 0.5;

        for (let i = 0; i < count; i++) {
            y = Math.max(0.08, Math.min(0.92, y + (rand.next() - 0.5) * 0.4));
            points.push([(i / (count - 1)) * width, height - (y * (height - 6) + 3)]);
        }

        const line = points
            .map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1))
            .join(' ');
        const area = `${line} L ${width} ${height} L 0 ${height} Z`;

        svg.appendChild(RectChart.shape('path', {d: area, fill: accent, 'fill-opacity': 0.12}));
        svg.appendChild(RectChart.shape('path', {
            d: line, fill: 'none', stroke: accent, 'stroke-width': 1.6, 'stroke-linejoin': 'round'
        }));

        return svg;
    }

}

/** Long horizontal strip of cells — the "lifetime / status timeline" look. */
export class Timeline extends RectChart {

    public constructor(private readonly options: TimelineOptions = {}) {
        super();
    }

    public render(): SVGSVGElement {
        const count = this.options.count ?? 40;
        const cell = this.options.cell ?? 7;
        const gap = this.options.gap ?? 2;
        const height = this.options.height ?? 16;
        const accent = this.options.accent ?? 'green';
        const faultThreshold = this.options.faultThreshold ?? 0.9;
        const faultColor = this.options.faultColor ?? '#ff6a6a';
        const rand = new RectRandom(this.options.seed ?? 17);

        const width = count * (cell + gap) - gap;
        const svg = RectChart.svg(width, height);

        for (let i = 0; i < count; i++) {
            const v = rand.next();
            const fill = v > faultThreshold ? faultColor : RectColor.shade(accent, 0.2 + v * 0.8);
            svg.appendChild(RectChart.shape('rect', {
                x: i * (cell + gap), y: 0, width: cell, height: height, rx: 1.5, fill: fill
            }));
        }

        return svg;
    }

}
