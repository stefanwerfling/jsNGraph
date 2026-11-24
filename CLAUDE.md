# jsNGraph

TypeScript library (ESM/CJS + browser IIFE via `tsup`). Owner: Stefan Werfling —
https://github.com/stefanwerfling/jsNGraph

Status: V1 working — interactive network topology graph on Canvas, force-directed layout,
hover/click/drag, dark/light themes, live node/edge updates. Zero runtime dependencies.

## What is jsNGraph?

An embeddable network-monitoring-style graph: nodes are devices (router/server/database/PC/
laptop/tablet/generic) with a status ring and load, edges are colored green→yellow→red by
traffic load with animated traffic dots. Visual reference: yFiles' network monitoring demo
(https://www.yfiles.com/demos/showcase/networkmonitoring/) — not a pixel clone (proprietary,
no visual access during development), but matching in spirit: dark/light theme, device icons,
load-colored/animated edges, click-to-open detail panel with a load bar.

Consumers: meant to be dropped into other projects (e.g. Loki's admin UI) either as an npm
package or, since some consumers are plain-`<script>` pages with no build step, as the built
`dist/jsngraph.global.js` IIFE bundle (`window.JSNGraph.NGraph`).

## Layout (`src/`, all TypeScript)

- `index.ts` — public exports (`NGraph`, types, `Theme`).
- `NGraph.ts` — the public entry class. Owns the canvas, the node/edge maps, the render loop
  (`requestAnimationFrame`), and wires layout + renderer + interaction + tooltip/panel together.
  `setData`/`addNode`/`updateNode`/`removeNode` (+ edge equivalents), `setTheme`, `on`/`off`
  (`nodeHover`/`nodeClick`), `destroy`.
- `model/` — `NGraphTypes.ts` (public input shapes: `NGraphNodeData`, `NGraphEdgeData`,
  `NodeKind`, `NodeStatus`), `GraphNode.ts` / `GraphEdge.ts` (runtime state: position/velocity/
  radius on top of the data, `updateFrom` for live patches).
- `layout/ForceLayout.ts` — custom O(n²) force-directed layout (repulsion + edge springs +
  centering), no d3-force dependency. Has a distance floor and per-tick speed cap on the
  repulsion term (a naive 1/d² force is numerically unstable when two nodes start coincident —
  this bit for real during development, see `test/ForceLayout.test.ts`), plus a hard
  collision-resolution pass so nodes never visually overlap regardless of force tuning.
- `render/` — `CanvasRenderer.ts` (draws grid/edges/traffic-dots/nodes/labels each frame),
  `NodeIcons.ts` (hand-drawn device glyphs, no icon font/image assets), `Theme.ts`
  (`ThemeTokens` + built-in `dark`/`light` palettes).
  Optional WebGL2 layer (J11, `renderer: 'webgl' | 'auto'`, `webglMinNodes` default 50 000):
  `WebGLLayer.ts` is a second canvas *under* the 2d one. `CanvasRenderer.draw(scene, bulk)` then
  leaves the 2d canvas transparent and hands plain straight edges (+ arrowheads) and plain dots
  to the `BulkSink` (`BulkBuffers.ts`, pure, tested) instead of drawing them; the layer draws
  them as three instanced draw calls. Everything with detail (cards, circles with icons, rings,
  hover/selection/highlight, labels, curves, dashes, hulls, overlays, clusters, lasso) stays 2d.
  Accepted differences: the bulk is always under all 2d content (the dot grid and hulls draw
  over GL edges; a curved/dashed edge can lie over a GL dot). No WebGL2 or a lost context →
  back to 2d for good (`activeRenderer` says which drew). Atlas example has a toggle; 100k
  nodes zoomed out: ~70 → ~14 ms/frame, with all edges ~190 → ~38 ms (CPU-side loop remains).
- `interaction/InteractionController.ts` — manual canvas hit-testing (circle-vs-pointer) for
  hover/click/drag-to-reposition, since there are no per-node DOM elements to attach listeners to.
- `ui/` — `Tooltip.ts` (hover), `NodePanel.ts` (click-to-open detail panel: name/IP/status/load
  bar) — both plain DOM+CSS overlays positioned over the canvas, not canvas-drawn (crisper text,
  no charting dependency needed for one bar).
- `util/EventEmitter.ts` — tiny typed pub/sub backing `NGraph.on`/`off`.
- `rect/` — a secondary, standalone export: a DOM+SVG "rect element" diagram kit for
  wiring-diagram visuals. Blocks: `RectBox` (labeled block, optional `glow`), `RectGroup`
  (nested container frame). Mini-charts (`RectCharts.ts`): `Heatmap`, `BarStrip`,
  `FeatureColumn`, `Sparkline`, `Scatter` (opt. axes/target), `Network` (layered node-link),
  `Matrix` (axis-labeled grid), `Timeline` (opt. cursor/ticks). `BarStrip`, `Sparkline` and
  `Timeline` also have a data mode (`values`/`series`, `titles`, `colors`, `max`/`yMin`, `fluid`;
  any CSS colour incl. `var(--x)`), geometry in the pure `RectChartData.ts`. Labels (`RectLabels.ts`):
  `RectHeader`, `RectChip`, `RectLegend`. Reference panels (`RectReference.ts`): `RectSymbols`
  (glyph·name·type·note key) and `RectGlossary` (term·definition). Connectors: `RectArrow`/`RectPipeline` — directional
  (`RectDirection`), labeled, optionally `animated` (flowing dashes) or `dots` (travelling dots);
  plus `RectConnectors.ts` `RectElbow` (right-angle L-route), `RectBranch` (1→n fan-out) and
  `RectLoop` (curved feedback / self-loop — recurrence you can watch dots travel around).
  Charts also take motion: `Heatmap.scan`, `Timeline.sweep`, `RectBox.glow`. Opt-in CSS animations
  inject one keyframe `<style>` once via `RectAnim`; chart motion uses self-contained SMIL.
  `RectBoard` (`RectBoard.ts`) is the composition layer: `add(el, x, y, id)` places any element
  on one pan/zoom camera; `connect(fromId, toId, opts)` auto-routes a connector between two placed
  boxes from their live geometry (curve/orthogonal/straight, arrowed, animated/dots, into a
  behind-the-boxes SVG overlay); and `story([ids], {onStep})` turns wheel/arrow input into smooth
  camera fly-throughs — the scrollytelling the explainer runs on.
  With `editable: true` (J12) it is an editor surface: items drag (grid snap, Alt bypasses) and
  resize, side anchors (`data-rb="anchor"`, default dots injected unless the host renders its own)
  draw connectors, the selected connector's end handles reroute, click/Shift/Ctrl-band select,
  `dragPartners` lets a frame carry its contents, `layer: 'back'` puts frames under the connector
  overlay. The host owns the document: one `commit` event per finished gesture (move / resize /
  connect / reroute with before/after — the undo hook), plus `select`, `edgeSelect`, `band`,
  `*DblClick`; it re-syncs with `update`, `setEdges`, `clear` + `add`. `RectHistory<T>` is a generic
  snapshot undo stack; geometry (anchors, curves, snap, overlap) is pure in `RectBoardGeometry.ts`.
  Default edit styles are injected once with zero-specificity `:where()` rules (`RectAnim`). Deterministic (`RectRandom`),
  inline-styled like the other DOM overlays — no stylesheet for static use, zero deps. Not
  canvas/graph-related; shares the package because consumers compose it alongside NGraph (see
  `examples/explainer.html`). All exported from `index.ts`.
- `modelview/` — a third, standalone export: `ModelView`, an interactive pan/zoom
  model-architecture viewer on its own canvas (hfviewer.com in spirit). A *pure renderer* — it
  never fetches or parses a model; the consumer hands it `{modules, flows}` (`ModelGraphData`)
  built from whatever source it has. `ModelModuleData` = labeled block with a `kind`
  (`ModuleKind`: input/embedding/attention/mlp/norm/head/output/block/op/generic → the chip's accent
  border/label color), optional `sublabel`, `repeat` (stacked card + big "×N"), and
  `detail` key/values (shape/dtype/params → click panel). Styled after the real hfviewer viewer:
  compact OUTLINED pill chips (accent border, dark tinted fill, light-tinted accent label) on a dark
  background (no grid), thin ORTHOGONAL right-angle edges with rounded corners tinted by their source
  block, and labeled group-container frames around expanded parents. `ModelFlowData` edges have a
  `kind` (`FlowKind`: `flow` = orthogonal top-down route; `residual`/`skip` = dashed detour out the
  right) and optional `animated` dots travelling the route. **Granularity**: modules may form a containment forest via
  `parent` + `level` (the level a module is revealed at); `setLevel(n)`/`getMaxLevel()` walk
  between granularities (hfviewer's 4 detail levels). Author flows between the finest *leaf*
  modules only — `Granularity.ts` (pure, `test/Granularity.test.ts`) derives each coarser level by
  collapsing hidden endpoints onto their nearest visible ancestor, dropping now-internal edges and
  merging duplicates, so one `×32` block expands into layer internals → attn/MLP projections →
  SDPA ops. Pieces: `FlowLayout.ts` (deterministic top-down longest-path rank
  layout — a residual edge spanning ranks never pulls its target up; capped relaxation so a
  feedback cycle terminates; see `test/FlowLayout.test.ts`), `Camera.ts` (world↔screen pan/zoom +
  fit-to-content), `ModelInteraction.ts` (drag-pan, wheel-zoom-at-cursor, world-space hit-test —
  its own, since NGraph's `InteractionController` has no camera), `ModelRenderer.ts` (outlined chips +
  orthogonal edges + nested `GroupFrame` container boxes), `ModelPanel.ts` (click detail panel).
  Edges are muted toward `nodeStroke` (dots keep the full accent), chips have a slight vertical gradient. Text
  asks for Inter with a system-ui fallback; the font is not bundled (zero assets) — a page that loads Inter via CSS
  gets it automatically (a `document.fonts` `loadingdone` requests a frame). Drawn through the on-demand `RenderLoop`: it
  only keeps running while animated flows are shown.
  `ModelView.computeGroups` builds a `GroupFrame` (padded bbox + label tab + ×N) per expanded
  parent, padded more for outer groups so nested frames sit cleanly inside. Reuses `render/Theme.ts`
  and `ui/Tooltip.ts` from NGraph; `ModelView.ts` auto-fits on every resize until the user pans/zooms.
  See `examples/modelview.html`.

- `workflow/` — a fourth, standalone export: `WorkflowEditor`, a node-based workflow editor widget
  (DOM nodes + one SVG connection layer on a stage transformed by `view/Camera`). Graphics only — the
  host describes node *types* (`WorkflowNodeType`: label, icon, colour, typed `inputs`/`outputs`
  ports with `kind`/`side`/`max`) and owns what nodes do. The widget owns the document
  (`get/setDocument`, built-in undo via `RectHistory`, one `change` event per finished gesture);
  `readOnly: true` / `setReadOnly` makes the same widget a viewer. `WorkflowModel.ts` (pure: nodes,
  connections, validation incl. host `canConnect`; unknown types/ports are kept, not drawn) and
  `WorkflowGeometry.ts` (pure: node size, port placement, forward curve vs. rounded backward detour)
  are tested in `test/Workflow.test.ts`. Styles are `:where()` rules over `--wf-*` CSS variables
  (`WorkflowStyles.ts`). Editing comfort (W3): "+" on free ports / insert+delete on the hovered connection only
  *request* a node (`addRequest`/`insertRequest` events — the host shows its own picker, then calls
  `addNodeFrom`/`insertNode`); copy/cut/paste use the system clipboard with a JSON `WorkflowFragment`;
  delete bridges chains (`reconnectOnDelete`). W4: host palettes call `beginDrag(type, pointerEvent)` (ghost preview,
  drop onto a fitting connection inserts; `dropAt` is the programmatic form); sticky notes live in `doc.notes`
  (behind nodes, share the node id space). Gotcha: presses set pointer capture on the root, so click/dblclick
  `target` is the root — resolve the element with `elementFromPoint`. W5: run status is display-only state kept
  outside the model (`setNodeStatus`/`setConnectionStatus`/`setRunPath`/`clearStatus`), re-applied on every render.
  W6: `tidyUp()` via pure `WorkflowLayout.ts` (left→right longest-path columns, loops dropped by DFS, barycenter
  order, sub-nodes under their agent; `test/WorkflowLayout.test.ts`), `WorkflowMinimap.ts` (canvas overview,
  scale frozen while dragging on it), backward detours avoid other nodes, `setStyleVars` /
  `WorkflowStyles.varsFromTheme`. Connection labels: `WorkflowConnection.label` (document data, under the line),
  double-click to edit, `setConnectionLabel`. Sub-workflows: `doc.groups` (`WorkflowGroup`), frame + header when
  expanded, one node with proxy ports (member ports with traffic across the border) when collapsed; pure part in
  `WorkflowGroups.ts` (`proxies`, `frameOf`, `hidden`, `substitute` = the model as drawn, used by `tidyUp`); groups nest
  via `WorkflowGroup.parent` (`nodes` = direct members, the outermost collapsed group is drawn, ungroup = up one level);
  Ctrl+G / Ctrl+Shift+G; collapse is an undoable document change, also allowed read-only.
  Run replay: `startRecording`/`stopRecording` capture the status calls as timed `WorkflowRunEvent`s;
  `WorkflowReplay` (own file) plays them back through the status API with an optional control bar (scrubber, steps,
  speed); pure state-at-time in `WorkflowRun.ts` (`test/WorkflowRun.test.ts`).
  Plan + milestones W1–W6: `docs/workflow-editor.md`.
  `WorkflowEditor` is the façade (model, history, selection, events) over internal collaborators: `WorkflowRenderer`
  (stage + node/note/group DOM), `WorkflowConnections` (SVG wires, labels, tools), `WorkflowGestures` (pointer),
  `WorkflowKeyboard` (keys + clipboard), `WorkflowPalette`, `WorkflowInlineEdit`, `WorkflowArrange` (tidy tween, make-room),
  `WorkflowViewport` (camera/fit), `WorkflowRunState` (status + recording); DOM behaviour in `test/WorkflowEditorDom.test.ts`.
  Example: `examples/workflow.html`.
  Parameter nodes (W7, for the audio patcher): `render(node, body, ctx)` gets a `WorkflowNodeContext` — `ctx.update(patch,
  {live})` writes back without rebuilding the body (`live` = no undo step/`change`; the release call commits), plus
  `toggleCollapsed`/`toggleDisabled`. In a custom body (`.wf-node-custom`) form fields, buttons, links, labels and
  `[data-wf-interactive]` get the pointer (CSS re-enables them, `isBodyControl` skips press/dblclick/keys).
  `updateNode(id, patch, {render, commit})`. Node `collapsed` (document data, `setCollapsed`, change kind 'collapse')
  shrinks to `type.collapsedHeight` (default ≥ 44) via `WorkflowGeometry.nodeSize(type, node)` — layout, group frames
  and ports follow. Options `colorPorts` (ports in the node colour) and `groupBypass` (header dot toggles members'
  `disabled`). Dropping onto a wire keeps the drop spot only when free, else `insertNode` places it beside the source;
  an inserted node joins the group both wire ends share (`WorkflowModel.addToGroup`).
  Example: `examples/audio.html` — a Web Audio patch editor (11 unit types, live sliders, bypass/collapse, groups,
  generated drum loop + reverb impulse, Save/Load via localStorage, offline WAV bounce); the page keeps an `Engine`
  that `sync`s the document into a Web Audio graph (units persist across syncs so sources keep playing).
  Example: `examples/storyboard.html` — an invented film storyboard in two views (tabs) over two editors that share node
  ids and keep label + meta in sync: glowing cards + a diamond decision node (transparent `.wf-node` via `:has()`, the
  body draws the rotated square), details panel bound to `meta`, simulated run; and an infinite canvas of shot cards with
  frames painted once per art key into data URLs, port-less `scribble` nodes as handwritten notes (double-click =
  contenteditable), own fit around the floating bars (`fitOnLoad: false`). Connection colours by id prefix in page CSS
  (`ok-`/`no-`/`dash-`).

- `widget/` — small standalone dashboard widgets (SVG, no canvas), subpath `jsngraph/widget`. `DayClock`
  (taken over from kavula's dashboard, without d3/jQuery): a day on one 24 h dial (00:00 top, clockwise), elapsed
  part shaded, hand = now, items as arcs on rings (overlaps get their own, max `maxRings`), states past/running/
  upcoming; `itemClick`/`itemHover`, `live`, fixed `now`, `locale`, `--dc-*` vars via `:where()` (`DayClockStyles`).
  Drawn in a fixed 290 view box (+16 px per side for the 06:00/18:00 labels). Pure part `DayClockGeometry.ts`
  (`place` = ring layout, arcs, wedge; `test/DayClock.test.ts`). Example: `examples/dayclock.html`.
  Dashboard widgets (same subpath) share `WidgetBase.ts`: `Widget` (root + `data-wg-theme` auto/light/dark, events,
  `setStyleVars` over `--wg-*`: ink/muted/track/grid/knob/surface + palette c1…c6, `Widget.paletteColor(i)`; a `prefix` ctor arg gives a widget its own vars — `DayClock` extends `Widget` with `dc`; SVG helpers in `WidgetDom`), `Tween` (rAF
  ease-out over a number list; new entries grow from 0; off for reduced motion), `WidgetStyles` (one `:where()` sheet).
  Widgets keep their elements and only repaint values (`build` on structure change, `paint` per tween frame):
  `RingGauge` (concentric arcs, values stacked in the centre, `sweep`/`startAngle`), `SegmentGauge` (radial ticks lit
  by stacked parts), `SegmentBar` (LED rows of slanted cells), `ProgressBars` (bars with a knob on a shared axis —
  month labels or nice ticks; `editable` drag → `change`/`commit`), `MonthCalendar` (range pill per week row, round caps
  only at the real ends, marks, today ring, Sunday/weekend accent, ‹ › nav, built-in range/day selection),
  `StatList` (DOM: big figures, optional dimmed `secondary`, underline; counts up), `WorldMap` (embedded land outlines
  `WorldLand.ts` — Natural Earth 1:110m, public domain, no Antarctica, ~7 KB polyline-encoded, regenerate with
  `node scripts/worldmap.mjs ne_110m_land.geojson`; equirectangular, `mode` fill | dots (scanline sampling, one path),
  markers with optional pulse, HTML legend). `SegmentBar`/`ProgressBars` lay out at the container's real px width
  (`watchWidth`) so text keeps its size; the round ones scale like images. Pure parts: `WidgetGeometry` (polar, arcs,
  stacked segment owners, nice ticks), `CalendarGeometry` (grid, runs), `WorldMapGeometry` (decode, path, dots,
  isLand); `test/Widgets.test.ts`.
  `CalendarSkyline` (plan + milestones S1–S4 in `docs/calendar-skyline.md`, done): a year of daily counts as an
  isometric skyline on a contribution-calendar grid (weeks × weekdays), height by linear/sqrt/log against a quantile cap,
  colour by season (hemisphere) / level / category / function, faces shaded, floor tiles for empty days, month names lying on
  the floor, four views (`setView`), grow-in/morph via `Tween`. Pure `SkylineGeometry` (UTC day maths, `grid`, `place`,
  `order`, `box`, `heightScale`, `levels`, `seasonColor`; `test/Skyline.test.ts`). Hover tooltip (`format`), drag across
  days = range brush (`rangeChange` live/final with total), click = `daySelect`, `highlight(dates)`; state lives in
  classes on the day groups. `DonutChart` (same subpath): stroked slices with gaps (`WidgetGeometry.donut`), total /
  hovered share in the middle, HTML legend with value + %, `segmentHover`/`segmentClick`, `highlight(label)`, morphing
  `setValues`. RadarChart got `scale: 'log'` (one ring per decade, `RadarGeometry.logMax`/`logTicks`/`compact`) and
  `ringFormat`. Example: `examples/skyline.html` (brush drives totals, language donut and kinds radar; donut hover
  highlights days). Example: `examples/dashboard.html` (made-up roastery, all widgets + LineChart +
  RadarChart, live data, theme + map mode toggles).

- `netview/` — `NetView` (subpath `jsngraph/netview`): a transformer compressed to fit the browser — one
  column per block, residual stream folded into `bins` (signed max per bin, scaled median→0 / p95→1 so
  standing-out dims glow), heads (focus = 1 − H/ln ctx) and MoE experts (picks + prompt load) below, lens
  top-1 under each column, measurement strip (p(answer) line, Δ residual bars, appears/settles marks).
  A trace lays the active path (strongest bins block→block, `pathWidth`²curves per gap) over it; sweep +
  flow dots. Pure parts: `NetCompress` (bins, normalize, strongest, focus, `measure`), `NetLayout`
  (geometry, `hit`), `NetHugin` (Hugin's `trace` tool JSON — or the single forward tools combined — → model +
  trace); `test/NetView.test.ts`.
  Cells/curves are batched per colour×alpha bucket (34 → 9 ms/frame for 40 blocks × 256 experts).
  Example: `examples/netview.html` (simulated traces, drop a Hugin JSON for a real one).

- `chart/` — `WaterfallChart` + `LineChart` (subpath `jsngraph/chart`): scientific x/y charts on one canvas each
  (shared base `ChartSurface`: DPR-sharp resize, on-demand `RenderLoop`, axis/tick drawing; `ChartTheme` dark/light).
  Waterfall: traces stacked front (index 0) to back, each shifted right/up (`depthX`/`depthY`); hover/click
  (`hover`/`select`), a draggable slice marker (`marker` event, `getMarker`, `slice()` = every trace at that x),
  x-only wheel zoom/drag pan/double-click reset (`rangeChange`), `occlude` (hidden lines: each trace filled to its
  baseline; highlighted traces then keep their stack place, on top their fill would blank the front). `setSeries`
  keeps the zoom when the x extent is unchanged (streaming). LineChart: series with dash/fill/gradient, title,
  legend, grid bands; `markers` (dots), `highlight` (ringed dot at indices), `xLabels` (category axis), `yFormat`.
  `ChartSurface` clears and fills whole device pixels each frame (a fractional width left a stale last column). Pure parts: `ChartScale` (nice ticks, mapping, zoom/pan/clamp), `WaterfallGeometry`
  (stack layout, nearest index, segment-distance hit test — vertical distance misses steep peak flanks);
  `test/Chart.test.ts`. Example: `examples/waterfall.html` (in-page radix-2 FFT of a drifting test signal).
  `RadarChart` (spider/web/Kiviat): `categories` clockwise from the top, `series` (`fill`, `markers`, `dash`,
  `visible`), `grid` polygon|circle, ring values along the first axis, canvas legend whose boxes toggle series
  (`toggle` event), vertex tooltip (`hover`, `format`), grow-in animation (`setSeries(…, {animate})`, `replay`),
  wheel zoom about the pointer / drag pan / double-click reset. Radius leaves room for the measured side labels.
  `setSeries` keeps the hover while the series exists (live updates). Pure part `RadarGeometry` (angle, point,
  label alignment, vertex hit). Example: `examples/radar.html` (static comparison + live host-health radar).
  `StorylineChart` ("who was where, when"): `{events (time, period, series), entities (color, icon), appearances
  (weight)}`; entities are bands through the events they take part in, bundled inside an event bar, passing freely
  in between, width = weight. Pure `StorylineLayout`: columns = distinct times (events with the same time stack),
  idle entities are singleton groups, barycentre sweeps keep the ordering with the fewest crossings, then every
  column's groups move towards their members' y in the neighbour columns under order + gap constraints — an exact
  weighted isotonic regression (PAVA) per column, repeated (`test/Storyline.test.ts`). View scales x and y
  separately (time fills the width, the stack the height; y ≤ 4·x); band hit test in screen px. Hover = white
  outline + dim others, click band / legend chip = `focusEntity` (its events + everyone in them), click event =
  `focusSeries`, double-click background = `reset`; DOM legend chips. Example: `examples/storyline.html`
  (made-up open-source project, 22 people × 30 events).
  `StreamChart` (streamgraph, small multiples): `{x, layers (color, group), panels (label, values[layer][i])}`. Pure
  `StreamLayout`: every layer resampled (`resolution` per x step) and smoothed by a Gaussian convolution Σ vᵢ·K·Δᵢ
  (`bandwidth` in x units, default 1.2 × median step; outside the data it falls to 0, so streams taper over a domain
  padded by 3 × bandwidth), one order for all panels (`given`/`reverse`/`insideOut` from the totals), offsets
  `silhouette`/`wiggle` (d3's minimum-wiggle, re-centred)/`zero`/`expand`; hidden layers become 0 so toggles morph;
  `layerAt` hit test (`test/Stream.test.ts`). Chart: `sharedScale` (panel height ∝ its range, a small floor) or equal
  panels, dotted `marks` with labels over the top, `annotations` (DOM note boxes pinned to panel/x/y, `**bold**`, kept
  below the mark labels), outline in the background colour (stronger on the silhouette), hover = dim others + tooltip
  with the raw value at the nearest x, DOM legend grouped by `layer.group` (hover highlights, click hides), x zoom/pan,
  morph on offset/order/visibility. Example: `examples/stream.html` (made-up podcast, 5 voices × studio/remote, 4 panels).

  Newsroom set (canvas, `jsngraph/chart`): `ChartNotes` is the shared note layer (DOM text over the canvas, plain or
  boxed, `**bold**`, curved/straight pointer with an arrowhead from the facing box edge — `ChartNotes.pointer` is pure;
  the chart resolves anchors to px every frame; `setDimmed` while a canvas tooltip shows). `BarChart`: categories ×
  series, grouped/stacked, small multiples side by side on one nice range (`BarLayout.range`/`bars`/`hit`, pure),
  labels rotate when crowded, zero line over the bars, bars grow/morph (`setData`), value labels. `UnitHistogram`: every
  item one block in its bin (`UnitLayout.place`: bin, then stack by category order, then value), panels share x and the
  count scale, per-panel colours per category, legend swatches split per panel, dashed marks labelled under the axis,
  units drop in, O(1) hit test via a bin/stack map. `AreaChart`: `AreaLayout.stack` none/zero/expand, `projectFrom`
  (lighter overlay + divider + label), marks, hover guide with every series, reveal left → right.
  Widgets (SVG/DOM, `jsngraph/widget`): `ParliamentChart` (`ParliamentGeometry.seats`: fewest rows with equal spacing,
  seats ∝ radius per row, ordered by angle so parties form wedges; colours sweep in by seat order; hover/legend focus),
  `TileCalendar` (months of day tiles coloured by category from a function or 'YYYY-MM-DD' map, `from`/`to`, labels
  beside tiles, legend with counts), `MajorityBar` (first part from the left, last from the right, threshold mark,
  count-up), `ChoroplethMap` (GeoJSON or plane polygons, mercator/equirectangular/none, `ColorScale.threshold`/
  `sequential`/`diverging`, outlines, step legend below or overlaid, viewBox pan/zoom; drag captures the pointer only
  after 3 px so clicks still reach regions). Pure parts tested in `test/Newsroom.test.ts`. Example: `examples/newsroom.html`
  (made-up country Nordhavn; the map is 201 Voronoi cells clipped to a generated island, the majority bar counts them).

  Market set (canvas, `jsngraph/chart`): `TimeSeriesChart` — lines over ms timestamps on a calendar axis (`TimeScale`,
  pure: `step` picks minute…100-year steps for a tick budget, `ticks` on round local positions — multi-day steps restart
  on the 1st, weeks on Mondays —, `label` detail follows the step, `decimate` = min/max per pixel column, binary-search
  `nearest`); zoom presets (DOM buttons, eased `go`), wheel/drag/double-click, y axis eases to the visible data, crosshair
  tooltip, optional volume pane and overview strip (`setNavigator`; drag window, its edges, or click to jump). `setSeries`
  keeps following the end when the view ended at the newest point (live). `DepthChart` — `DepthLayout.book` merges orders
  into levels and sums outwards from the spread (bids ≥ p, asks ≤ p), drawn as filled staircases (or lines), spread
  marker, linear/log, `window` (range or ± share of mid), price zoom/pan, the quantity axis eases on live updates; hover
  names the level that sets the depth ("n buy orders at p or higher"). Tests: `test/Market.test.ts`. Example:
  `examples/market.html` (made-up trading card, two years of prices, live book).

  `RadarScope` (canvas, `jsngraph/chart`): radar PPI — compass bezel (2° ticks, labels every `bearingStep`), dashed range
  rings (+ `rangeFormat`), shaded `sectors`, a beam turning at `sweepSpeed` °/s with an afterglow trail; an echo lights when
  the beam passes its bearing and fades over `persistence` (default one turn; glow kept by target id across
  `setTargets`), irregular blob per id, kind colours, sea clutter re-rolled each turn; echoes within `cluster` range units
  are joined (single link) and outlined by an orange rounded loop. Hover/click echoes and clusters (`clusterHover` also
  fires while an echo inside it is hovered), `highlight(ids)`, `setKindVisible`, `setPaused`, `getSweep`, `getClusters`.
  A transparent `theme.background` lets it sit over a page. Pure part `ScopeGeometry` (bearing ↔ plane, `sweepAge`,
  `cluster`, `hull`, `loop` = offset hull with round corners, `blob`, `hash`; `test/Scope.test.ts`). Example:
  `examples/seabird-radar.html` — an illustrated ocean cut-away drawn in the page (own projection, painter-sorted
  sprites: gannets circling and plunging, bait ball + tuna seen through the cut, a humpback that swims up, blows and
  shows its fluke, leaping common dolphins, gulls, the ship with a turning antenna), the scope's clusters drawn back
  into the scene as loops on the water and at flight height, hover linked both ways (`window.scope` for poking).
  `shapes` / `setShapes` (`ScopeShape`): fixed filled outlines such as a coastline, relative to the centre (move them when
  the centre moves), drawn under the echoes. The animal/boat sprites of both ocean pages live in `examples/ocean-art.js`
  (`window.OceanArt`: gannet, gull, tuna, dolphin common/bottlenose/spotted, humpback, pilot, sperm, fluke, shearwater,
  boat, squid). `examples/gomera.html`: a whale-watching trip off La Gomera — height-field island (radial barrancos,
  Valle Gran Rey, ×3 heights, rendered once per resize into a cached layer), Teide over a sea of clouds, the boat follows a
  Catmull-Rom route out of Vueltas (slower near animals, route done/planned on the water, wake), radar centred on the
  boat with the coast as a shape, sightings log + pins, trip clock; `?t=seconds` fast-forwards.

  `PhaseRing` (canvas, `jsngraph/chart`): a cyclic measurement drawn like an exoplanet phase curve — phase glyphs (moon
  phases with the lit part, dots or a drawer) circle a centre body on an orbit coloured by value, below it one tilted ring
  per series (`layout` single = `active` series, stack = all, flatter tilt) whose height above/below its disk (`baseline`
  mean/min/value) and colour (`colors`, default spectral blue → red, `scale` shared/each) follow the value; drop lines from
  the glyphs, guide rings at min/max, curve parts under the disk drawn before it, `notes` with leader lines, `cursor`
  (e.g. today), direction arrows, colour-bar legend. Drag turns (yaw) / tilts, double-click resets, `hover`/`click`,
  `highlightBin` for outside links, values morph on `setSeries`. Pure `PhaseRingGeometry` (`point`, cyclic Catmull-Rom
  `smooth`, `binAt`, `terminator` = moon lit fraction/side, `moonName`, `colorAt`, `nearest`, `stats`;
  `test/PhaseRing.test.ts`). Example: `examples/moonphase.html` (invented four years of La Gomera trips by lunar day,
  ±1 day window, species/metric/layout switches, table by the eight phases linked to the ring).

  `HoloTable` (canvas, `jsngraph/chart`): a dark table in perspective with glowing dashboard content, all plain data in
  `HoloScene` (scene coords: x right, y towards the viewer, z up): `panels` (framed tiles, corner glow, title printed on the
  table), `lines` (roads/routes, `glow` = three added strokes, `flow` dots travelling along), `areas` (districts), `bars`
  (boxes, only faces turned to the eye, grow on `setScene`), `ridges` (one wall per row over x, hovered row/column),
  `markers` (pin/ring/dot/turbine, `pulse`), `cards` (KPI boxes), `texts` (printed via a local affine fit of the perspective,
  or `standing`). Camera orbits a point on the table: drag orbit, right/Shift-drag pan (unproject), wheel zoom, double-click
  reset, `focus(panelId | 'all')` / `setCamera` fly (eased, yaw the short way, distance in log space); auto-fits until the
  user moves it. Hover/click pick the best of per-item tests (screen polygons for 3D items, the table point under the
  pointer for flat ones); `highlight(ids)`, `setPaused`. Pure `HoloGeometry` (`frame`, `project`, `unproject`,
  `fitDistance`, `lerp`, `boxFaces`, `inPolygon`, `polylineDistance`, `along`; `test/Holo.test.ts`). Example:
  `examples/smartcity.html` (made-up city Veldmark: energy ridges, traffic arteries by congestion + junction counters, a
  motorway, district incidents with pins, turbines/solar/storage, an hour slider driving every panel, fly-to buttons).

  `EncounterRose` (canvas, `jsngraph/chart`): many movement tracks (`EncounterData.fixes` = t/x/y metres, `dive` legs)
  moved to one common start in the centre and turned to a shared up (`align` north | `reference` bearing per encounter |
  `first` heading), drawn up to one shared replay clock (`play`/`pause`/`setTime`, `speed` × real time, null = whole
  tracks with faint ghosts while replaying); dives dashed, head dot ∝ √count with `young` dots trailing; outside a
  direction rose of where everybody is *now*, stacked by category; inside one circular-mean arrow per category (length =
  agreement). `scale` linear | sqrt, wheel zooms the radius (auto = 90th percentile of the farthest point), hover track
  (tooltip) / sector (`sectorHover`, lights its tracks), click pins, `highlight`, `setFilter`, `getVisible` (stats). Pure
  `EncounterGeometry` (`bearing`, `align`, `firstHeading`, `at`, `stats` incl. straightness/mean turn, `binOf`, `rose`,
  `circularMean`, `ringStep`, `distanceToPath`; `test/Encounter.test.ts`). Example: `examples/encounters.html` (invented
  season of 7 species with correlated random-walk models — bow-riders pulled back, sperm whales on long dives — filters
  for species/reaction/behaviour/Beaufort, species table, detail with a speed line).

  `AssociationSky` (canvas, `jsngraph/chart`): photo-ID association network as a night sky. `individuals` (category,
  optional `mother`), `encounters` (`t`, `ids` seen together). Stars = individuals seen up to `time` (radius ∝ log
  sightings, spikes from 8, fade when not seen for `fadeAfter`), lines = pairs with half-weight index ≥ `minHwi`
  (width/alpha by HWI), mother → calf gold dashes, units = connected groups with HWI ≥ `unitHwi` and ≥ 2 co-sightings,
  drawn as dotted padded hulls with `unitName(members)`; encounters within `flare` ring; milky-way dust twinkles. Layout
  is one deterministic force layout over *all* encounters (attraction ∝ HWI², mother pairs count as 1), so stars keep
  their place while time moves. Hover star (tooltip, focus on its associates) / unit hull (`unitHover`), click selects,
  wheel zoom at pointer (names from zoom 1.8), drag pan, `highlight`, `setCategoryVisible`, `getInfo` (tally,
  associates, unit), `getUnits`, `getEncounters`. Pure `AssociationIndex` (`hwi`, `tally` until t, `pairs`, `units`
  union-find, `layout`, `hull`; `test/Association.test.ts`). Example: `examples/socialsky.html` (invented catalogue of
  three species, 11 units arriving/leaving, alliances, transients, calves; time slider + play, HWI sliders, an
  individual card with a dorsal fin drawn from its seed, sighting lifeline and associates, unit list).

  `VolumeView` (WebGL2 + canvas, `jsngraph/chart`): a 4-channel density volume (RGBA8 3D texture, x fastest, `dims`,
  world proportions `size`) ray-marched in one fragment shader over a full-screen triangle — `mode` glow
  (emission/absorption above `threshold`, `density`), mip (brightest sample) or iso (first sample ≥ threshold, shaded by
  the central-difference gradient). Channels have colour/visible/gain (weights in the shader). Three stacked layers in
  the ChartSurface root: floor canvas (background, grid, the `floor(ctx, at(u, v))` callback), the WebGL canvas, the base
  canvas on top (box + clip-box edges, axis ticks on the edges facing the viewer / leftmost vertical, tooltip with a drop
  line). `setClip(min, max)` in texture coords (the ray is intersected with the clip box), orbit drag / wheel distance /
  double-click reset, `autoRotate` (°/s, keeps the loop running). Hover picks on the CPU: the strongest weighted sample
  along the pointer ray (`VolumeMath.strongest`, trilinear like GL LINEAR). No WebGL2 / lost context → a message,
  `supported` false. Pure `VolumeMath` (perspective/lookAt/multiply/invert/transform, `orbit`, `rayBox`, `sample`,
  `strongest`, `splat` = Gaussian splatting of points into the RGBA volume, per-channel peak → 255, optional `wrapZ` for
  cyclic axes; `test/Volume.test.ts`). Example: `examples/sightingcloud.html` (invented island + canyon on the floor, four
  species with their own season/place patterns over ten years, mode/threshold/density, season and west-edge cuts, presets).

  `OutcomeBurst` (canvas, `jsngraph/chart`): binary-outcome burst (churn yes/no) — one tapered, gently bent strand per
  `BurstItem` (`group` = attribute, `label`, `count`, `probability` of the positive outcome, optional `lift`, default =
  majority probability ÷ its base rate via `defaultLift`) out of one hub. Length = `length` count (log, round start, ends at
  the largest) | probability (majority confidence 50…100 %) | lift; colour = gradient positive → negative split at the
  probability along the strand, dot in the majority colour. Positive majority fills the top half, negative the bottom, both
  strongest at the right (`order` probability | count | lift | group), so the positive probability falls counter-clockwise
  all the way round; `mode` 'group' = one sector per attribute with arcs + labels; outcome names at top/bottom with arrows,
  percent side labels. Strands ease (angle/length/split/alpha) on `setItems`/`setLength`/`setOrder`/`setMode`/`setFilter`
  (filtered ones shrink, the rest close up; staggered grow-in), optional `sway`. Hover (tooltip with a probability bar,
  same attribute half-dimmed), click selects, `highlight`, `getVisible`. Width follows the slot so neighbours keep a gap.
  Pure `OutcomeBurstLayout` (`slots`, `scale`, `frac`, `strand`, `ribbon`, `stops`, `distanceToPath`;
  `test/OutcomeBurst.test.ts`). Example: `examples/churn.html` (invented telecom, 190 single/paired descriptions, two-thumb
  frequency/probability/lift filters, strongest-drivers table, `?mode=group&theme=light&length=…&order=…`).

  `RootsChart` (canvas, `jsngraph/chart`): "where does it come from" — `actors` (name, `year`, `caption`, `categories`
  = ids, first = main, optional `contribution` {year, label} = second marker on a line) on a time axis band (one faint
  tick per actor year), each tied by a coloured cubic strand (straight down at both ends) to the bar of every category it
  is rooted in; bars side by side along the bottom (header strip + one line per actor, height ∝ count), dotted gradient
  arcs below between categories sharing ≥ `minLink` actors (count at the middle). World-space picture (`width`, default
  1600) through `view/Camera`: auto-fit until the user pans/zooms, wheel/drag/double-click. Hover/click actor, strand, bar
  or arc lights its part (`RootsFocus`; `focus` from outside, `select` pins); `setTime(year)` hides later actors — strands
  grow/shrink, bars count up. Labels drop out below a readable size. `RootsFans`: small multiples, one dial per category
  (or joined ids): rays at `RootsLayout.fanAngle` (from just left of the top counter-clockwise to `split` at the bottom, up
  the right to `to`), hover/focus/`setTime`. Pure `RootsLayout` (`place` = rows without label overlap, nearest free row to
  an id-hashed one; `bars`, `counts`, `links`, `strand`, `arc`, `fanAngle`, `wrap`; `test/Roots.test.ts`). Example:
  `examples/roots.html` (75 people of data-visualization history, Priestley → Lupi, 22 disciplines, year slider + play,
  fans and legend linked; layout idea after Fabrice Sabatier's poster, own data/drawing; `?year=`).

  `LineageChart` (canvas, `jsngraph/chart`): a family tree on a time axis (`LineageNode` id/label/year/parent/end/
  trunk/side/band/mark/labelPosition). Pure `LineageLayout`: `timeScale` linear | compressed (every distinct year a knot,
  gaps weighted gap^0.5), `trunks` (explicit `trunk`, else the child with the largest family continues the parent's row;
  `trunk: false` opts out), `rows` = nested blocks (branches above/below the parent's block, the earlier nearer, side by
  fewer rows so far; risers at the parent's x so blocks never cross), bands stacked below with a gap, each node's
  `incoming` (riser + row) and `tail` (to `end` with a bar, else to the axis end), `lineage` (ancestors + descendants),
  `tags` (orange year pills, staggered on two levels), `colorAt`, `distanceToPath`; `test/Lineage.test.ts`. Chart:
  rounded risers, year tags + grid, band with a year ruler, colour early → modern, `mark` = ring in the dot, label halo,
  Camera pan/zoom/fit, hover/click a dot or line = light its lineage + tooltip, `highlight(ids)`, `select`, `focusNode`,
  `setTime(year)` (lines grow, dashed cursor; a pinned node not yet born lights nothing), `setScale`, canvas legend.
  Example: `examples/lineage.html` (the Unix family, ~45 systems, families, search, replay, detail + year stats).

- `records/` — `RecordGraph` (subpath `jsngraph/records`): cards with a header (icon, title, subtitle) and a table of
  rows (`label`, `value`), links run row → row (`RecordLink {from: {node,row}, to}`), cards may sit in group frames
  (`RecordGroup`, `collapsed` folds a group into one box; merged links keep all `ids`). Pure `RecordLayout`: columns =
  longest path after DFS cycle breaking (`column` overrides), lone cards / frames / collapsed boxes are blocks packed
  per column like a skyline (a frame never covers a foreign card), ordering passes by partner mean keep the pass with
  the shortest vertical link span; a collapsed box sits right of its feeders. Forward links are curves, backward ones
  orthogonal lanes under everything. `RecordQuery`: `lineage` (row up- + downstream, links only, no sibling spill),
  `linkLineage`, `produce` (+1, inputs −1, refuses when one is ≤ 0). Chart: click row/link = highlight flow (again =
  clear), `produce: true` shows "+" on the hovered row, values ≤ 0 are alerts, `RecordIcons` (15 line glyphs or a
  drawer), `RecordTheme` light/dark, Camera pan/zoom/fit. `test/Records.test.ts`. Example: `examples/records.html`
  (made-up bike supply chain with a recycling loop).

- `iso/` — `IsoEditor` (subpath `jsngraph/iso`): isometric architecture diagrams, plan + milestones I1–I6 in
  `docs/iso-editor.md` (status I1–I3 = editor with connectors). DOM + SVG on one stage moved by `view/Camera` (CSS transform): the floor is
  one SVG group under the 2:1 matrix from `IsoProjection` (tile {x,y} covers [x,x+1]×[y,y+1]; X = (u−v)·w/2,
  Y = (u+v)·w/4), so grid (visible tiles only, thinned far out), regions (rounded rects, label along the front edge),
  floor texts (drawn ×100 and scaled 0.01 against font minimums; axis y = `rotate(-90)`) and item base tiles are in tile
  units with `non-scaling-stroke`. Items are absolutely placed divs (`z-index` by `IsoProjection.depth`), label callouts
  (dotted leader, `labelHeight` in tile heights) in a layer above. `IsoIcons`: our own procedural kit — 19 icons from
  isometric solids (`box`, `cylinder`, `band`, panels) in a 100×140 box with the tile centre at (50,115), three shades +
  dark outline from one colour; host types via `icons`/`registerIcons` (`render(color)` → inner SVG, `height`). Viewer:
  pan (drag past 3 px, capture only then), wheel zoom, dblclick fit / `itemDblClick`, click/Shift select, `highlight`,
  `focus` (fly), `fit` (auto until the user moves), `setTheme` (`data-iso-theme`), `setGrid`, `setStyleVars` (`--iso-*`,
  `IsoStyles` `:where()` sheet). Connectors (I2): pure `IsoRoute` (A* over tile + entry direction, turn and
  occupied-tile costs, waypoint legs, `corners`, `centres`, `measure`, `atDistance`/`at`, `arrow`;
  `test/IsoRoute.test.ts`) routes around every item tile; drawn as floor paths under the base tiles (solid/dashed/dotted,
  floor arrowheads just outside the end tiles, SMIL dots, transparent hit path) with upright labels; selection, hover,
  highlight; `updateItem`/`updateConnector` re-route, `getRoute`. Editing (I3, default on; `readOnly` = viewer): modes
  select/connect/region/text/pan (V C R T H), drag-move with tile snap (never onto a staying item, routes follow live),
  Shift lasso, region corner / connector end, waypoint and midpoint handles (own SVG above all labels), inline label
  editor (dblclick/F2), arrows/Delete/Ctrl+Z/Y/A/D, system-clipboard fragments, palette `beginDrag`/`dropAt`, `add*`/
  `update*`/`remove`, undo via `RectHistory`, one `change` per gesture. Pure `IsoModel` (move/canMove/remove/fragment/
  paste/freeTileNear/resizeRegion; `test/IsoModel.test.ts`). `IsoEditor` is a façade (document, history, selection, camera, events) over internal parts reached through `IsoHost`: `IsoScene` (drawing + routing statics), `IsoOverlay` (handles/cursor/draft), `IsoLive` (status/actors), `IsoGestures` (pointer), `IsoKeyboard` (keys/clipboard), `IsoLabelEditor`; DOM behaviour in `test/IsoEditor.test.ts`. Live view (part of I5): `setItemStatus` (floor ring + status
  line + progress bar in the label), `setConnectorStatus` (active/colour), `clearStatus`, `setActors` (moving things at any
  floor point, elements kept per id — fine every frame); depth for all upright things = `IsoProjection.zOf(u, v)`; regions
  with `wall` (back edges, per-tile pieces, `doors` gaps, `IsoProjection.walls`); items `scale`/`flip`. Pure parts tested in
  `test/Iso.test.ts`. `examples/factory.html`: made-up juice plant simulated in the page (stations with cycle times and
  buffers, forklift/conveyor/pipe links along `getRoute`, conveyors as static actors, random faults + a technician walking
  via `IsoRoute`, changeovers, OEE/throughput/order book/automation pyramid); its icons are own drawings from IsoIcons
  primitives in `examples/factory-icons.js` (`window.FactoryIcons`). Example: `examples/iso.html` (made-up web shop, icon-kit gallery linked to highlight).

## Commands

- `npm run dev` — `tsup --watch`. `npm run build` — `dist/index.{js,cjs,d.ts}` (npm) +
  `dist/jsngraph.global.js` (IIFE, `window.JSNGraph`).
- `npm run typecheck` — `tsc --noEmit`. `npm test` — Vitest (`test/**/*.test.ts`).
  Tests of DOM classes opt in per file with `// @vitest-environment happy-dom` (devDependency) and call
  `FakeCanvas.install()` (`test/support/FakeCanvas.ts`: no-op 2d context + `Path2D`, enough to construct and draw,
  no pixels). happy-dom has no pointer capture; stub `hasPointerCapture` where a handler calls it.
- `examples/` — open any page directly in a browser after `npm run build` (each references
  `../dist/jsngraph.global.js`, no bundler needed; shared chrome in `shared.css`).
  Card thumbnails live in `examples/shots/*.webp`; `node scripts/shots.mjs [page …]` regenerates them (headless
  Chrome over the DevTools protocol with real waits — `--virtual-time-budget` leaves rAF canvases blank; needs a
  build, python3, ImageMagick; new cards in `index.html` are picked up automatically).
  `index.html` is a gallery hub linking to: `monitoring.html` (force layout, the network-
  monitoring demo with theme/label toggles, simulated-failure/recover, a jittered load loop),
  `layered.html` (layered + curved edges with a live barycenter-`sweeps` slider and crossing
  counter), `radial.html` (hub-and-ring, agent/gateway, pulse/sublabel), `modelview.html`
  (the `ModelView` architecture viewer, a multimodal Qwen3.5-style graph: a granularity slider
  walks blocks → vision tower + hybrid 24-linear/8-full decoder schedule → layer internals → SDPA
  ops, with nested labelled group frames, "×N" repeats, residual side-routes, animated flow,
  pan/zoom/fit and a click detail panel), `kinds.html` (every
  node kind × shape × status × pulse as a static grid), `api.html` (exercises every public
  method: add/update/remove node+edge, get/setPositions, setTheme, setShowLabels) and
  `explainer.html` (a pan/zoom board documenting the library — each section a jsNGraph diagram,
  plus a section built from the `rect/` kit; composed with `RectBoard` and a scroll-story) and
  `rect-explainer.html` (a second scrollytelling built *only* from `RectBoard` + rect elements,
  no canvas — the kit standing on its own).

## Conventions

- TypeScript, 4-space indent, single quotes, semicolons, `strict` (+ `noUncheckedIndexedAccess`).
- OOP-only, per house style — see the root of this file's author's other projects (e.g. Loki)
  for the same conventions in full.
- Public API conventions (applied across all components, 2026-11): no module-level functions or logic
  constants — helpers are (private) static methods; `on`/`off` return `this` and every component with `on` has
  `off`; boolean state is a getter (`readOnly`, `playing`, `supported`, `paused`, `clustered`); `getX()` returns
  copies (or deep-`Readonly` types) and stored inputs are copied on the way in (huge typed arrays excepted, e.g.
  `VolumeView.setVolume`); no mutable public fields on components (`Camera.scale/offsetX/offsetY` are getters,
  writes via `setState`/`panBy`/`zoomAt`/`flyTo`, non-finite values ignored); every pan/zoom chart has
  `resetView()`; RadarChart's value scale is `valueRange`/`setValueRange`. Renamed names stay as one-line
  `@deprecated` aliases (`isReadOnly`, `isPlaying`, `isSupported`, `isClustered`, `resetZoom`, Radar `range`/
  `setRange`, `paletteColor`, `pickHit`, `CHART_FONT`, …) — examples use the new names. Chart event names stay
  specific (`targetHover`, `barClick`, …) where a chart has several clickable kinds. Runtime state objects
  (`GraphNode`, `GraphEdge`, `ModelNode`) keep public fields; NGraph event payloads are typed `Readonly<…>`.
- Zero runtime dependencies is a deliberate constraint, not an oversight — keep it that way
  unless there's a strong reason (this lib needs to be safe to drop into any consumer without
  dependency/version conflicts).

## V1.1 additions

- `layout/RadialLayout.ts` — deterministic hub-and-ring layout (`layoutMode: 'radial'`,
  `node.ring`: 0 = center); same `tick()` interface as ForceLayout, eases nodes to fixed
  slots so the picture never drifts (built for consumers like nornen's agent-flow view).
- `layout/LayeredLayout.ts` — Sugiyama-style columns (`layoutMode: 'layered'`, `node.ring` =
  column, 0 = left). Crossing reduction is an iterative barycenter sweep that alternates
  forward/backward across the columns (`sweeps` option, default 4) over an adjacency map;
  nodes with no neighbor in the reference column hold their current slot. `edgeStyle: 'curve'`
  draws the workflow-style beziers. See `test/LayeredLayout.test.ts` for the multi-sweep
  crossing-reduction case.
- Node `sublabel` (second label line), `pulse` (animated status-color glow ring),
  kinds `agent` (robot head) + `gateway` (hub hexagon).
- `getPositions()`/`setPositions()` — dragged positions are now persistable.

## V0.2 additions (knowledge-graph readiness, Synaipse plan P5)

- `view/Camera.ts` (moved from `modelview/`, shared): `toScreen`, `viewBounds`, `get/setState`,
  `fitState`/`centerState`, animated `flyTo` + `step(now)` (log-space zoom; any direct move cancels).
  NGraph draws through it: `panZoom` option (default false — embeds keep the wheel), `fit`,
  `focusNode`, `zoomTo`, `get/setViewport`, `screenToWorld`/`worldToScreen`. Layouts still work in
  world coords = the initial screen coords, so V1 pictures are unchanged.
- `view/RenderLoop.ts`: on-demand rAF loop. NGraph's frame returns "keep going" only while the
  layout moves (> 0.05 px/frame), the camera flies, or a visible element animates (traffic dots,
  pulse). Pauses on `visibilitychange` and while the container is 0×0. `ForceLayout` got alpha
  cooling (`alphaDecay` 0.02, `alphaMin`, `reheat()`); without it the loop never idled. Status/load
  `updateNode` patches only redraw, they do not reheat.
- `util/Quadtree.ts` (from Synaipse) for hit-testing + lasso; `util/Geometry.ts`, `util/Color.ts`
  (hex/rgb()/rgba() parsing, canvas fallback for other CSS colors, `lerp`, `withAlpha`, `fromPalette`).
- Style layer `render/StyleResolver.ts`: node `shape: 'dot'`, `color`, `size`, `group`; edge `kind`,
  `directed`, `dashed`, `label`, `color`, `width`; `edgeKinds` table (`EdgeKindPresets.knowledge`);
  `styleNode`/`styleEdge` callbacks win. Theme gained optional `edgeNeutral`, `edgeLabel`,
  `highlightStroke`, `dimOpacity`, `palette`, and `Theme.fromCssVars(el, {base, prefix, map})`.
- Interaction API: `highlight`/`clearHighlight` (dims others), `filter(predicate)`, `neighborhood(id,
  depth, direction)` (`model/GraphQuery.ts`), `select`/`getSelection`/`clearSelection`, ctrl/⌘-click
  toggle, shift+drag lasso, pinch zoom; events `nodeDblClick`, `edgeClick`, `contextMenu`,
  `selectionChange`, `viewportChange`, `nodeDragEnd`, `layoutSettle`. Labels hide below `labelMinZoom`.
- Edge hover: `edgeTooltip` option (default on, "A ↔ B · label/load", → when directed; function or false),
  `edgeHover` event, hovered edge drawn wider on top. Nodes win over edges; the edge hit-test only runs when a
  tooltip or listener wants it (`wantsEdgeHover`), and not when clustered / below `edgeMinZoom`.
- Example: `examples/knowledge.html`.
- `examples/livingmap.html`: a growing agent mesh in 3D — projection in the page, `setPositions` per frame,
  depth/growth/focus via style opacities (bucketed for batching), glow via an overlay blurred once per frame.

## Team look (NeuraTeam-style people network)

- Node `image` (avatar/logo URL or data: URL, cover-cropped into the circle or the card's icon chip; loaded once
  by `render/ImageCache.ts`, icon shows until loaded/on error, a load requests a frame), `badge` + `badgeColor`
  (count bubble top-right; '' / 0 hides). `labelStyle: 'pill'` option / `setLabelStyle` (rounded backdrop,
  inverted for hovered/selected); per node via `NodeStyle.labelBackground` (+ `image`, `badge`, `badgeColor`).
- `LayeredLayout` `direction: 'down'`: layers as rows top→bottom (`ring` = row).
- Example: `examples/team.html` (generated initial avatars, quiet neutral mesh, conversation lights an edge).

## Ownership look (OSINT / company-network style)

- Node `fill` + `iconColor` (solid disc, light glyph; outline follows the fill unless `color` is set); new kinds
  `person`, `company`, `location`, `web`, `phone`, `group`; `NodeStyle.icon` also takes a `NodeIconDrawer` function.
- `badges: NodeBadge[]` on any corner (`position`), each a text pill, a glyph disc or an image (flag: 4:3 rect,
  or `shape: 'circle'`); images go through the same `ImageCache`. `NodeRing.gap` (white space before a risk ring).
  Label size grows with big nodes (`labelSize`, bold from 12.5 px); label offset accounts for the ring.
- Parallel edges: `model/EdgeLanes.ts` (pure, `test/EdgeLanes.test.ts`) gives each edge of a same-pair bundle a lane
  (both directions count, reversed edges negated) and `bundle` size; `CanvasRenderer.edgeCurve` bows lane ≠ 0 into a
  quadratic-as-cubic (directed ones end at the rim), shared by drawing, labels, dots and edge hit-testing; lane ≠ 0
  edges are never batched/sent to WebGL. ForceLayout divides spring force by `bundle`, so a bundle is one spring.
- Edge labels: `\n` breaks lines.
- Example: `examples/skilltree.html` — an invented game skill tree on `layoutMode: 'static'`: icon-function nodes,
  learned/learnable/locked purely through `styleNode`/`styleEdge` over a page-side set (`repaint` after a change),
  point budget with unlearn only when nothing else is cut off from the root, search via `highlight`, banners as an
  'under' overlay.
- Example: `examples/ownership.html` (fictional; seeds company positions and leaves next to their neighbour —
  random starts left leaves on the wrong side of the hub).

## Flow look (multi-column neon flows)

- `glow` option `{nodes, edges}` / `NodeStyle.glow` / `EdgeStyle.glow` (world px): nodes get a radial halo in their
  accent (stronger when hovered/highlighted), edges two wider translucent strokes under them — also in the batched and
  WebGL paths, so it stays cheap for many edges.
- `labelPosition` option / `NodeStyle.labelPosition`: 'below' | 'right' | 'left' | 'above' (`CanvasRenderer.labelAnchor`,
  shared by drawing and label collision).
- `edgeColor: 'source' | 'target'`: an edge takes its endpoint's accent (color → group colour → fill), so branches keep
  their colour. `setLook({glow, labelPosition, edgeColor})` changes all three later.
- `LayeredLayout`: `grid: {ring: subColumns}` (+ `gridGap`) packs a layer row by row (a bit matrix); grid width of the
  outer layers is kept inside the margins. `columns` = where each layer landed (ring, pos, halfWidth, count).
- `columnHeaders` option / `setColumnHeaders` (layered, direction 'right' only): `ColumnHeaders` overlay — screen-space
  title band ("STREAMS (3)") over everything, separators under the edges, spans split halfway between columns.
- `GraphQuery.lineage` / `NGraph.lineage(id)`: everything up- and downstream (unlike `neighborhood(…, Infinity)` it
  does not spill into sibling branches) — highlight it on hover for the "light the path" effect.
- Tests: `test/FlowLook.test.ts`. Example: `examples/flow.html` (two tabs: streams → channels → frames → groups →
  bit grid, and a 3 → 50 → 5 stages → bits → 1 fan-out; side KPIs/sparklines, live bit flips).

## Known gaps (V1)

- No built-in toolbar (pause/labels/etc.) — that's presentation-specific, left to the consuming
  app; `examples/index.html` shows a minimal one.
- Visual match to the yFiles reference demo was done from a textual description (no ability to
  view the live demo during development) — if it's ever compared side by side, expect to tune
  `Theme.ts` / `NodeIcons.ts` rather than the architecture.
