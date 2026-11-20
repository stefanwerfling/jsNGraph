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
  `ModelView.computeGroups` builds a `GroupFrame` (padded bbox + label tab + ×N) per expanded
  parent, padded more for outer groups so nested frames sit cleanly inside. Reuses `render/Theme.ts`
  and `ui/Tooltip.ts` from NGraph; `ModelView.ts` auto-fits on every resize until the user pans/zooms.
  See `examples/modelview.html`.

## Commands

- `npm run dev` — `tsup --watch`. `npm run build` — `dist/index.{js,cjs,d.ts}` (npm) +
  `dist/jsngraph.global.js` (IIFE, `window.JSNGraph`).
- `npm run typecheck` — `tsc --noEmit`. `npm test` — Vitest (`test/**/*.test.ts`).
- `examples/` — open any page directly in a browser after `npm run build` (each references
  `../dist/jsngraph.global.js`, no bundler needed; shared chrome in `shared.css`).
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
- Example: `examples/knowledge.html`.

## Known gaps (V1)

- No edge-hover tooltip (only node hover).
- No built-in toolbar (pause/labels/etc.) — that's presentation-specific, left to the consuming
  app; `examples/index.html` shows a minimal one.
- Visual match to the yFiles reference demo was done from a textual description (no ability to
  view the live demo during development) — if it's ever compared side by side, expect to tune
  `Theme.ts` / `NodeIcons.ts` rather than the architecture.
