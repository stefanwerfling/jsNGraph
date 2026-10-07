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
  `Matrix` (axis-labeled grid), `Timeline` (opt. cursor/ticks). Labels (`RectLabels.ts`):
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
  camera fly-throughs — the scrollytelling the explainer runs on. Deterministic (`RectRandom`),
  inline-styled like the other DOM overlays — no stylesheet for static use, zero deps. Not
  canvas/graph-related; shares the package because consumers compose it alongside NGraph (see
  `examples/explainer.html`). All exported from `index.ts`.

## Commands

- `npm run dev` — `tsup --watch`. `npm run build` — `dist/index.{js,cjs,d.ts}` (npm) +
  `dist/jsngraph.global.js` (IIFE, `window.JSNGraph`).
- `npm run typecheck` — `tsc --noEmit`. `npm test` — Vitest (`test/**/*.test.ts`).
- `examples/` — open any page directly in a browser after `npm run build` (each references
  `../dist/jsngraph.global.js`, no bundler needed; shared chrome in `shared.css`).
  `index.html` is a gallery hub linking to: `monitoring.html` (force layout, the network-
  monitoring demo with theme/label toggles, simulated-failure/recover, a jittered load loop),
  `layered.html` (layered + curved edges with a live barycenter-`sweeps` slider and crossing
  counter), `radial.html` (hub-and-ring, agent/gateway, pulse/sublabel), `kinds.html` (every
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

## Known gaps (V1)

- No edge-hover tooltip (only node hover).
- No built-in toolbar (pause/labels/etc.) — that's presentation-specific, left to the consuming
  app; `examples/index.html` shows a minimal one.
- Visual match to the yFiles reference demo was done from a textual description (no ability to
  view the live demo during development) — if it's ever compared side by side, expect to tune
  `Theme.ts` / `NodeIcons.ts` rather than the architecture.
