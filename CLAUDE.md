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

## Commands

- `npm run dev` — `tsup --watch`. `npm run build` — `dist/index.{js,cjs,d.ts}` (npm) +
  `dist/jsngraph.global.js` (IIFE, `window.JSNGraph`).
- `npm run typecheck` — `tsc --noEmit`. `npm test` — Vitest (`test/**/*.test.ts`).
- `examples/index.html` — open directly in a browser after `npm run build` (references
  `../dist/jsngraph.global.js`, no bundler needed) for a live demo with theme/label toggles,
  a simulated-failure button, and a `setInterval` load-jitter loop for the "live monitoring" feel.

## Conventions

- TypeScript, 4-space indent, single quotes, semicolons, `strict` (+ `noUncheckedIndexedAccess`).
- OOP-only, per house style — see the root of this file's author's other projects (e.g. Loki)
  for the same conventions in full.
- Zero runtime dependencies is a deliberate constraint, not an oversight — keep it that way
  unless there's a strong reason (this lib needs to be safe to drop into any consumer without
  dependency/version conflicts).

## Known gaps (V1)

- No edge-hover tooltip (only node hover).
- Dragged node positions are not persisted/restorable.
- No built-in toolbar (pause/labels/etc.) — that's presentation-specific, left to the consuming
  app; `examples/index.html` shows a minimal one.
- Visual match to the yFiles reference demo was done from a textual description (no ability to
  view the live demo during development) — if it's ever compared side by side, expect to tune
  `Theme.ts` / `NodeIcons.ts` rather than the architecture.
