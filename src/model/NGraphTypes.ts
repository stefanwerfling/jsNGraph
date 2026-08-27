/**
 * Health of a node, drives the status ring / overlay icon.
 */
export type NodeStatus = 'ok' | 'warning' | 'critical' | 'down';

/**
 * Device archetype, selects which icon glyph is drawn inside a node.
 */
export type NodeKind = 'pc' | 'laptop' | 'tablet' | 'server' | 'database' | 'router' | 'generic';

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
