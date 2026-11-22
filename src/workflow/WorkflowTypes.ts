/** Side of a node a port sits on. */
export type WorkflowSide = 'left' | 'right' | 'top' | 'bottom';

/** Port direction: inputs receive connections, outputs start them. */
export type WorkflowPortDir = 'in' | 'out';

export interface WorkflowPortSpec {
    /** Unique among the node type's ports of the same direction. */
    id: string;
    /** Shown next to the port (e.g. 'true' / 'false'). */
    label?: string;
    /** Only ports of equal kind connect. Default 'main'. */
    kind?: string;
    /** Default: inputs 'left', outputs 'right'. */
    side?: WorkflowSide;
    /** Maximum connections on this port. Default unlimited. */
    max?: number;
}

/** What the host app tells the editor about one kind of node. */
export interface WorkflowNodeType {
    type: string;
    /** Display name; also the default node label. */
    label: string;
    /** Short text/emoji, or a factory for a custom icon element. */
    icon?: string | ((node: WorkflowNodeData) => HTMLElement);
    /** Accent colour (any CSS colour). */
    color?: string;
    width?: number;
    height?: number;
    inputs?: WorkflowPortSpec[];
    outputs?: WorkflowPortSpec[];
    /** Replace the default body (icon + labels) with your own content. */
    render?: (node: WorkflowNodeData, body: HTMLElement) => void;
}

export interface WorkflowNodeData {
    id: string;
    type: string;
    /** Top-left corner in world coordinates. */
    x: number;
    y: number;
    /** Default: the type's label. */
    label?: string;
    sublabel?: string;
    disabled?: boolean;
    /** Free slot for the host (parameters etc.); the editor copies it along. */
    meta?: unknown;
}

export interface WorkflowPortRef {
    node: string;
    port: string;
}

export interface WorkflowConnection {
    id: string;
    from: WorkflowPortRef;
    to: WorkflowPortRef;
    /** Text shown under the connection ("on timeout", "VIP only" …). Part of the document. */
    label?: string;
}

/** A sticky note on the canvas: free text in a resizable box, behind the nodes. */
export interface WorkflowNote {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    text: string;
    /** Tint (any CSS colour). Default: a warm yellow. */
    color?: string;
}

/**
 * A sub-workflow: nodes framed together under a label. Expanded, a frame
 * with a header surrounds them; collapsed, they are drawn as one node whose
 * ports are the connections crossing the group's border. Groups do not nest;
 * a node belongs to at most one group.
 */
export interface WorkflowGroup {
    id: string;
    /** Header / node title. Default 'Group'. */
    label?: string;
    /** Member node ids. */
    nodes: string[];
    collapsed?: boolean;
    /** Tint (any CSS colour). Default: the selection blue. */
    color?: string;
}

export interface WorkflowDocument {
    nodes: WorkflowNodeData[];
    connections: WorkflowConnection[];
    /** Omitted when there are none. */
    notes?: WorkflowNote[];
    /** Omitted when there are none. */
    groups?: WorkflowGroup[];
}

/** Run state of a node, shown as a badge and a tinted border. Not part of the document. */
export type WorkflowNodeStatus = 'idle' | 'waiting' | 'running' | 'success' | 'error';

export interface WorkflowNodeStatusInfo {
    /** Tooltip on the status badge (e.g. the error message). */
    message?: string;
}

/** Run state of a connection. Not part of the document. */
export interface WorkflowConnectionStatus {
    /** Item count shown on the connection ("1 item", "3 items"). */
    items?: number;
    /** Free label instead of the item count. */
    label?: string;
    /** Dots travel along the connection while data flows. */
    active?: boolean;
    /** Tint the connection. */
    status?: 'success' | 'error';
}

/**
 * One recorded status call of a run, `at` milliseconds after the run began
 * (see `WorkflowEditor.startRecording` and `WorkflowReplay`). Exactly one of
 * `node`, `connection`, `runPath` or `clear` is set.
 */
export type WorkflowRunEvent =
    | {at: number; node: string; status: WorkflowNodeStatus; message?: string}
    | {at: number; connection: string; state: WorkflowConnectionStatus | null}
    | {at: number; runPath: {nodes: string[]; connections?: string[]} | null}
    | {at: number; clear: true};

/** Host veto: return false (or a reason string) to refuse a connection. */
export type WorkflowCanConnect = (from: WorkflowPortRef, to: WorkflowPortRef, doc: WorkflowDocument) => boolean | string;

export type WorkflowChangeKind =
    | 'load'
    | 'addNode'
    | 'updateNode'
    | 'removeNodes'
    | 'move'
    | 'connect'
    | 'disconnect'
    | 'reconnect'
    | 'remove'
    | 'disable'
    | 'paste'
    | 'insertNode'
    | 'addNote'
    | 'updateNote'
    | 'updateConnection'
    | 'group'
    | 'ungroup'
    | 'updateGroup'
    | 'undo'
    | 'redo';

/** One finished change; read the full state with `getDocument()`. */
export interface WorkflowChange {
    kind: WorkflowChangeKind;
    /** Node ids touched. */
    nodes: string[];
    /** Connection ids touched (added, removed or rerouted). */
    connections: string[];
    /** Note ids touched, when any. */
    notes?: string[];
    /** Group ids touched, when any. */
    groups?: string[];
}

export interface WorkflowEditorOptions {
    types?: WorkflowNodeType[];
    document?: WorkflowDocument;
    /** Viewer mode: pan, zoom, select and click events only. Default false. */
    readOnly?: boolean;
    /** Grid snap step in world px; 0 = off. Alt bypasses while dragging. Default 20. */
    grid?: number;
    /** Built-in colour scheme; restyle further via the `--wf-*` CSS variables. Default 'dark'. */
    theme?: 'dark' | 'light';
    canConnect?: WorkflowCanConnect;
    minScale?: number;
    maxScale?: number;
    /** Fit the document into view after load. Default true. */
    fitOnLoad?: boolean;
    /** Undo depth. Default 100. */
    historySize?: number;
    /** Deleting a node in a chain wires its predecessor to its successors. Default true. */
    reconnectOnDelete?: boolean;
    /** Double-clicking a connection edits its label. Default true. */
    editConnectionLabels?: boolean;
    /** Show the overview map. Default false. */
    minimap?: boolean;
}

/** Clipboard/fragment format of copy, cut and paste. */
export interface WorkflowFragment extends WorkflowDocument {
    format: 'jsngraph-workflow';
    version: 1;
}

export interface WorkflowSelection {
    nodes: string[];
    notes: string[];
    groups: string[];
    connection: string | null;
}

export interface WorkflowClickEvent {
    id: string;
    originalEvent: MouseEvent;
}

export interface WorkflowEditorEvents extends Record<string, unknown> {
    change: WorkflowChange;
    selectionChange: WorkflowSelection;
    nodeClick: WorkflowClickEvent;
    nodeDblClick: WorkflowClickEvent;
    connectionClick: WorkflowClickEvent;
    connectionDblClick: WorkflowClickEvent;
    backgroundClick: {x: number; y: number; originalEvent: MouseEvent};
    /**
     * "+" on a free port was pressed. The host opens its node picker and
     * answers with `addNodeFrom(port, dir, {type})`. `at` is the port's
     * position (world coordinates); `originalEvent` has the screen position.
     */
    addRequest: {port: WorkflowPortRef; dir: WorkflowPortDir; at: {x: number; y: number}; originalEvent: MouseEvent};
    /** "+" on a connection was pressed; answer with `insertNode(connection, {type})`.
     *  `at` is the connection's midpoint (world coordinates). */
    insertRequest: {connection: string; at: {x: number; y: number}; originalEvent: MouseEvent};
    /** A connection attempt was refused (wrong kind, port full, host veto …). */
    connectRefused: {from: WorkflowPortRef; to: WorkflowPortRef; reason: string};
}
