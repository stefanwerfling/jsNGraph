/**
 * Accent colour for a rect element — one of the built-in palette keys or any
 * CSS/hex colour string.
 */
export type RectAccent = 'amber' | 'green' | 'cyan' | 'violet' | 'blue' | 'slate' | string;

/**
 * A rect element body is any renderable DOM/SVG node (typically one of the
 * mini-chart classes' `render()` output).
 */
export type RectBody = SVGElement | HTMLElement;

export interface RectBoxOptions {
    title?: string;
    /** Second, dimmer line under the title. */
    subtitle?: string;
    /** Small pill on the top-left border (e.g. 'IN' / 'OUT'). */
    badge?: string;
    /** Coloured border + glow. */
    accent?: RectAccent;
    /** Dashed border instead of solid. */
    dashed?: boolean;
    /** Inner content, usually a mini-chart. */
    body?: RectBody;
    /** Dim caption line under the body. */
    caption?: string;
    /** Override the default dark box background. */
    background?: string;
}

export interface RectChartOptions {
    /** Seed for the deterministic value generator, so a chart never flickers. */
    seed?: number;
    accent?: RectAccent;
}

export interface HeatmapOptions extends RectChartOptions {
    rows?: number;
    cols?: number;
    /** Cell size in px. */
    cell?: number;
    gap?: number;
}

export interface BarStripOptions extends RectChartOptions {
    count?: number;
    barWidth?: number;
    gap?: number;
    height?: number;
}

export interface FeatureColumnOptions extends RectChartOptions {
    rows?: number;
    width?: number;
    cellHeight?: number;
    gap?: number;
}

export interface SparklineOptions extends RectChartOptions {
    count?: number;
    width?: number;
    height?: number;
}

export interface TimelineOptions extends RectChartOptions {
    count?: number;
    cell?: number;
    gap?: number;
    height?: number;
    /** Cells above this value are drawn in the fault colour. */
    faultThreshold?: number;
    faultColor?: string;
}

export interface RectArrowOptions {
    width?: number;
    height?: number;
    color?: RectAccent;
    dashed?: boolean;
}

export interface RectPipelineOptions {
    /** Horizontal space reserved for each arrow connector, in px. */
    gap?: number;
    arrowColor?: RectAccent;
    dashed?: boolean;
}
