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
    /** Pulse an accent-coloured glow ring (an 'active' marker). */
    glow?: boolean;
}

export interface RectChartOptions {
    /** Seed for the deterministic value generator, so a chart never flickers. */
    seed?: number;
    accent?: RectAccent;
    /**
     * Stretch to the container width (`width: 100%`, height follows the
     * aspect ratio) instead of a fixed pixel size.
     */
    fluid?: boolean;
    /** Colour of axis/base lines; any CSS colour incl. `var(--x)`. */
    axisColor?: string;
}

/** One data series of a Sparkline in data mode. */
export interface SparklineSeries {
    points: Array<{x?: number; y: number; title?: string}>;
    /** Any CSS colour incl. `var(--x)`; default the chart accent. */
    color?: string;
    /** Draw a dot per point (default: only for short series). */
    dots?: boolean;
}

export interface HeatmapOptions extends RectChartOptions {
    rows?: number;
    cols?: number;
    /** Cell size in px. */
    cell?: number;
    gap?: number;
    /** Sweep a highlight column left-to-right across the grid (scan line). */
    scan?: boolean;
}

export interface BarStripOptions extends RectChartOptions {
    count?: number;
    barWidth?: number;
    gap?: number;
    height?: number;
    /** Data mode: real values instead of seeded random ones (`count` is ignored). */
    values?: number[];
    /** Data mode: total width in px (default count × (barWidth + gap)). */
    width?: number;
    /** Data mode: scale top (default the largest |value|). */
    max?: number;
    /** Data mode: per-bar tooltip (SVG <title>). */
    titles?: string[];
    /** Data mode: per-bar colour (any CSS colour); default the accent. */
    colors?: Array<string | undefined>;
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
    /** Data mode: one series of y values (shortcut for `series`). */
    values?: number[];
    /** Data mode: several series in one x/y space. */
    series?: SparklineSeries[];
    /** Data mode: fixed y range, e.g. {min: 0}. */
    yMin?: number;
    yMax?: number;
    /** Fill the area under a single series (default true). */
    area?: boolean;
    /** Data mode: dot radius in px (default 2.6). */
    dot?: number;
}

export interface ScatterOptions extends RectChartOptions {
    /** Number of points. */
    count?: number;
    width?: number;
    height?: number;
    /** Dot radius in px. */
    dot?: number;
    /** 0 = points fill the box, 1 = tightly clustered at the center. */
    spread?: number;
    /** Draw faint x/y axes through the center. */
    axes?: boolean;
    /** Draw a target ring at the center (calibration-target look). */
    target?: boolean;
}

export interface NetworkOptions extends RectChartOptions {
    /** Node count per layer, left to right, e.g. [3, 5, 2]. */
    layers?: number[];
    width?: number;
    height?: number;
    /** Node radius in px. */
    node?: number;
}

export interface MatrixOptions extends RectChartOptions {
    rows?: number;
    cols?: number;
    cell?: number;
    gap?: number;
    /** Row labels, drawn down the left edge. */
    rowLabels?: string[];
    /** Column labels, drawn across the top edge. */
    colLabels?: string[];
}

export interface TimelineOptions extends RectChartOptions {
    count?: number;
    cell?: number;
    gap?: number;
    height?: number;
    /** Cells above this value are drawn in the fault colour. */
    faultThreshold?: number;
    faultColor?: string;
    /** Vertical playhead line at this fraction of the width (0..1). */
    cursor?: number;
    /** Tick labels spread evenly under the strip (e.g. ['week 1', …]). */
    ticks?: string[];
    /** Animate the playhead sweeping across the strip. */
    sweep?: boolean;
    /** Data mode: one cell per value, intensity = value / max (`count` is ignored). */
    values?: number[];
    /** Data mode: scale top (default the largest |value|). */
    max?: number;
    /** Data mode: per-cell tooltip (SVG <title>). */
    titles?: string[];
}

/** Direction an arrow points / a pipeline flows. */
export type RectDirection = 'right' | 'left' | 'down' | 'up';

/** An edge of a box, for routing elbow connectors. */
export type RectSide = 'left' | 'right' | 'top' | 'bottom';

export interface RectElbowOptions {
    /** Edge the connector leaves from. Default 'left'. */
    from?: RectSide;
    /** Edge the connector arrives at (should be perpendicular to `from`). Default 'bottom'. */
    to?: RectSide;
    width?: number;
    height?: number;
    color?: RectAccent;
    dashed?: boolean;
    animated?: boolean;
    /** Draw an arrowhead at the end. Default true. */
    arrow?: boolean;
}

export interface RectBranchOptions {
    /** Number of branches fanning out. */
    count?: number;
    width?: number;
    height?: number;
    color?: RectAccent;
    dashed?: boolean;
    animated?: boolean;
    /** Fan-out direction. 'right' (default) / 'left' / 'down' / 'up'. */
    direction?: RectDirection;
}

export interface RectLoopOptions {
    /** Horizontal span the arc covers, in px. */
    width?: number;
    /** How tall the arc bows, in px. */
    height?: number;
    color?: RectAccent;
    dashed?: boolean;
    animated?: boolean;
    /** Send travelling dots around the loop (visible recurrence). */
    dots?: boolean;
    /** A small self-loop (node → itself) instead of a wide feedback arc. */
    self?: boolean;
    /** Bow the arc below instead of above. */
    below?: boolean;
    /** Caption centred on the arc. */
    label?: string;
}

export interface RectArrowOptions {
    width?: number;
    height?: number;
    color?: RectAccent;
    dashed?: boolean;
    /** Which way the arrowhead points. Default 'right'. */
    direction?: RectDirection;
    /** Small caption drawn alongside the arrow (e.g. '+ spikes'). */
    label?: string;
    /** Animate a flowing dash along the connector (data-in-motion). */
    animated?: boolean;
    /** Send little dots travelling along the connector (visible flow). */
    dots?: boolean;
}

export interface RectPipelineOptions {
    /** Space reserved for each arrow connector along the flow axis, in px. */
    gap?: number;
    arrowColor?: RectAccent;
    dashed?: boolean;
    /** 'right' (default) lays stages left-to-right; 'down' stacks them top-to-bottom. */
    direction?: RectDirection;
    /** Animate flowing dashes along every connector. */
    animated?: boolean;
    /** Send travelling dots along every connector. */
    dots?: boolean;
    /** Per-connector captions, in order (labels[i] sits on the i-th arrow). */
    labels?: string[];
}

export interface RectHeaderOptions {
    title: string;
    subtitle?: string;
    accent?: RectAccent;
    /** Tiny label above the title (e.g. 'B1'). */
    kicker?: string;
}

export interface RectChipOptions {
    label: string;
    color?: RectAccent;
    /** Filled pill instead of a bordered swatch chip. */
    filled?: boolean;
    /** Pulse the chip (an 'active' marker). */
    animated?: boolean;
}

export interface RectLegendItem {
    label: string;
    color?: RectAccent;
}

export interface RectLegendOptions {
    items: RectLegendItem[];
    /** Lay items in a row (default) or a column. */
    layout?: 'row' | 'column';
}

export interface RectSymbolItem {
    /** The glyph, e.g. 'z', 'xₜ', 'ρ'. */
    symbol: string;
    color?: RectAccent;
    /** What the symbol is called. */
    name: string;
    /** Shape / type, e.g. 'n counts at bin t'. */
    type?: string;
    /** A dim trailing note. */
    note?: string;
}

export interface RectSymbolsOptions {
    title?: string;
    subtitle?: string;
    items: RectSymbolItem[];
}

export interface RectGlossaryTerm {
    term: string;
    def: string;
}

export interface RectBoardOptions {
    minScale?: number;
    maxScale?: number;
    /** Gap kept between framed content and the viewport edge, in px. */
    padding?: number;
    /**
     * Editing mode (J12): drag and resize items, draw connectors from side
     * anchors, reroute them by their end handles, select (click, Shift
     * toggles, Ctrl/Cmd rubber band). Every finished gesture fires `commit`.
     * Default false: a pan/zoom view.
     */
    editable?: boolean;
    /** Grid step for move/resize in world px (Alt held: pixel precise). 0 = no grid. */
    grid?: number;
    /** Smallest size a resize may produce. Default 40 × 30. */
    minItemSize?: {w: number; h: number};
    /** Zoom factor of one wheel step. Default 1.12. */
    zoomStep?: number;
    /** Shape of 'curve' connectors: control points `clamp(dist * factor, min, max)` out. */
    curve?: {factor?: number; min?: number; max?: number};
    /** Class toggled on selected items. Default 'rb-selected'. */
    selectedClass?: string;
    /**
     * Items that move along with a dragged item besides the rest of the
     * selection — e.g. everything inside a frame.
     */
    dragPartners?: (id: string) => string[];
    /** Rubber band on empty space with Shift / Ctrl / Cmd. Default true when editable. */
    band?: boolean;
    /** Connector labels as plain text or on a pill. Default 'plain'. */
    edgeLabels?: 'plain' | 'pill';
    /** Re-fit the camera on window resize. Default true unless editable. */
    refitOnResize?: boolean;
}

/** Placement options of an item (`RectBoard.add`). */
export interface RectItemOptions {
    /** Board-controlled size, needed for resizing. Omit to use the element's own size. */
    w?: number;
    h?: number;
    /** 'back' items (frames, groups) sit under the connectors, 'front' (default) above. */
    layer?: 'back' | 'front';
    /** Editable boards only; all default true. */
    movable?: boolean;
    resizable?: boolean;
    connectable?: boolean;
}

/** A connector with an id, for editable boards (`RectBoard.setEdges`). */
export interface RectEdgeSpec extends RectRouteOptions {
    id: string;
    from: string;
    to: string;
    /** Arrowhead at the source end too. */
    fromArrow?: boolean;
    /** Extra class on the connector's <g>. */
    className?: string;
}

/** One finished gesture on an editable board — the undo hook. */
export type RectBoardChange =
    | {type: 'move'; items: Array<{id: string; from: {x: number; y: number}; to: {x: number; y: number}}>}
    | {type: 'resize'; id: string; from: {w: number; h: number}; to: {w: number; h: number}}
    | {type: 'connect'; edgeId: string; from: string; fromSide: RectSide; to: string}
    | {type: 'reroute'; edgeId: string; endpoint: 'from' | 'to'; to: string};

export interface RectBoardEvents {
    /** A gesture finished and changed the board (move, resize, connect, reroute). */
    commit: (change: RectBoardChange) => void;
    /** The item selection changed. */
    select: (ids: string[]) => void;
    /** A connector was selected (or null: none). */
    edgeSelect: (id: string | null) => void;
    /** A rubber band was drawn on empty space (world rect, modifiers at start). */
    band: (rect: {x: number; y: number; w: number; h: number}, mods: {shift: boolean; ctrl: boolean}) => void;
    itemDblClick: (id: string, event: MouseEvent) => void;
    edgeDblClick: (id: string, event: MouseEvent) => void;
    backgroundDblClick: (point: {x: number; y: number}, event: MouseEvent) => void;
}

export interface RectStoryHandlers {
    /** Called whenever the camera settles on a story step (-1 = whole board). */
    onStep?: (index: number, id: string | null) => void;
}

export interface RectRouteOptions {
    /** 'curve' (default) · 'orthogonal' (right-angle) · 'straight'. */
    style?: 'curve' | 'orthogonal' | 'straight';
    /** Pin the exit edge of the source box; auto-chosen from geometry if omitted. */
    fromSide?: RectSide;
    /** Pin the entry edge of the target box; auto-chosen if omitted. */
    toSide?: RectSide;
    color?: RectAccent;
    dashed?: boolean;
    animated?: boolean;
    dots?: boolean;
    /** Draw an arrowhead at the target. Default true. */
    arrow?: boolean;
    /** Caption near the midpoint. */
    label?: string;
}

export interface RectGlossaryOptions {
    title?: string;
    subtitle?: string;
    terms: RectGlossaryTerm[];
    /** Number of columns to flow the terms into. Default 1. */
    columns?: number;
    /** Accent colour of the term headwords. */
    accent?: RectAccent;
}

export interface RectGroupOptions {
    /** Uppercase frame title shown on the top border. */
    title?: string;
    /** Small pill next to the title. */
    badge?: string;
    accent?: RectAccent;
    dashed?: boolean;
    /** Lay the children in a row (default) or a column. */
    layout?: 'row' | 'column';
    /** Gap between children, in px. Default 14. */
    gap?: number;
    background?: string;
    /** Child elements (boxes, pipelines, nested groups). */
    children?: Array<SVGElement | HTMLElement>;
}
