import { RectColor } from './RectColor';
import { RectRandom } from './RectRandom';
import {
    BarStripOptions,
    FeatureColumnOptions,
    HeatmapOptions,
    MatrixOptions,
    NetworkOptions,
    ScatterOptions,
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

/** 2D point cloud — the "cursor x·y / output" look. */
export class Scatter extends RectChart {

    public constructor(private readonly options: ScatterOptions = {}) {
        super();
    }

    public render(): SVGSVGElement {
        const count = this.options.count ?? 26;
        const width = this.options.width ?? 96;
        const height = this.options.height ?? 54;
        const dot = this.options.dot ?? 2;
        const spread = Math.max(0, Math.min(1, this.options.spread ?? 0.35));
        const accent = RectColor.resolve(this.options.accent, 'blue');
        const rand = new RectRandom(this.options.seed ?? 19);

        const svg = RectChart.svg(width, height);
        const cx = width / 2;
        const cy = height / 2;
        const pad = dot + 1;

        if (this.options.axes) {
            svg.appendChild(RectChart.shape('line', {x1: 0, y1: cy, x2: width, y2: cy, stroke: 'rgba(255,255,255,0.12)', 'stroke-width': 1}));
            svg.appendChild(RectChart.shape('line', {x1: cx, y1: 0, x2: cx, y2: height, stroke: 'rgba(255,255,255,0.12)', 'stroke-width': 1}));
        }
        if (this.options.target) {
            for (const r of [Math.min(width, height) * 0.18, Math.min(width, height) * 0.34]) {
                svg.appendChild(RectChart.shape('circle', {cx: cx, cy: cy, r: r, fill: 'none', stroke: 'rgba(255,255,255,0.16)', 'stroke-width': 1}));
            }
        }

        for (let i = 0; i < count; i++) {
            // pull points toward the center as `spread` rises
            const fx = cx + (rand.next() - 0.5) * (width - 2 * pad) * (1 - spread);
            const fy = cy + (rand.next() - 0.5) * (height - 2 * pad) * (1 - spread);
            svg.appendChild(RectChart.shape('circle', {
                cx: fx.toFixed(1), cy: fy.toFixed(1), r: dot,
                fill: accent, 'fill-opacity': (0.45 + rand.next() * 0.5).toFixed(2)
            }));
        }

        return svg;
    }

}

/** A heatmap grid with row (left) and column (top) axis labels. */
export class Matrix extends RectChart {

    public constructor(private readonly options: MatrixOptions = {}) {
        super();
    }

    public render(): SVGSVGElement {
        const rowLabels = this.options.rowLabels ?? [];
        const colLabels = this.options.colLabels ?? [];
        const rows = this.options.rows ?? Math.max(1, rowLabels.length || 4);
        const cols = this.options.cols ?? Math.max(1, colLabels.length || 8);
        const cell = this.options.cell ?? 11;
        const gap = this.options.gap ?? 2;
        const accent = this.options.accent ?? 'cyan';
        const rand = new RectRandom(this.options.seed ?? 29);

        const longestRow = rowLabels.reduce((m, s) => Math.max(m, s.length), 0);
        const marginLeft = rowLabels.length > 0 ? longestRow * 5.4 + 6 : 0;
        const marginTop = colLabels.length > 0 ? 13 : 0;
        const gridW = cols * (cell + gap) - gap;
        const gridH = rows * (cell + gap) - gap;
        const svg = RectChart.svg(marginLeft + gridW, marginTop + gridH);

        colLabels.forEach((label, c) => {
            const text = RectChart.shape('text', {
                x: (marginLeft + c * (cell + gap) + cell / 2).toFixed(1), y: marginTop - 4,
                'text-anchor': 'middle', fill: '#8595b5', 'font-size': 8.5, 'font-family': 'system-ui, sans-serif'
            });
            text.textContent = label;
            svg.appendChild(text);
        });

        rowLabels.forEach((label, r) => {
            const text = RectChart.shape('text', {
                x: marginLeft - 5, y: (marginTop + r * (cell + gap) + cell / 2 + 3).toFixed(1),
                'text-anchor': 'end', fill: '#8595b5', 'font-size': 8.5, 'font-family': 'system-ui, sans-serif'
            });
            text.textContent = label;
            svg.appendChild(text);
        });

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const v = Math.pow(rand.next(), 1.3);
                svg.appendChild(RectChart.shape('rect', {
                    x: marginLeft + c * (cell + gap), y: marginTop + r * (cell + gap),
                    width: cell, height: cell, rx: 1.5, fill: RectColor.shade(accent, 0.12 + v * 0.88)
                }));
            }
        }

        return svg;
    }

}

/** A small layered node-link diagram — the "feed-forward network" look. */
export class Network extends RectChart {

    public constructor(private readonly options: NetworkOptions = {}) {
        super();
    }

    public render(): SVGSVGElement {
        const layers = this.options.layers ?? [3, 5, 2];
        const width = this.options.width ?? 110;
        const height = this.options.height ?? 64;
        const node = this.options.node ?? 3.5;
        const accent = RectColor.resolve(this.options.accent, 'blue');
        const rand = new RectRandom(this.options.seed ?? 23);

        const svg = RectChart.svg(width, height);
        const pad = node + 3;
        const cols = layers.length;
        const xs = layers.map((_, i) => cols === 1 ? width / 2 : pad + ((width - 2 * pad) * i) / (cols - 1));
        const ys = layers.map((n) => Array.from({length: n}, (_, j) =>
            n === 1 ? height / 2 : pad + ((height - 2 * pad) * j) / (n - 1)));

        // edges between consecutive layers (behind the nodes)
        for (let l = 0; l < cols - 1; l++) {
            for (const y1 of ys[l] as number[]) {
                for (const y2 of ys[l + 1] as number[]) {
                    svg.appendChild(RectChart.shape('line', {
                        x1: xs[l] as number, y1: y1, x2: xs[l + 1] as number, y2: y2,
                        stroke: accent, 'stroke-opacity': (0.1 + rand.next() * 0.3).toFixed(2), 'stroke-width': 0.8
                    }));
                }
            }
        }
        for (let l = 0; l < cols; l++) {
            for (const y of ys[l] as number[]) {
                svg.appendChild(RectChart.shape('circle', {cx: xs[l] as number, cy: y, r: node, fill: RectColor.shade(accent, 0.75)}));
            }
        }

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

        const ticks = this.options.ticks ?? [];
        const tickH = ticks.length > 0 ? 14 : 0;
        const width = count * (cell + gap) - gap;
        const svg = RectChart.svg(width, height + tickH);

        for (let i = 0; i < count; i++) {
            const v = rand.next();
            const fill = v > faultThreshold ? faultColor : RectColor.shade(accent, 0.2 + v * 0.8);
            svg.appendChild(RectChart.shape('rect', {
                x: i * (cell + gap), y: 0, width: cell, height: height, rx: 1.5, fill: fill
            }));
        }

        if (this.options.cursor !== undefined) {
            const cx = Math.max(0, Math.min(1, this.options.cursor)) * width;
            svg.appendChild(RectChart.shape('line', {
                x1: cx, y1: -2, x2: cx, y2: height + 2, stroke: '#e8eefc', 'stroke-width': 1.4
            }));
        }

        ticks.forEach((label, i) => {
            const tx = ticks.length === 1 ? width / 2 : (width * i) / (ticks.length - 1);
            const text = RectChart.shape('text', {
                x: tx.toFixed(1), y: height + 11,
                'text-anchor': i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle',
                fill: '#8595b5', 'font-size': 9, 'font-family': 'system-ui, sans-serif'
            });
            text.textContent = label;
            svg.appendChild(text);
        });

        return svg;
    }

}
