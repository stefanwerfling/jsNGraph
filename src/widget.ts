/**
 * jsngraph/widget — small standalone dashboard widgets (SVG, no canvas): DayClock.
 * Importing this subpath alone keeps the other parts out of a bundle;
 * `jsngraph` itself still exports everything.
 */
export { DayClock, DayClockStyles } from './widget/DayClock';
export type { DayClockOptions, DayClockEvents, DayClockStyleVar } from './widget/DayClock';
export { DayClockGeometry, DAY_MINUTES } from './widget/DayClockGeometry';
export type { DayClockItem, DayClockState, DayClockPlaced } from './widget/DayClockGeometry';
