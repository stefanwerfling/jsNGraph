/**
 * jsngraph/rect — The rect kit: boxes, connectors, labels, RectBoard and the small charts
 * (BarStrip, Sparkline, Timeline, …).
 * Importing this subpath alone keeps the other parts out of a bundle;
 * `jsngraph` itself still exports everything.
 */
export { RectBox, RectArrow, RectPipeline } from './rect/RectBox';
export { RectGroup } from './rect/RectGroup';
export { RectElbow, RectBranch, RectLoop } from './rect/RectConnectors';
export { RectHeader, RectChip, RectLegend } from './rect/RectLabels';
export { RectSymbols, RectGlossary } from './rect/RectReference';
export { RectBoard } from './rect/RectBoard';
export { RectBoardGeometry, DEFAULT_CURVE, RECT_SIDES } from './rect/RectBoardGeometry';
export type { RectArea, RectPoint, RectAnchorPoint, RectCurveShape } from './rect/RectBoardGeometry';
export { RectHistory } from './rect/RectHistory';
export { Heatmap, BarStrip, FeatureColumn, Sparkline, Scatter, Network, Matrix, Timeline } from './rect/RectCharts';
export { RectChartData } from './rect/RectChartData';
export type { BarRect, LinePoint, Domain } from './rect/RectChartData';
export { RectColor } from './rect/RectColor';
export { RectRandom } from './rect/RectRandom';
export { RectAnim } from './rect/RectAnim';
export type {
    RectAccent,
    RectBody,
    RectDirection,
    RectBoxOptions,
    RectChartOptions,
    HeatmapOptions,
    BarStripOptions,
    FeatureColumnOptions,
    SparklineOptions,
    SparklineSeries,
    ScatterOptions,
    NetworkOptions,
    MatrixOptions,
    TimelineOptions,
    RectArrowOptions,
    RectPipelineOptions,
    RectGroupOptions,
    RectHeaderOptions,
    RectChipOptions,
    RectLegendItem,
    RectLegendOptions,
    RectSymbolItem,
    RectSymbolsOptions,
    RectGlossaryTerm,
    RectGlossaryOptions,
    RectSide,
    RectElbowOptions,
    RectBranchOptions,
    RectLoopOptions,
    RectBoardOptions,
    RectItemOptions,
    RectEdgeSpec,
    RectBoardChange,
    RectBoardEvents,
    RectStoryHandlers,
    RectRouteOptions
} from './rect/RectKitTypes';
