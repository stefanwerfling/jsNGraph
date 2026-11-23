# Isometric diagram editor — plan

An isometric architecture-diagram widget for jsNGraph: devices and services as
3D-looking icons standing on a tile grid, regions (zones, VPCs, racks) as
coloured areas on the floor, connectors routed along the grid with arrows,
labels and travelling dots, text printed on the floor. One widget, `IsoEditor`,
owns the picture; `readOnly: true` makes it a viewer — and, with live status
on items and connectors, a monitoring view (the NGraph use case, drawn in 3D).

All code and all icons are new and our own; nothing is taken over from other
isometric editors. Zero runtime dependencies, as everywhere in the library.

## Scope

**In jsNGraph (graphics only):** projection, grid, camera, items with icons and
labels, regions, connectors with routing, floor text, editing gestures,
undo/redo, export (JSON / SVG / PNG), live-status display, theming.

**In the consuming app:** what an item *is* (inventory, monitoring source),
persistence, several pages/views (the app keeps one document per page), its own
palette and inspector UI. The widget emits events and takes documents; the
example shows a palette and an inspector built on that API.

## Architecture — `src/iso/`, subpath `jsngraph/iso`

| File | Role |
|---|---|
| `IsoTypes.ts` | Public types: document, items, connectors, regions, texts, icon types, events. |
| `IsoProjection.ts` | Pure: tile ↔ screen (2:1 dimetric: `x = (c − r)·W/2`, `y = (c + r)·H/2`), the SVG matrix of the floor plane, screen → tile picking, depth key (`c + r`), view rotation (0/90/180/270°) as a tile remap. Tested. |
| `IsoModel.ts` | Pure document model: add/update/remove/move items, regions, connectors, texts; occupied tiles; anchors that follow moved items; fragments for copy/paste. Tested. |
| `IsoRoute.ts` | Pure connector routing on the grid: A* over tiles with 4-neighbours, cost for turns and for crossing occupied tiles, optional user waypoints (route = chain of A* legs), simplify to corners, length, point/tangent at a fraction (labels, arrows, dots). Tested. |
| `IsoIcons.ts` | Our own procedural icon kit: SVG built from isometric primitives (box, slab, cylinder, panel/screen, prism, person) with three face shades derived from one colour (top light, left mid, right dark). ~16 built-ins: server, rack, database, storage, laptop, desktop, phone, user, router, switch, firewall, load balancer, cloud, queue, cache, function, container. Host icons: `{id, svg \| url \| render(color), isometric?: boolean}` — non-isometric ones are laid flat onto the tile through the floor matrix. |
| `IsoStyles.ts` | `:where()` rules over `--iso-*` CSS variables, dark + light, injected once (same pattern as `WorkflowStyles`). |
| `IsoEditor.ts` | The widget: layers, camera, gestures, keyboard, undo, events, status. |
| `IsoExport.ts` | Self-contained SVG string of the document (fonts as system stack, icons inline), PNG via an offscreen canvas `drawImage` of that SVG. |

### Rendering

DOM + SVG, like the workflow editor (hundreds of items at most, crisp text,
host content possible), on one stage moved by `view/Camera` (CSS transform):

1. **Floor layer** — one SVG `<g>` with the isometric matrix, everything in tile
   units: grid lines, regions (rounded rects), tile hover/selection diamonds,
   connectors (polylines on tile centres, dashes, arrows), floor texts, flat
   icons. One transform = no per-element projection maths.
2. **Upright layer** — icons and label callouts as absolutely positioned
   elements at the projected tile centre, `z-index` = depth key, so nearer
   items cover farther ones. Label = box raised by `labelHeight` with a dotted
   leader down to the icon.
3. **Overlay** — handles (region corners, connector waypoints), lasso band,
   drag preview, in-place text editor.

Connector labels are upright (readable), placed at `labelAt` (0…1) along the route.

Reused: `view/Camera` (pan/zoom/fit/fly), `rect/RectHistory` (undo),
`util/EventEmitter`, the `beginDrag`/`dropAt` and clipboard patterns of
`WorkflowEditor`, `util/Color` for the face shades.

### Data model

```ts
interface IsoTile { x: number; y: number }
interface IsoItem {
    id: string; tile: IsoTile; icon: string;
    label?: string; description?: string;
    color?: string;            // icon base colour (faces shaded from it)
    labelHeight?: number;      // tiles the callout floats above the icon (0 = no callout)
    meta?: unknown;
}
type IsoAnchor = {item: string} | {tile: IsoTile};
interface IsoConnector {
    id: string; from: IsoAnchor; to: IsoAnchor;
    via?: IsoTile[];           // user waypoints
    style?: 'solid' | 'dashed' | 'dotted'; width?: number; color?: string;
    arrows?: 'none' | 'end' | 'both'; label?: string; labelAt?: number;
    animated?: boolean;        // dots travelling from → to
}
interface IsoRegion { id: string; from: IsoTile; to: IsoTile; color?: string; label?: string }
interface IsoText { id: string; tile: IsoTile; text: string; size?: number; axis?: 'x' | 'y'; color?: string }
interface IsoDocument { items: IsoItem[]; connectors: IsoConnector[]; regions?: IsoRegion[]; texts?: IsoText[] }
```

Decisions:

- **One item per tile**; items are 1×1 tiles (a later `size` can widen them).
- **Connectors route on the grid** (axis-parallel along tile centres), which is
  what makes the isometric look clean; the route is recomputed when an end
  moves, waypoints pin it.
- **The widget owns the document** — `getDocument`/`setDocument`, built-in
  undo/redo, one `change` event per finished gesture, `readOnly`/`setReadOnly`.
  Unknown icons render as a generic box, so a viewer never drops data.
- **Live status is not document data** (as in the workflow editor):
  `setItemStatus(id, 'ok' | 'warn' | 'down' | 'unknown', {message?})` (floor glow
  ring + badge, pulse when down), `setConnectorStatus(id, {load?, active?})`
  (load colours green → red, dot speed), `clearStatus()`.

## Milestones

Status: I1–I3 done (`examples/iso.html`); part of I5 (live status, actors) and region walls done for
`examples/factory.html`.

Live view as built: `setItemStatus(id, {state: ok | warn | down | idle, message?, progress?})` — a status ring on the floor
(dashed when idle, pulsing when down) plus a status line and a progress bar inside the item's label; `setConnectorStatus(id,
{active?, color?})` — inactive = dimmed without dots; `clearStatus()`. Status is display state, re-applied after every
render, never in the document. `setActors([{id, icon, u, v, color?, scale?, flip?, title?}])` places moving things at any
floor point; elements are kept per id and only moved (cheap enough for every frame). Depth is a z-index from the floor
position for everything upright (`IsoProjection.zOf(u, v)`: items, labels, actors with a small bias so a crate on a
conveyor shows, wall pieces). `IsoRegion.wall` (tile heights) draws the two back edges as walls, one SVG per tile piece so
each gets its own depth, `doors` leave gaps (`IsoProjection.walls`). `IsoItem.scale` / `flip` (flip = mirror, which turns
an icon drawn along u onto the v axis).

I3 as built: `IsoModel` (pure, `test/IsoModel.test.ts`) — `normalize`, `kindOf`, `occupied`, `freeTileNear`, `canMove` /
`move` (waypoints and free ends travel along when the connector or both its items move), `remove` (with the connectors
of removed items), `fragment` / `origin` / `paste` (fresh per-prefix ids, items onto the nearest free tile), `uid`,
`resizeRegion`. The editor is no longer read-only by default. Modes `select | connect | region | text | pan` (keys V C R T
H, `setMode`, `modeChange`). Select mode: click / Shift / Ctrl, Shift-drag lasso (items by centre, regions fully inside,
texts, plus connectors whose items are both in), drag moves the selection tile by tile — a move onto a staying item keeps
the last valid place, connectors re-route live —; a region only drags when already selected (otherwise the drag pans).
One selected region shows corner handles, one selected connector shows end handles (drag = re-attach to an item or a
tile), waypoint handles (drag, double-click removes) and a midpoint dot on segments ≥ 3 tiles (drag = new waypoint);
handles live in their own floor SVG above every label, and the selected connector's label lets clicks through.
Connect: drag or click-click from item/tile to item/tile with a live draft route. Region: drag out a rectangle. Text:
click places "Text" and opens the inline editor. Double-click / F2 edit labels in place (an `<input>` over the label;
an empty text removes it). Keys: arrows move, Delete, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Ctrl+A, Ctrl+D duplicate, Esc
cancels → select mode → clears. Clipboard: copy/cut/paste on the system clipboard as `{"jsngraph-iso": fragment}`, pasted
at the pointer tile. Palette: `beginDrag(icon, pointerEvent, data)` (ghost at the current zoom, dashed target tile) /
`dropAt`. Undo: `RectHistory` snapshots, one `change` event `{kind, ids}` per finished gesture or API call
(`addItem/Connector/Region/Text`, `update*`, `remove`, `undo`/`redo`, `canUndo`/`canRedo`); `setDocument` resets it.

I2 as built: `IsoRoute` A* runs over (tile, entry direction) states — 1 per step, `turnCost` 0.6 per turn, `blockedCost` 12
per occupied tile crossed (the end tiles are free), never straight back, search box = the ends ± `margin` 8, a plain L
route as fallback; waypoints are legs that keep the incoming direction. The editor blocks every item tile, draws the
corners' tile centres as one floor path under the base tiles (`non-scaling-stroke`, so widths/dashes are screen-stable
px at zoom 1), arrowheads as floor triangles 0.62 tiles off an item centre (just outside its base tile), a ring at a free
tile end, three SMIL `animateMotion` dots for `animated` (skipped under reduced motion), a 16 px transparent hit path, and
the label as an upright div at `labelAt`. Connectors take part in selection, hover (`connectorHover`/`connectorClick`) and
`highlight` (lit when listed or both end items are). `updateItem` / `updateConnector` patch and re-render (moved items
re-route); `getRoute(id)` returns the corners. Parallel connectors sharing tiles overlap (no lane offsets yet).

| # | Content |
|---|---|
| **I1** | Static picture: `IsoProjection`, floor grid, camera (pan/zoom/fit, wheel at cursor), `IsoIcons` built-ins, items with callout labels and depth order, regions, floor texts, dark/light. Viewer only (`readOnly`), hover/click events. Example page with a made-up web-shop architecture. |
| **I2** | Connectors: `IsoRoute` (A*, waypoints, simplify), styles, arrows, upright labels, animated dots, anchors to items or tiles that follow moved items. |
| **I3** | Editing: select (click, Shift/Ctrl, lasso), move with tile snap (connectors re-route live), arrow keys, delete, undo/redo, copy/cut/paste (JSON fragment on the system clipboard), place from a host palette (`beginDrag(icon, event)` / `dropAt`), draw region (drag on the floor) + corner resize, draw connector (from item/tile to item/tile, click to add waypoints), text tool, double-click edits labels in place. |
| **I4** | Export (`toJSON`, `exportSVG`, `exportPNG`), host icon types (SVG string, URL, render function; flat or isometric), `setStyleVars` / `IsoStyles.varsFromTheme`, keyboard map, minimap (optional). |
| **I5** | Live view: item/connector status API, load colours, pulse, `focus(id)` fly-to, `highlight(ids)` dims the rest; example toggles editor ↔ live monitoring with simulated failures. |
| **I6** (optional) | View rotation in 90° steps (tile remap, icons mirrored per side), elevation (items/regions on stacked levels — floors of a building, layers of a stack). |

Tests: `test/IsoProjection.test.ts`, `test/IsoModel.test.ts`, `test/IsoRoute.test.ts`
(pure parts only, as for the other modules). Example: `examples/iso.html` —
palette left, canvas, inspector right (label, colour, icon, connector style),
toolbar (modes, undo, export, editor/live toggle), Save/Load via localStorage.
