/**
 * Health of a node, drives the status ring / overlay icon.
 */
export type NodeStatus = 'ok' | 'warning' | 'critical' | 'down';

/**
 * Device archetype, selects which icon glyph is drawn inside a node.
 */
export type NodeShape = 'circle' | 'card' | 'dot';

export type NodeKind = 'pc' | 'laptop' | 'tablet' | 'server' | 'database' | 'router' | 'agent' | 'gateway' | 'generic'
    | 'person' | 'company' | 'location' | 'web' | 'phone' | 'group';

/**
 * A custom glyph: draw centred at (0, 0) within `size` in `color` (the
 * context is already translated, saved and restored around the call).
 */
export type NodeIconDrawer = (ctx: CanvasRenderingContext2D, size: number, color: string) => void;

/** Corner of a node a badge sits on. */
export type BadgePosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

/**
 * A small marker on a node's rim: a count/text pill, a glyph in a disc, or a
 * picture (a flag, a logo). Exactly one of text / icon / image is drawn
 * (image wins over icon, icon over text).
 */
export interface NodeBadge {
    text?: string | number;
    icon?: NodeKind | NodeIconDrawer;
    /** Picture URL; drawn as a small rectangle (flag) or disc, see `shape`. */
    image?: string;
    /** For image badges: 'rect' (default, 4:3 — flags) or 'circle'. */
    shape?: 'rect' | 'circle';
    /** Default 'top-right'. */
    position?: BadgePosition;
    /** Fill of a text/icon badge. Default the theme's ok/green (text) or the node stroke (icon). */
    color?: string;
    /** Glyph/text colour. Default white. */
    iconColor?: string;
    /** Height in world px. Default scales with the node (min 12). */
    size?: number;
}

/**
 * Input shape for a node, as passed to NGraph.setData / addNode / updateNode.
 */
export interface NGraphNodeData {
    id: string;
    label: string;
    /** Device glyph drawn inside 'circle'/'card' nodes. Default 'generic'. */
    kind?: NodeKind;
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
    /** Picture drawn inside a 'circle' (cover-cropped to the disc) or in the
     *  icon chip of a 'card' — an avatar, a logo. Any URL the page may load,
     *  incl. data: URLs; '' removes it. Until it has loaded (or if it fails) the icon shows. */
    image?: string;
    /** Small count/marker bubble at the node's top-right (e.g. unread items).
     *  Empty string or 0 hides it. */
    badge?: number | string;
    /** Badge fill (any CSS color). Default the theme's ok/green. */
    badgeColor?: string;
    /** More rim markers (flags, small glyphs, counts) — see NodeBadge. */
    badges?: NodeBadge[];
    /** Body fill of a 'circle'/'card' (any CSS color): the solid-disc look with a
     *  light glyph. Without `color` the outline takes the same colour. */
    fill?: string;
    /** Glyph colour inside the node. Default the theme's icon colour. */
    iconColor?: string;
    /** Radial layout only: ring index — 0 = center hub, 1..n = outer rings. Default 1. */
    ring?: number;
    /** 'circle' (classic device dot, default), 'card' — a rounded rectangle
     *  with the icon chip, label and sublabel drawn INSIDE the node — or 'dot':
     *  a plain filled disc without icon, for dense graphs (knowledge graphs). */
    shape?: NodeShape;
    /** Accent color (any CSS color). 'dot': the fill; 'circle'/'card': the outline. */
    color?: string;
    /** Radius in world pixels (circle/dot). Default 22 (circle) / 7 (dot). */
    size?: number;
    /** Category key (folder, community, type). Without `color`, picks a stable
     *  color from the theme palette, so equal groups share a color. */
    group?: string;
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
    /** Traffic load 0..1 — colors the edge green (low) to red (high), unless
     *  `color` or the edge kind's style says otherwise. */
    load?: number;
    /** Draw moving traffic dots along the edge. Default true. */
    animated?: boolean;
    /** Semantic edge type (e.g. 'wikilink', 'supersedes', 'tag'). Looked up in
     *  NGraphOptions.edgeKinds for a shared look. */
    kind?: string;
    /** Draw an arrowhead at the target. */
    directed?: boolean;
    /** Dashed stroke: true for the default dash, or an explicit dash pattern. */
    dashed?: boolean | number[];
    /** Text drawn at the middle of the edge (when zoomed in far enough);
     *  '\n' breaks it into lines. */
    label?: string;
    /** Stroke color (any CSS color) — overrides kind style and load coloring. */
    color?: string;
    /** Stroke width in world pixels. */
    width?: number;
}

/**
 * The look shared by every edge of one `kind`. Fields set on the edge
 * itself win over these.
 */
export interface EdgeKindStyle {
    color?: string;
    width?: number;
    directed?: boolean;
    dashed?: boolean | number[];
    /** 'load' colors by traffic load (the network-monitoring look);
     *  'neutral' uses the theme's neutral edge color. Default 'load'. */
    tone?: 'load' | 'neutral';
    /** Traffic dots; overrides the edge's own `animated` default. */
    animated?: boolean;
}

/**
 * Per-node visual override returned by NGraphOptions.styleNode. Every field
 * is optional; unset fields keep the value derived from the node data.
 */
export interface NodeStyle {
    shape?: NodeShape;
    /** Main color: the fill of a 'dot', the outline of 'circle'/'card'. */
    color?: string;
    radius?: number;
    /** Glyph inside circle/card — a built-in kind or your own drawer — or null for none. */
    icon?: NodeKind | NodeIconDrawer | null;
    /** Body fill of circle/card. */
    fill?: string;
    iconColor?: string;
    label?: string;
    labelColor?: string;
    /** Label font size in world px. Default 11, growing with big nodes. */
    labelSize?: number;
    /** Pill behind the label (any CSS color); null = none. Default from the
     *  `labelStyle` option. */
    labelBackground?: string | null;
    /** Picture inside the node (see NGraphNodeData.image); null = none. */
    image?: string | null;
    /** Badge text (see NGraphNodeData.badge); null = none. */
    badge?: number | string | null;
    badgeColor?: string;
    /** Rim markers, replacing the node's own `badges`; null = none. */
    badges?: NodeBadge[] | null;
    /** 0..1 */
    opacity?: number;
    /** Extra ring around a dot/circle (heat, recency, a badge); null = none. */
    ring?: NodeRing | null;
}

/** Outer ring drawn around a dot or circle node. */
export interface NodeRing {
    color: string;
    /** Stroke width in world px. Default 2. */
    width?: number;
    /** 0..1, default 1. */
    opacity?: number;
    /** Space between the node body and the ring, world px. Default 1. */
    gap?: number;
}

/** Per-edge visual override returned by NGraphOptions.styleEdge. */
export interface EdgeStyle {
    color?: string;
    width?: number;
    directed?: boolean;
    dash?: number[] | null;
    label?: string | null;
    /** 0..1 */
    opacity?: number;
}

/**
 * A cluster outline (J6): a padded convex hull drawn under the nodes in
 * `nodeIds` (communities, tags, folders). Nodes that are filtered out do
 * not count; a hull with no visible node is not drawn.
 */
export interface NGraphHull {
    id: string;
    nodeIds: ReadonlyArray<string>;
    /** Fill and outline color. Default: theme palette by id. */
    color?: string;
    /** Shown by hosts as a tooltip (see NGraph.hullsAt). */
    label?: string;
    /** Margin around the member nodes in world px. Default 24. */
    padding?: number;
    /** Fill opacity 0..1, default 0.12 (the outline uses 3x, max 1). */
    opacity?: number;
}


/**
 * A super-node shown instead of its members when zoomed out below
 * NGraphOptions.clusterZoom (J4 aggregation): communities, folders, tags.
 */
export interface NGraphCluster {
    id: string;
    /** Member nodes: used for the centroid (without x/y), the default size
     *  and NGraph.focusCluster. */
    nodeIds?: ReadonlyArray<string>;
    /** Centre in world px. Default: centroid of the visible members. */
    x?: number;
    y?: number;
    /** Member count shown in the disc and used for its radius. Default nodeIds.length. */
    size?: number;
    /** Extent in world px; the disc never grows past it on screen, so
     *  neighbouring clusters do not overlap. Default: the members' spread. */
    radius?: number;
    /** Default: theme palette by id. */
    color?: string;
    /** Drawn under the disc when it does not collide with another label. */
    label?: string;
}

/** An aggregated edge between two clusters; the stroke width follows `weight`. */
export interface NGraphClusterEdge {
    source: string;
    target: string;
    /** Default 1. */
    weight?: number;
}
