# Calendar skyline — plan

A year of daily counts as a 3D skyline: one column per day, laid out like a
contribution calendar (weeks left → right, weekdays front → back), seen in an
isometric view, height = count, colour = season, level or dominant category.
Next to it a donut of shares and a radar of activity kinds; brushing a range of
days on the skyline updates both. Example: a made-up developer's year.

All code new and our own, zero dependencies. Nothing from other contribution
renderers is taken over; data in the example is invented.

## Pieces

| Piece | Where | Role |
|---|---|---|
| `SkylineGeometry.ts` | `src/widget/` | Pure: calendar grid (date → week column, weekday row; `weekStart`, partial first/last week), height scales (`linear` / `sqrt` / `log`, cap at a percentile so one spike does not flatten the rest), isometric projection of a cell box (top / left / right faces, view from any of the 4 corners), painter order, month boundaries for floor labels, hit test (screen point → day, front-most box wins), colour helpers (season by day of year with `hemisphere`, quantile levels). Tested. |
| `CalendarSkyline.ts` | `src/widget/`, subpath `jsngraph/widget` | The widget (SVG, like the other widgets, `Widget` base: theme, `--wg-*` vars, events). Floor plate with one tile per day (empty days stay flat tiles), boxes for days > 0, month labels along the front edge, weekday labels at the side. Grow-in animation (`Tween`), hover = lifted outline + tooltip, click = `daySelect`, drag along the floor = range brush (`rangeChange`), `highlight(dates)` dims the rest. `colorMode: 'season' \| 'level' \| 'category' \| (day) => colour`. `setView(0…3)` turns the view by 90°. |
| `DonutChart.ts` | `src/widget/` | Small new widget: ring of shares with gaps, legend (HTML, like WorldMap), hover segment = tooltip + `segmentHover`, `setValues` eases. Kept general (not tied to the skyline). |
| `RadarChart` | `src/chart/` | Extension: `scale: 'log'` (rings at 1, 10, 100, 1K, 10K, values ≤ 0 at the centre) and `ringFormat` with K/M. |
| `examples/skyline.html` | | Made-up profile: a year of days with commits / issues / PRs / reviews and a language per commit; skyline + donut (languages) + radar (kinds, log) + totals (StatList). Brush a month → donut and radar show only that range; hover a language → the skyline tints the days where it led. |

### Rendering notes

- Boxes in SVG: up to 371 days × 3 faces ≈ 1100 polygons — fine. One `<g>` per
  day (hover/hit via `data-day`), painted back to front once per layout; a value
  change only rewrites polygon points (no re-sort, the order depends only on the
  view, not on heights).
- Projection 2:1 like `iso/IsoProjection`, but self-contained in the widget
  geometry (the widget scales like an image via `viewBox`; the iso editor's
  camera is not needed).
- Colours: faces shaded from one colour (top light, left base, right dark), the
  same rule as `IsoIcons.shades`, via `util/Color`.

### Data

```ts
interface SkylineDay { date: string /* YYYY-MM-DD */; value: number; category?: string; title?: string }
interface CalendarSkylineOptions {
    days: SkylineDay[]; from?: string; to?: string; weekStart?: 0 | 1;
    scale?: 'linear' | 'sqrt' | 'log'; cap?: number /* percentile, default 0.98 */; maxHeight?: number;
    colorMode?: 'season' | 'level' | 'category' | ((d: SkylineDay) => string);
    categoryColors?: Record<string, string>; hemisphere?: 'north' | 'south'; view?: 0 | 1 | 2 | 3;
    labels?: {months?: boolean; weekdays?: boolean}; format?: (d: SkylineDay) => string;
}
```

## Milestones

Status: S1–S4 done.

S1 as built: `SkylineGeometry` — `dayOf`/`dateOf`/`weekday` in UTC days (no daylight-saving gaps), `grid` (every date of
the range, default 365 days up to the last data day, partial first week, month start columns), `place`/`extent` (the
rectangle turned for views 0…3), `order` (a + b, then a − b), `project` (x = (a − b)·S, y = (a + b)·S/2 − h), `box`
(top / left / right faces), `heightScale` (linear / sqrt / log1p against the `cap` quantile of the non-zero values),
`quantile`, `levels` (quartiles → 1…4), `seasonColor` (four mid-season anchors, held for most of a season and blended near
its edges; south = half a year shifted), `byLevel`, `shades`. `CalendarSkyline` builds one `<g data-day>` per date (floor
tile + three box faces) in drawing order once per layout; values only rewrite polygon points (Tween: boxes grow in,
`setDays` with the same range morphs). Month names lie on the floor along the front edge (text matrix from the floor
axes, anchored so they always read left → right and cover their month), weekday names at the front side. `setView`,
`setScale`, `setColorMode`, `setHemisphere`, `setMaxHeight`, `replay`; `dayHover` / `dayClick` already fire.

S2 as built: hover = brighter faces + outline and a DOM tooltip (`format(cell)` for the value lines, `tooltip: false` hides
it); press on a day and drag = range brush by date between the two days (`rangeChange` live with `final: false`, then
`final: true`; `{from, to, cells, total}`), brushed days keep their boxes and get a tinted floor tile, the rest dims; a
click without dragging selects a day (outline, `daySelect`; again = none) and drops a range; pressing beside the days
clears both. No pointer capture — the day under the pointer is the event target (front boxes win where they overlap).
State is classes on the day groups (`wg-sky-hover` / `-sel` / `-on`, `wg-sky-dim` on the root), so a repaint never
touches it. API: `select`, `getSelected`, `setRange`, `getRange`, `highlight(dates)` (a range wins over it).

| # | Content |
|---|---|
| **S1** | `SkylineGeometry` + tests; `CalendarSkyline` static picture: grid, floor tiles, boxes, three colour modes, month/weekday labels, light/dark, grow-in. |
| **S2** | Interaction: hover tooltip, click, floor brush (`rangeChange`), `highlight`, `setView` (4 corners), `setDays` morph. |
| **S3** | `DonutChart` widget; RadarChart `scale: 'log'` + ring format. Tests for the pure parts (donut arcs, log ring values). |
| **S4** | Example page with linked brushing and hovering, gallery card + thumbnail, CLAUDE.md. |

S3 as built: `WidgetGeometry.donut(values, pad, start)` (shares of 360° with a gap after each visible slice, shrunk for
thin slices; values ≤ 0 keep an empty span so they can grow) and `DonutChart` (`jsngraph/widget`): stroked arcs, total or
the hovered share in the middle, HTML legend right/below with value + percent, hover on slice or legend row lifts it and
dims the rest (`segmentHover`), `segmentClick`, `highlight(label)`, `setSlices` (same labels morph) / `setValues`.
RadarChart `scale: 'log'` (`RadarGeometry.fraction(v, range, 'log')` = one equal step per decade, 0.1 and below at the
centre, top = `logMax` = the power of ten above the data; rings `logTicks` 1, 10, 100 …, labels `compact` 1K / 3.4M),
`ringFormat`, `setScale`/`getScale`. Tests in `test/Skyline.test.ts`.

S4 as built: `examples/skyline.html` — a made-up year with counts per kind (commits, PRs, reviews, issues, comments,
releases) and a leading language per day. Brushing a range drives the totals (StatList), the language donut (days led)
and the radar (whole year dashed, selection filled, log scale); hovering a donut slice highlights the days that language
led; hovering a day lifts its language in the donut. Gallery card + thumbnail.

