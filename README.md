# jsNGraph

Interactive network topology graph rendering — TypeScript, Canvas, force-directed layout,
zero runtime dependencies. Styled after network-monitoring dashboards: devices as icon nodes,
edges colored green→yellow→red by traffic load, animated traffic dots, status rings, a
click-to-open detail panel.

## Install

Not published yet — consume it locally from a sibling checkout:

```bash
npm install ../jsNGraph
```

Or, with no build step at all, drop the browser bundle straight into an HTML page:

```html
<script src="path/to/jsNGraph/dist/jsngraph.global.js"></script>
<script>
  const graph = new JSNGraph.NGraph(document.getElementById('graph'), {theme: 'dark'});
</script>
```

## Usage

```ts
import { NGraph } from 'jsngraph';

const graph = new NGraph(document.getElementById('graph')!, {theme: 'dark'});

graph.setData(
    [
        {id: 'router-1', label: 'Core Router', kind: 'router', status: 'ok', load: 0.4, fixed: true},
        {id: 'srv-1', label: 'App Server', kind: 'server', status: 'ok', load: 0.5, ip: '10.0.1.10'}
    ],
    [
        {id: 'e1', source: 'router-1', target: 'srv-1', load: 0.5}
    ]
);

graph.on('nodeClick', (node) => console.log(node?.id));

// Live updates — e.g. from a polling loop or a websocket:
graph.updateNode('srv-1', {load: 0.82, status: 'warning'});
graph.updateEdge('e1', {load: 0.9});
```

Node kinds: `pc | laptop | tablet | server | database | router | agent | gateway | generic`.
Extra node fields: `sublabel` (small second line), `pulse` (animated status-color glow),
`ring` (for the radial layout). Options: `layoutMode: 'force' | 'radial'` — radial is a
deterministic hub-and-ring arrangement (ring 0 = center) that never drifts.
Positions: `getPositions()` / `setPositions(map, fix?)` persist a hand-arranged view.
Status: `ok | warning | critical | down` (drives the status ring + a stop-sign overlay for `down`).

### Knowledge graphs: style layer, camera, selection

Device kinds are just one preset. For notes/wiki graphs use plain dots, groups and edge kinds:

```ts
import { NGraph, EdgeKindPresets, Theme } from 'jsngraph';

const graph = new NGraph(el, {
    theme: Theme.fromCssVars(document.documentElement),   // --jsng-* or mapped host vars
    panZoom: true,                                        // wheel/pinch zoom, drag-to-pan
    edgeKinds: EdgeKindPresets.knowledge,                 // wikilink, typed, supersedes, tag, semantic
    styleNode: (n) => n.id === currentNote ? {radius: 12} : null
});

graph.setData(
    [{id: 'a', label: 'Note A', shape: 'dot', group: 'Projects', size: 6}, /* … */],
    [{id: 'e', source: 'a', target: 'b', kind: 'supersedes', label: 'supersedes'}]
);

graph.highlight(graph.neighborhood('a', 2));             // dims everything else
graph.fit({animate: true});
graph.focusNode('a', {scale: 2});
graph.on('selectionChange', (ids) => …);                 // click, ctrl/⌘-click, shift+drag lasso
```

- Node fields: `shape: 'circle' | 'card' | 'dot'`, `color`, `size`, `group` (stable palette color).
- Edge fields: `kind`, `directed`, `dashed`, `label`, `color`, `width`. Precedence: defaults →
  data/kind preset → `styleNode`/`styleEdge` callback.
- Camera: `fit`, `focusNode`, `zoomTo`, `get/setViewport`, `screenToWorld`/`worldToScreen`.
- Interaction: `highlight`, `filter`, `neighborhood`, `select`/`getSelection`; events `nodeClick`,
  `nodeDblClick`, `edgeClick`, `contextMenu`, `selectionChange`, `viewportChange`, `nodeDragEnd`,
  `layoutSettle`.
- Rendering is on demand: the force layout cools down (`alphaDecay`), the loop idles once
  nothing moves, and pauses while the page is hidden or the container has no size. `pause()` /
  `resume()` for hosts that hide the view themselves.

## Development

```bash
npm install
npm run dev          # tsup --watch
npm run build         # dist/index.{js,cjs,d.ts} + dist/jsngraph.global.js (IIFE, window.JSNGraph)
npm run typecheck
npm test
```

Open `examples/index.html` directly in a browser (no build step needed once `npm run build`
has produced `dist/jsngraph.global.js`) for a live demo with theme/label toggles and a
simulated failure button.

## Design notes

- **Canvas, not SVG/DOM-per-node** — chosen for headroom at higher node counts; hit-testing
  for hover/click/drag is done manually (`InteractionController`) against a `Quadtree`
  rebuilt only when positions change; off-screen nodes and edges are culled.
- **Custom force-directed layout** (`ForceLayout`) — plain O(n²) repulsion + edge springs +
  centering, no d3-force dependency. Includes a distance floor and per-tick speed cap on top
  of the physics (a naive 1/d² repulsion term is numerically unstable when two nodes start
  out coincident — worth keeping if you tune the constants) plus a hard collision-resolution
  pass so nodes never visually overlap regardless of how the forces are tuned.
- **Detail panel / tooltip are plain DOM+CSS overlays**, not canvas-drawn — crisper text,
  no extra charting dependency for the one load bar.
- Zero runtime dependencies by design, to stay safe to drop into any project (bundler-based
  or plain `<script>`) without pulling in a physics or charting library.

## Status

V1: canvas rendering, force layout with collision resolution, hover/click/drag interaction,
dark/light themes, live `updateNode`/`updateEdge`, click-to-open detail panel. Not yet built:
edge-hover load tooltip, save/restore of dragged positions, a toolbar (left to the consuming
app — see `examples/index.html` for a sample one).
