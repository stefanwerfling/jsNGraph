/**
 * jsngraph/chart — scientific x/y charts on canvas: WaterfallChart (stacked
 * spectra with hover/select and a draggable slice marker) and LineChart.
 * Importing this subpath alone keeps the other parts out of a bundle;
 * `jsngraph` itself still exports everything.
 */
export { WaterfallChart } from './chart/WaterfallChart';
export type { WaterfallChartOptions, WaterfallChartEvents, WaterfallSeries } from './chart/WaterfallChart';
export { LineChart } from './chart/LineChart';
export type { LineChartOptions, LineChartEvents, LineSeries } from './chart/LineChart';
export { ChartScale } from './chart/ChartScale';
export type { ChartRange, ChartRect } from './chart/ChartScale';
export { ChartTheme } from './chart/ChartTheme';
export type { ChartThemeTokens } from './chart/ChartTheme';
export { WaterfallGeometry } from './chart/WaterfallGeometry';
export type { ChartSeriesData, WaterfallLayout } from './chart/WaterfallGeometry';
