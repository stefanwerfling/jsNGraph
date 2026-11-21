# Workflow editor — plan

A node-based workflow editor widget for jsNGraph: nodes with typed input/output
ports, connections between ports, editing, undo, and (later) run-status overlays.
One widget, `WorkflowEditor`, owns the whole picture; `readOnly: true` turns it
into a viewer (pan, zoom, select, click events — no editing).

## Scope

**In jsNGraph (graphics only):** canvas, nodes and ports, connections, editing
gestures, undo/redo, auto-layout, run-status display, theming.

**In the consuming app:** what a node *does* — execution, parameter forms,
credentials, persistence, expressions. The library never knows that a node is
"HTTP request"; it knows node *types* the app describes (label, icon, colour,
ports) and draws/edits documents made of them.

## Architecture — `src/workflow/`

| File | Role |
|---|---|
| `WorkflowTypes.ts` | Public types: node types, ports, document, events. |
| `WorkflowModel.ts` | Pure document model: add/update/remove nodes, connect/disconnect with validation (port direction, kind, `max`, duplicates, self-loops, host `canConnect`). No DOM, unit-tested. |
| `WorkflowGeometry.ts` | Pure geometry: node sizes, port positions, connection paths (forward = cubic curve, backward = rounded detour around the nodes), midpoints. Unit-tested. |
| `WorkflowStyles.ts` | Default look, injected once as zero-specificity `:where()` rules; colours are CSS custom properties (`--wf-*`) so the host restyles without touching code. Dark + light. |
| `WorkflowEditor.ts` | The widget: DOM nodes + one SVG layer for connections, pan/zoom through the shared `view/Camera`, gestures, keyboard, undo (`RectHistory`), events. |

Rendering is DOM + SVG, not canvas: workflows are hundreds of nodes at most,
text stays crisp, and the app can render its own content into a node
(`render` hook on the node type).

Reused: `view/Camera` (pan/zoom/fit/fly), `rect/RectBoardGeometry` (curves,
snap, rectangle tests), `rect/RectHistory` (undo), `util/EventEmitter`.
Later: `modelview/FlowLayout` (rank layout, left→right) for "tidy up".

### Data model

```ts
interface WorkflowNodeType {
    type: string; label: string;
    icon?: string | ((node: WorkflowNodeData) => HTMLElement);
    color?: string; width?: number; height?: number;
    inputs?: WorkflowPortSpec[]; outputs?: WorkflowPortSpec[];
    render?: (node: WorkflowNodeData, body: HTMLElement) => void;
}
interface WorkflowPortSpec {
    id: string; label?: string;
    kind?: string;                                 // only equal kinds connect; default 'main'
    side?: 'left' | 'right' | 'top' | 'bottom';    // default: inputs left, outputs right
    max?: number;                                  // max connections on this port
}
interface WorkflowNodeData { id: string; type: string; x: number; y: number;
    label?: string; sublabel?: string; disabled?: boolean; meta?: unknown; }
interface WorkflowConnection { id: string;
    from: {node: string; port: string}; to: {node: string; port: string}; }
interface WorkflowNote { id: string; x: number; y: number; w: number; h: number;
    text: string; color?: string; }
interface WorkflowDocument { nodes: WorkflowNodeData[]; connections: WorkflowConnection[];
    notes?: WorkflowNote[]; }
```

Decisions:

- **Ports:** left (in) / right (out) by default; `side` exists so bottom/top
  ports (e.g. tool/model sockets of an agent node) are possible later.
- **The widget owns the document.** `getDocument()` / `setDocument()`, built-in
  undo/redo, and a `change` event per finished gesture (`{kind, nodes,
  connections}`) so the app can persist, validate or sync. `canConnect(from, to)`
  lets the app veto connections.
- **Viewer = same widget** with `readOnly: true` (toggle at runtime with
  `setReadOnly`). Unknown node types still render (generic card, no ports), and
  connections to missing ports are kept in the document but not drawn, so a
  viewer never loses data it does not understand.

## Milestones

Status: W1–W6 done (`examples/workflow.html`).

| # | Content |
|---|---|
| **W1** | Skeleton: `WorkflowEditor`, type registry, DOM nodes with ports, port-to-port curves, pan/zoom/fit, drag with grid snap (Alt bypasses), select (click, Shift/Ctrl toggle, Shift+drag band), read-only mode. |
| **W2** | Connecting: drag from a port with a live draft curve, valid targets highlighted, drop on a port or a node body (first free compatible port), drag a connected input to pick the connection up again, select/delete connections, undo/redo, keyboard (Delete, Ctrl+Z/Y, Ctrl+A). |
| **W3** | Editing comfort: "+" on free outputs and on free non-left inputs (`addRequest` → host picker → `addNodeFrom`, placed beside the port clear of other nodes; `typesFor` lists compatible types), insert/delete buttons on the hovered connection (`insertRequest` → `insertNode`: right of the source, downstream nodes shift when crowded), copy/cut/paste through the system clipboard as a JSON `WorkflowFragment` (paste lands at the cursor), Ctrl+D duplicate, delete re-links a chain (`reconnectOnDelete`), D toggles disabled (connections of disabled nodes are dashed). Pasted connections go through the same validation, so a host `canConnect` veto also applies to them. |
| **W4** | Adding from outside: the host renders its palette and calls `beginDrag(type, pointerEvent)` on an item's `pointerdown` — a preview of the real node follows the pointer (mouse/pen/touch; palette needs `touch-action: none`), a connection it fits into lights up (±10 px tolerance), release over the editor calls `dropAt(type, clientX, clientY)` (insert into that connection, else add centred and snapped), Escape cancels. Sticky notes (`doc.notes`, `WorkflowNote`): behind the nodes, move/resize with snap, double-click edits the text (Ctrl+Enter/blur keeps, Escape discards), select (a band must enclose a note), delete, copy/paste, undo; `addNote`/`updateNote`/`editNote`, `remove(ids)` for mixed deletions. Keys and clicks inside text fields (note editor, inputs in a custom node body) are left alone. |
| **W5** | Run status (display only — not in the document, not undoable, survives re-renders and undo): `setNodeStatus(id, 'idle' \| 'waiting' \| 'running' \| 'success' \| 'error', {message?})` — badge (spinner, ✓, !, …) with the message as tooltip, tinted border, glow while running; `setConnectionStatus(id, {items?, label?, active?, status?})` — item-count pill, SMIL dots travelling the path while active, success/error tint; `setRunPath(nodeIds, connectionIds?)` dims everything outside the executed path (pass the travelled connections, otherwise a connection counts as run when both ends ran — which keeps an untaken loop-back lit); `clearStatus()`. Motion is off under `prefers-reduced-motion`. The example's ▶ Run is a host-side simulation feeding this API (Merge waits for both inputs, If splits items, sub-nodes run with their agent). |
| **W6** | `tidyUp()` — `WorkflowLayout` (pure, own file; `FlowLayout` is top-down and bound to `ModelNode`): columns by longest path over flow connections after a DFS drops loop edges, barycenter sweeps order each column by predecessor and output port, sub-nodes (model/tools) in a row under their node, disconnected parts stacked; keeps the old top-left, animated, one undo step; notes that enclosed nodes are refitted around them. Minimap (`minimap: true` / `setMinimap`, `WorkflowMinimap`): canvas overview, click/drag to move the view. Backward detours step below any node in their way (`WorkflowGeometry.clearRun`); item labels sit above nodes. `setStyleVars` overrides `--wf-*`, `WorkflowStyles.varsFromTheme(Theme.dark)` shares NGraph's palette. |

Later / optional: sub-workflows (collapsed groups), connection labels, a
read-only execution-replay mode.
