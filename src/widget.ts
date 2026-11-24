/**
 * jsngraph/widget — small standalone dashboard widgets (SVG/DOM, no canvas): DayClock, RingGauge,
 * SegmentGauge, SegmentBar, ProgressBars, MonthCalendar, StatList, WorldMap, ParliamentChart,
 * TileCalendar, MajorityBar, ChoroplethMap, CalendarSkyline.
 * Importing this subpath alone keeps the other parts out of a bundle;
 * `jsngraph` itself still exports everything.
 */
export { DayClock, DayClockStyles } from './widget/DayClock';
export type { DayClockOptions, DayClockEvents, DayClockStyleVar } from './widget/DayClock';
export { DayClockGeometry, DAY_MINUTES } from './widget/DayClockGeometry';
export type { DayClockItem, DayClockState, DayClockPlaced } from './widget/DayClockGeometry';
export { Widget, WidgetDom, WidgetStyles, Tween, paletteColor } from './widget/WidgetBase';
export type { WidgetOptions, WidgetStyleVar } from './widget/WidgetBase';
export { WidgetGeometry } from './widget/WidgetGeometry';
export { RingGauge } from './widget/RingGauge';
export type { GaugeRing, RingGaugeOptions, RingGaugeEvents } from './widget/RingGauge';
export { SegmentGauge } from './widget/SegmentGauge';
export type { GaugePart, SegmentGaugeOptions } from './widget/SegmentGauge';
export { SegmentBar } from './widget/SegmentBar';
export type { SegmentRow, SegmentBarOptions } from './widget/SegmentBar';
export { ProgressBars } from './widget/ProgressBars';
export type { ProgressRow, ProgressBarsOptions, ProgressBarsEvents } from './widget/ProgressBars';
export { MonthCalendar } from './widget/MonthCalendar';
export type { CalendarMark, MonthCalendarOptions, MonthCalendarEvents } from './widget/MonthCalendar';
export { CalendarGeometry } from './widget/CalendarGeometry';
export type { CalendarCell, CalendarRun } from './widget/CalendarGeometry';
export { StatList } from './widget/StatList';
export type { StatItem, StatListOptions } from './widget/StatList';
export { WorldMap } from './widget/WorldMap';
export type { MapMarker, MapLegendItem, WorldMapOptions, WorldMapEvents } from './widget/WorldMap';
export { WorldMapGeometry } from './widget/WorldMapGeometry';
export type { LonLat } from './widget/WorldMapGeometry';
export { ParliamentChart } from './widget/ParliamentChart';
export type { ParliamentParty, ParliamentChartOptions, ParliamentChartEvents } from './widget/ParliamentChart';
export { ParliamentGeometry } from './widget/ParliamentGeometry';
export type { Seat } from './widget/ParliamentGeometry';
export { TileCalendar } from './widget/TileCalendar';
export type { TileCategory, TileCalendarOptions, TileCalendarEvents } from './widget/TileCalendar';
export { MajorityBar } from './widget/MajorityBar';
export type { MajorityPart, MajorityBarOptions, MajorityBarEvents } from './widget/MajorityBar';
export { ChoroplethMap } from './widget/ChoroplethMap';
export type { ChoroplethMapOptions, ChoroplethMapEvents, ChoroplethLegend, ChoroplethLegendRow } from './widget/ChoroplethMap';
export { ChoroplethGeometry, ColorScale } from './widget/ChoroplethGeometry';
export type { MapRing, MapPolygon, MapRegion, MapProjection, MapBounds, MapFit } from './widget/ChoroplethGeometry';
export { CalendarSkyline } from './widget/CalendarSkyline';
export type { CalendarSkylineOptions, CalendarSkylineEvents, SkylineColorMode, SkylineRange } from './widget/CalendarSkyline';
export { SkylineGeometry } from './widget/SkylineGeometry';
export type { SkylineDay, SkylineCell, SkylineGrid, SkylineScale, SkylineView, SkylineBox } from './widget/SkylineGeometry';
export { DonutChart } from './widget/DonutChart';
export type { DonutChartOptions, DonutChartEvents, DonutSlice } from './widget/DonutChart';
