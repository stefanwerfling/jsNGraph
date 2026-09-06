/**
 * Health of a node, drives the status ring / overlay icon.
 */
export type NodeStatus = 'ok' | 'warning' | 'critical' | 'down';

/**
 * Device archetype, selects which icon glyph is drawn inside a node.
 */
export type NodeKind = 'pc' | 'laptop' | 'tablet' | 'server' | 'database' | 'router' | 'agent' | 'gateway' | 'generic';

/**
 * Input shape for a node, as passed to NGraph.setData / addNode / updateNode.
 */
export interface NGraphNodeData {
    id: string;
    label: string;
    kind: NodeKind;
    status?: NodeStatus;
    /** Utilization 0..1, shown as a bar in the node detail panel. */
    load?: number;
    ip?: string;
    /** Generic key/value rows for the detail panel (e.g. role, current task).
     *  When set, the panel shows these instead of the device IP/load block. */
    meta?: Record<string, string>;
    /** Smaller second line under the label (e.g. "9 checks · ok"). */
    sublabel?: string;
    /** Draw an animated glow ring in the node's status color (e.g. "working"). */
    pulse?: boolean;
    /** Radial layout only: ring index — 0 = center hub, 1..n = outer rings. Default 1. */
    ring?: number;
    /** Optional pinned position; omit to let the force layout place it. */
    x?: number;
    y?: number;
    /** When true, the layout never moves this node (e.g. a pinned gateway). */
    fixed?: boolean;
}

/**
 * Input shape for an edge, as passed to NGraph.setData / addEdge / updateEdge.
 */
export interface NGraphEdgeData {
    id: string;
    source: string;
    target: string;
    /** Traffic load 0..1 — colors the edge green (low) to red (high). */
    load?: number;
    /** Draw moving traffic dots along the edge. */
    animated?: boolean;
}
