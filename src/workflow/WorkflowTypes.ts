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
}

export interface WorkflowDocument {
    nodes: WorkflowNodeData[];
    connections: WorkflowConnection[];
}

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
    | 'undo'
    | 'redo';

/** One finished change; read the full state with `getDocument()`. */
export interface WorkflowChange {
    kind: WorkflowChangeKind;
    /** Node ids touched. */
    nodes: string[];
    /** Connection ids touched (added, removed or rerouted). */
    connections: string[];
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
}

export interface WorkflowClickEvent {
    id: string;
    originalEvent: MouseEvent;
}

export interface WorkflowEditorEvents extends Record<string, unknown> {
    change: WorkflowChange;
    selectionChange: {nodes: string[]; connection: string | null};
    nodeClick: WorkflowClickEvent;
    nodeDblClick: WorkflowClickEvent;
    connectionClick: WorkflowClickEvent;
    backgroundClick: {x: number; y: number; originalEvent: MouseEvent};
    /** A connection attempt was refused (wrong kind, port full, host veto …). */
    connectRefused: {from: WorkflowPortRef; to: WorkflowPortRef; reason: string};
}
