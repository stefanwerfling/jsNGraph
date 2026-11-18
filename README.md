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

### Large graphs: static layout, hulls, effects

For thousands of nodes whose layout is computed elsewhere (a server, a worker, a saved
arrangement), skip the simulation and draw what you are given:

```ts
const graph = new NGraph(el, {
    layoutMode: 'static',                                 // positions come from node x/y, drag still works
    panZoom: true,
    styleNode: (n) => heat.has(n.id) ? {ring: {color: '#ffd166', width: 3, opacity: 0.8}} : null
});

graph.setData(nodesWithXY, edges);
graph.setHulls([{id: 'Projects', nodeIds: projectIds, label: 'Projects'}]);   // padded cluster outlines
graph.hullsAt(x, y);                                     // hull ids under a point, for tooltips

graph.pulse(['a', 'b'], '#34d399');                      // flash a ring
graph.trail('a', 'b', '#6c9aff');                        // fading arc between two nodes
graph.ripple('a', '#ffd166');                            // circles spreading out from a node

const remove = graph.addOverlay({layer: 'over', draw: (ctx, info) => { /* world coords */ return false; }});
```

- Labels that would overlap a more important one (hovered, selected, highlighted, bigger) are
  skipped (`labelCollision`, default on).
- Plain straight edges are stroked in one path per look, so edge count barely matters.
- Effects follow their nodes, keep their size on screen at any zoom, and remove themselves;
  the render loop runs only while one is active. `addOverlay` is the same hook for your own
  drawings (return `true` while animating).
- `examples/vault.html`: 1 000–6 000 notes with folder hulls, heat rings and effects. A frame
  of 3 000 notes takes ≈ 6 ms in the overview and ≈ 3 ms zoomed in (Chrome, desktop).

### Very large graphs: level of detail and clusters

From tens of thousands of nodes on, the overview is drawn from clusters (communities,
folders) instead of single nodes:

```ts
const graph = new NGraph(el, {
    layoutMode: 'static',
    panZoom: true,
    minZoom: 0.01,
    labelMinZoom: 1.5,                                    // node labels only when zoomed in
    edgeMinZoom: 0.6,                                     // edges only when zoomed in
    clusterZoom: 0.25                                     // below: clusters instead of nodes
});

graph.setData(nodesWithXY, edges);
graph.setClusters(
    [{id: 'c1', nodeIds: memberIds, label: 'Projects'}],  // x/y/size/radius optional (centroid, count, spread)
    [{source: 'c1', target: 'c2', weight: 42}]            // aggregated edges, width by weight
);
graph.on('clusterClick', (id) => graph.focusCluster(id)); // zoom in until the members show
graph.clusterAt(x, y);                                    // cluster id under a point, for tooltips
graph.isClustered();                                      // true while the clusters are drawn
graph.repaint();                                          // redraw only (e.g. a styleNode input changed)
```

- A cluster disc grows with its member count but stays inside the cluster's extent, so
  neighbours do not overlap. Labels appear only where they cover no disc.
- From 2 000 nodes on, a frame only visits the nodes in view (quadtree query).
- Dots smaller than 2 px on screen are drawn as batched squares (at least ≈ 1 px wide).
- `examples/atlas.html`: 20 000–100 000 notes. One overview frame of 100 000 notes takes
  ≈ 3 ms with clusters (≈ 60 ms without, ≈ 500 ms before this level of detail). Zoomed in
  it takes ≤ 6 ms (Chrome, desktop).

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
