# jsNGraph

Interactive graph rendering for the browser — TypeScript, zero runtime dependencies. Four
parts that share one camera and one theme, plus small standalone widgets:

- **`NGraph`** — network topology and knowledge graphs on Canvas: force/radial/layered/static
  layouts, devices as icon nodes, edges colored green→yellow→red by traffic load, animated
  traffic dots, status rings, a click-to-open detail panel; level of detail up to 100 000 nodes.
- **`WorkflowEditor`** — a node-based workflow editor and viewer (DOM + SVG): typed ports,
  connections, undo, sub-workflows, run status and run replay. Graphics only; what a node
  does stays in your app.
- **`ModelView`** — a pan/zoom viewer for model architectures with granularity levels.
- **Rect kit / `RectBoard`** — DOM+SVG diagram blocks, mini charts and connectors on a pan/zoom
  board, for explainers and wiring diagrams; optionally editable.
- **Widgets** — `DayClock`, a working day on one 24 h dial (SVG).

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

`jsngraph` exports everything. To keep the parts you don't use out of your
bundle, import one part instead; they share their code, so a class is the
same class whichever path you import it from:

| Import | Contains | Minified (gzip) |
|---|---|---|
| `jsngraph/graph` | `NGraph`, styles, theme, effects, camera, geometry | ≈ 78 KB (25 KB) |
| `jsngraph/rect` | rect kit, `RectBoard`, the small charts | from ≈ 11 KB, by what you import |
| `jsngraph/modelview` | `ModelView` | ≈ 26 KB (9 KB) |
| `jsngraph/workflow` | `WorkflowEditor` and its helpers | ≈ 103 KB (29 KB) |
| `jsngraph/widget` | `DayClock` | ≈ 9 KB (3 KB) |
| `jsngraph` | all of it | ≈ 254 KB (76 KB) as a namespace |

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

## Workflow editor

A node-based workflow editor; `readOnly: true` makes the same widget a viewer. You describe
node *types* (label, icon, colour, ports); the widget owns the document and its undo history
and reports every finished gesture.

```ts
import { WorkflowEditor, WorkflowReplay } from 'jsngraph/workflow';

const editor = new WorkflowEditor(el, {
    types: [
        {type: 'webhook', label: 'Webhook', icon: '⚡', color: '#ff6d5a', outputs: [{id: 'main'}]},
        {type: 'if', label: 'If', icon: '?', inputs: [{id: 'main'}],
            outputs: [{id: 'true', label: 'true'}, {id: 'false', label: 'false'}]},
        {type: 'llm', label: 'Chat model', outputs: [{id: 'model', kind: 'model', side: 'top'}]}
    ],
    canConnect: (from, to, doc) => true,                  // your veto (or a reason string)
    minimap: true
});

editor.setDocument({nodes, connections, notes, groups});
editor.on('change', (c) => save(editor.getDocument()));  // one event per gesture: move, connect, group …
editor.on('addRequest', (e) => openPicker(e, (type) => editor.addNodeFrom(e.port, e.dir, {type})));
editor.on('nodeDblClick', (e) => openParameters(e.id));

// Run status is display only — your engine feeds it while it executes:
editor.startRecording();
editor.setNodeStatus('fetch', 'running');
editor.setConnectionStatus('c2', {items: 3, active: true});
editor.setNodeStatus('mail', 'error', {message: 'SMTP timeout'});
editor.setRunPath(executedNodes, travelledConnections);   // dims what did not run
const run = editor.stopRecording();

new WorkflowReplay(editor, run, {autoplay: true});        // play it back: scrubber, steps, speed
```

- Ports: `kind` (only equal kinds connect), `side` (sockets at the bottom/top), `max`.
- Editing: drag to connect, "+" on free ports and on connections ask your picker
  (`addRequest` / `insertRequest`), palette drag-in (`beginDrag`), copy/paste through the
  clipboard, delete re-links chains, sticky notes, connection labels, `tidyUp()`.
- Sub-workflows: `doc.groups`; a collapsed group is one node with proxy ports; groups nest.
- Look: `:where()` CSS over `--wf-*` variables, `setStyleVars`, dark/light.
- Full reference: [`docs/workflow-editor.md`](docs/workflow-editor.md); live demo `examples/workflow.html`.

## Model view

A renderer for model architectures — it never fetches or parses a model; you hand it modules
and flows built from whatever source you have:

```ts
import { ModelView } from 'jsngraph/modelview';

const view = new ModelView(el, {theme: 'dark'});

view.setData({
    modules: [
        {id: 'emb', kind: 'embedding', label: 'Embeddings', detail: {shape: '[V, 2560]'}},
        {id: 'layers', kind: 'block', label: 'Decoder layer', repeat: 32},
        {id: 'attn', kind: 'attention', label: 'Attention', parent: 'layers', level: 1},
        {id: 'mlp', kind: 'mlp', label: 'MLP', parent: 'layers', level: 1},
        {id: 'head', kind: 'head', label: 'LM head'}
    ],
    flows: [
        {source: 'emb', target: 'attn', animated: true},
        {source: 'attn', target: 'mlp'},
        {source: 'emb', target: 'mlp', kind: 'residual'},
        {source: 'mlp', target: 'head'}
    ]
});

view.setLevel(1);                                         // 0 = blocks; getMaxLevel() for the finest
```

Flows are written between the finest modules; coarser levels are derived by collapsing onto
parents. Top-down layout, residual/skip edges routed beside the main path, "×N" repeats,
labelled frames around opened parents, a click detail panel. Demo: `examples/modelview.html`.

## Rect kit and boards

Plain DOM+SVG pieces for explainers and wiring diagrams — blocks (`RectBox`, `RectGroup`),
mini charts (`Heatmap`, `BarStrip`, `Sparkline`, `Scatter`, `Network`, `Matrix`, `Timeline`, …),
labels and connectors — placed on a `RectBoard` with its own pan/zoom camera:

```ts
import { RectBoard, RectBox, Heatmap } from 'jsngraph/rect';

const board = new RectBoard(el);

board.add(new RectBox({title: 'Signal', body: new Heatmap({rows: 4, cols: 10, scan: true}).render()}).render(), 0, 0, 'in');
board.add(new RectBox({title: 'Decoder', accent: 'green', glow: true}).render(), 320, 0, 'dec');
board.connect('in', 'dec', {style: 'curve', dots: true, label: 'spikes'});
board.story(['in', 'dec'], {onStep: (i) => …});          // wheel / arrow keys fly from step to step
```

Charts are seeded (`seed`) for illustration or take your data (`values` / `series`).
`editable: true` turns the board into an editor surface (drag, resize, connect, reroute, one
`commit` event per gesture). Demos: `examples/rect-explainer.html`, `examples/rect-editor.html`.

## Day clock

A working day on one 24 h dial (00:00 top, 06:00 right, 12:00 bottom, 18:00 left): the elapsed
part is shaded, a hand marks now, each appointment is an arc from start to end with a dot at its
start — overlapping ones on separate rings — coloured done / running / planned:

```ts
import { DayClock } from 'jsngraph/widget';

const clock = new DayClock(el, {theme: 'auto', live: true, nowLabel: 'Now'});

clock.setItems([
    {id: 'a1', start: new Date(2026, 10, 22, 8, 15), end: new Date(2026, 10, 22, 10, 30), label: 'Install heat pump'},
    {id: 'a2', start: new Date(2026, 10, 22, 12, 15), end: new Date(2026, 10, 22, 13, 0), label: 'Lunch', color: '#e0a52a'}
]);
clock.on('itemClick', (e) => openAppointment(e.item.id));
clock.on('itemHover', (e) => highlightRow(e?.item.id));   // null when the pointer leaves
DayClock.state(item, new Date());                         // 'past' | 'running' | 'upcoming', for your own list
```

- Options: `theme` (`auto` follows the OS), `size` (max dial width, default 290), `maxRings`
  (default 4), `locale` for the times, `now` (a fixed moment — `setNow(date | null)`), `live`
  (redraw every 30 s).
- Only items touching the day of "now" are drawn; items across midnight are cut at the edge.
- Colours are `--dc-*` CSS variables (`setStyleVars`), rules are zero-specificity `:where()`.
- Demo: `examples/dayclock.html` (with a time-travel slider).

## Development

```bash
npm install
npm run dev          # tsup --watch
npm run build         # dist/index.{js,cjs,d.ts} + dist/jsngraph.global.js (IIFE, window.JSNGraph)
npm run typecheck
npm test
```

Open `examples/index.html` directly in a browser (no build step needed once `npm run build`
has produced `dist/jsngraph.global.js`): a gallery linking to every demo — network monitoring,
layered/radial layouts, knowledge graph, 6 000-note vault, 100 000-note atlas, workflow editor,
model view, rect explainers, the board editor and the day clock.

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

All four parts and the day clock are in use. Not published to npm yet (see Install). There is deliberately no
built-in toolbar — pause, label and theme buttons belong to the page; the examples show sample
ones.
