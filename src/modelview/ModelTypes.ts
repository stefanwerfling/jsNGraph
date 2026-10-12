/**
 * Module archetype — selects the accent color and the glyph drawn on a
 * module block. Mirrors the pieces a neural-network / transformer diagram is
 * built from, but is deliberately generic: a consumer supplies whatever
 * structure it wants, ModelView only renders it.
 */
export type ModuleKind =
    | 'input'
    | 'embedding'
    | 'attention'
    | 'mlp'
    | 'norm'
    | 'head'
    | 'output'
    | 'block'
    | 'op'
    | 'generic';

/**
 * Hint for how a flow edge is routed:
 * - 'flow' (default): the primary forward path (vertical bezier).
 * - 'residual': a skip/add-back connection, drawn dashed and bowed out to the side.
 * - 'skip': any other long-range jump, routed to the side like a residual.
 */
export type FlowKind = 'flow' | 'residual' | 'skip';

/**
 * Input shape for one module block, as passed to ModelView.setData.
 */
export interface ModelModuleData {
    id: string;
    /** Primary line drawn inside the block, e.g. "Self-Attention". */
    label: string;
    /** Archetype — drives accent color + glyph. Default 'generic'. */
    kind?: ModuleKind;
    /** Smaller second line, e.g. the module class "Qwen3Attention". */
    sublabel?: string;
    /** Collapsed repeat count — draws a "×N" stacked card for N identical blocks. */
    repeat?: number;
    /** Key/value rows shown in the click detail panel (shape, dtype, params, …). */
    detail?: Record<string, string | number>;
    /** Override the accent color (otherwise derived from `kind`). */
    accent?: string;
    /**
     * Granularity level at which this module first appears — 0 (default) = the
     * coarsest block view, higher = more detail. A module is shown at the
     * current level only if no child of it is also revealed; otherwise it is
     * "expanded" and its children take its place. See `parent`.
     */
    level?: number;
    /**
     * Id of the coarser module that contains this one. At levels below this
     * module's `level`, edges touching it collapse onto this ancestor. Author
     * flows between the finest (leaf) modules; coarser levels are derived.
     */
    parent?: string;
    /** Optional pinned world position; omit to let the flow layout place it. */
    x?: number;
    y?: number;
}

/**
 * Input shape for one flow edge between two modules.
 */
export interface ModelFlowData {
    /** Optional id; auto-derived from `${source}->${target}` when omitted. */
    id?: string;
    source: string;
    target: string;
    /** Optional label drawn at the edge midpoint, e.g. "hidden" / "residual". */
    label?: string;
    /** Routing/style hint. Default 'flow'. */
    kind?: FlowKind;
    /** Draw moving dots along the edge to visualize data flow. Default false. */
    animated?: boolean;
}

/**
 * The whole model graph handed to ModelView.setData.
 */
export interface ModelGraphData {
    modules: ModelModuleData[];
    flows: ModelFlowData[];
}
