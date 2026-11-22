import { ForceLayoutOptions, ForceLayout } from './layout/ForceLayout';
import { RadialLayoutOptions, RadialLayout } from './layout/RadialLayout';
import { LayeredLayoutOptions, LayeredLayout } from './layout/LayeredLayout';
import { StaticLayout } from './layout/StaticLayout';
import { GraphEdge } from './model/GraphEdge';
import { GraphNode } from './model/GraphNode';
import { EdgeLanes } from './model/EdgeLanes';
import { GraphQuery, NeighborDirection } from './model/GraphQuery';
import { EdgeKindStyle, LabelPosition, NGraphCluster, NGraphClusterEdge, NGraphEdgeData, NGraphHull, NGraphNodeData } from './model/NGraphTypes';
import { CanvasRenderer, RenderCluster, RenderClusters, RenderHull } from './render/CanvasRenderer';
import { WebGLLayer } from './render/WebGLLayer';
import { ClusterResolver } from './render/ClusterResolver';
import { ColumnHeaderOptions, ColumnHeaders } from './render/ColumnHeaders';
import { Effects, NGraphOverlay, OverlayContext, PulseOptions, RippleOptions, TrailOptions } from './render/Effects';
import { EdgeColorMode, EdgeStyler, LabelStyle, NodeStyler, StyleResolver } from './render/StyleResolver';
import { Theme, ThemeTokens } from './render/Theme';
import { ClickModifiers, InteractionController } from './interaction/InteractionController';
import { HitCandidate, MIN_HIT_RADIUS_PX, pickHit } from './interaction/HitPick';
import { Tooltip } from './ui/Tooltip';
import { NodePanel } from './ui/NodePanel';
import { EventEmitter } from './util/EventEmitter';
import { Color } from './util/Color';
import { Geometry, Point } from './util/Geometry';
import { Hull } from './util/Hull';
import { Quadtree } from './util/Quadtree';
import { Camera, CameraState } from './view/Camera';
import { RenderLoop } from './view/RenderLoop';

export interface NGraphOptions {
    /** 'dark' (default) | 'light' | a custom palette (see Theme.fromCssVars). */
    theme?: 'dark' | 'light' | ThemeTokens;
    /** Draw a label under each node. Default true. */
    showLabels?: boolean;
    /** 'plain' text (default) or 'pill': a rounded backdrop behind each label,
     *  inverted for the hovered/selected node. Per node: NodeStyle.labelBackground. */
    labelStyle?: LabelStyle;
    /** Allow dragging nodes to reposition them. Default true. */
    draggable?: boolean;
    /** Show the built-in click-to-open detail panel. Default true. */
    detailPanel?: boolean;
    /** Hover tooltip: true (default, "label · sublabel/load"), false, or a
     *  function returning the text (null = no tooltip for that node). */
    tooltip?: boolean | ((node: GraphNode) => string | null);
    /** Edge hover tooltip: true (default, "A ↔ B · label/load"), false, or a
     *  function returning the text (null = no tooltip for that edge). The
     *  hovered edge is drawn a little wider. */
    edgeTooltip?: boolean | ((edge: GraphEdge) => string | null);
    /** 'force' (default): springy self-organizing. 'radial': hub-and-ring via
     *  node.ring. 'layered': Sugiyama-style columns via node.ring (0 = left).
     *  'static': no simulation, nodes stay at the x/y the host gives them
     *  (precomputed layout, saved arrangement); dragging still works. */
    layoutMode?: 'force' | 'radial' | 'layered' | 'static';
    layout?: ForceLayoutOptions;
    radialLayout?: RadialLayoutOptions;
    layeredLayout?: LayeredLayoutOptions;
    /** Edge rendering: straight 'line' (default) or workflow-style 'curve'. */
    edgeStyle?: 'line' | 'curve';
    /** Wheel/pinch zoom and drag-to-pan on the background. Default false, so a
     *  graph embedded in a scrolling page or a pan/zoom board keeps the wheel. */
    panZoom?: boolean;
    /** Camera scale limits. Defaults 0.1 / 4. */
    minZoom?: number;
    maxZoom?: number;
    /** Shift+drag on the background draws a lasso that selects nodes. Default true. */
    lasso?: boolean;
    /** Below this zoom, node and edge labels are hidden (hovered/selected dots keep theirs). Default 0.45. */
    labelMinZoom?: number;
    /** Below this zoom, edges are neither drawn nor hit-tested (too dense to read). Default 0 = always. */
    edgeMinZoom?: number;
    /** With clusters set (setClusters), below this zoom the clusters are drawn
     *  instead of the nodes and edges (J4 aggregation). Default 0.3. */
    clusterZoom?: number;
    /** Hide node labels that would overlap a more important one (hovered,
     *  selected, highlighted, bigger). Default true. */
    labelCollision?: boolean;
    /** Background dot grid. Default true. */
    grid?: boolean;
    /** Shared look per edge `kind` (see EdgeKindPresets.knowledge). */
    edgeKinds?: Record<string, EdgeKindStyle>;
    /** Per-node style override, called every frame for visible nodes — keep it cheap. */
    styleNode?: NodeStyler;
    /** Per-edge style override, called every frame for visible edges — keep it cheap. */
    styleEdge?: EdgeStyler;
    /** Stop rendering while the document is hidden. Default true. */
    pauseWhenHidden?: boolean;
    /**
     * J11. 'canvas' (default): everything on canvas 2d. 'webgl': plain
     * straight edges, arrowheads and plain dots go to a WebGL2 layer under
     * the canvas (three instanced draw calls); labels, cards, icons, rings,
     * hover/selection, curves, dashes, hulls, overlays and clusters stay 2d.
     * 'auto': WebGL from `webglMinNodes` visible nodes on. Without WebGL2,
     * or after a lost context, it falls back to 'canvas'.
     */
    renderer?: 'canvas' | 'webgl' | 'auto';
    /** With renderer 'auto': visible node count from which WebGL draws. Default 50 000. */
    webglMinNodes?: number;
    /** Soft neon halo for every dot/circle node and every edge, world px (NodeStyle/EdgeStyle.glow win). Default 0. */
    glow?: {nodes?: number; edges?: number};
    /** Where labels sit: 'below' (default), 'right', 'left', 'above' (NodeStyle.labelPosition wins). */
    labelPosition?: LabelPosition;
    /** Edge colour: 'load' (traffic colours, default) or the accent of the 'source' / 'target' node
     *  (its `color`, group colour or fill) — branches of a flow keep their colour. Edge `color` wins. */
    edgeColor?: EdgeColorMode;
    /** Layered layout ('right'): titles over the columns, separators between them. */
    columnHeaders?: ColumnHeaderOptions;
}

export interface NGraphContextEvent {
    node: GraphNode | null;
    edge: GraphEdge | null;
    clientX: number;
    clientY: number;
    /** World position under the pointer (e.g. "add node here"). */
    world: Point;
}

export interface NGraphEvents {
    nodeHover: GraphNode | null;
    /** Pointer entered an edge (no node under it), or null when it left. */
    edgeHover: GraphEdge | null;
    /** null = click on empty background. */
    nodeClick: GraphNode | null;
    nodeDblClick: GraphNode;
    edgeClick: GraphEdge;
    /** Right click / long press. Registering a listener suppresses the browser menu. */
    contextMenu: NGraphContextEvent;
    /** Selected node ids after any change (click, lasso, select()). */
    selectionChange: string[];
    /** Camera moved (pan, zoom, fit, flight frame). */
    viewportChange: CameraState;
    /** Click on a cluster disc while zoomed out (see setClusters); payload is its id. */
    clusterClick: string;
    /** A node drag ended — persist positions here. */
    nodeDragEnd: GraphNode;
    /** The layout stopped moving (after setData, a drag, a resize, …). */
    layoutSettle: null;
    [key: string]: unknown;
}

export interface FitOptions {
    /** Screen padding in CSS px. Default 40. */
    padding?: number;
    /** Animate the move: true (400 ms) or a duration in ms. Default false. */
    animate?: boolean | number;
    /** Frame only these nodes instead of all visible ones. */
    ids?: Iterable<string>;
    /** Never zoom in beyond this scale (a 2-node graph would otherwise fill the screen). Default 1.5. */
    maxScale?: number;
}

export interface FocusOptions {
    /** Target zoom. Default: keep the current one. */
    scale?: number;
    /** Animate the move: true (400 ms) or a duration in ms. Default true. */
    animate?: boolean | number;
}

export interface ClusterFocusOptions {
    /** Screen padding in CSS px. Default 40. */
    padding?: number;
    /** Animate the move: true (400 ms) or a duration in ms. Default true. */
    animate?: boolean | number;
}

export interface HighlightOptions {
    /** Fade everything that is not highlighted. Default true. */
    dimOthers?: boolean;
}

/** Below this per-frame movement (world px) the layout counts as settled. */
const SETTLE_EPSILON = 0.05;

/** From this many visible nodes on, a frame only visits the nodes in view (quadtree). */
const CULL_MIN_NODES = 2000;

/** focusCluster zooms in at least this far past clusterZoom, so the members show. */
const CLUSTER_FOCUS_MARGIN = 1.15;

/**
 * Public entry point: an interactive graph rendered on a canvas inside
 * `container`. Feed it nodes/edges, it lays them out and handles hover,
 * click, drag, selection, pan/zoom and highlight.
 *
 * Rendering is on demand: frames run while the layout moves, the camera
 * flies or something animates, then the loop goes idle until the next
 * change. It also pauses while the page is hidden or the container has no
 * size (a hidden tab), so an embedded graph costs nothing in the background.
 */
export class NGraph {

    private readonly root: HTMLDivElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly renderer: CanvasRenderer;
    private readonly styles: StyleResolver;
    private readonly layout: ForceLayout | RadialLayout | LayeredLayout | StaticLayout;
    private readonly edgeStyle: 'line' | 'curve';
    private readonly interaction: InteractionController;
    private readonly tooltip: Tooltip;
    private readonly panel: NodePanel;
    private readonly events = new EventEmitter<NGraphEvents>();
    private readonly resizeObserver: ResizeObserver;
    private readonly loop: RenderLoop;
    private readonly camera: Camera;
    private readonly tooltipText: ((node: GraphNode) => string | null) | null;
    private readonly edgeTooltipText: ((edge: GraphEdge) => string | null) | null;
    private readonly labelMinZoom: number;
    private readonly edgeMinZoom: number;
    private readonly clusterZoom: number;
    private readonly labelCollision: boolean;
    private readonly grid: boolean;
    private readonly pauseWhenHidden: boolean;
    private readonly rendererMode: 'canvas' | 'webgl' | 'auto';
    private readonly webglMinNodes: number;
    /** Created on first use; null = not yet, false = unavailable (stay on 2d). */
    private gl: WebGLLayer | null | false = null;

    private readonly nodes = new Map<string, GraphNode>();
    private readonly edges = new Map<string, GraphEdge>();

    private theme: ThemeTokens;
    private showLabels: boolean;
    private detailPanelEnabled: boolean;
    private selectedId: string | null = null;
    private hoveredId: string | null = null;
    private hoveredEdgeId: string | null = null;
    /** Pointer position (container px) while over an edge; the edge tooltip sits there. */
    private edgePointer: Point = {x: 0, y: 0};
    private readonly selection = new Set<string>();
    private highlightSet: Set<string> | null = null;
    private dimOthers = true;
    private filterFn: ((node: GraphNode) => boolean) | null = null;
    private lassoPoints: ReadonlyArray<Point> | null = null;
    private width = 0;
    private height = 0;

    /** Visible (filtered) nodes/edges in draw order; rebuilt when the structure changes. */
    private visibleNodes: GraphNode[] = [];
    private visibleEdges: GraphEdge[] = [];
    private structureDirty = true;
    private spatial: Quadtree<{node: GraphNode; order: number}> | null = null;
    private spatialExtent = 0;
    private positionScratch = new Float64Array(0);
    private hulls: NGraphHull[] = [];
    private readonly effects = new Effects();
    private overlays: NGraphOverlay[] = [this.effects];
    private columnHeaders: ColumnHeaders | null = null;
    private readonly overlayContext: OverlayContext;
    /** Hull polygons for the current positions; null = recompute on next use. */
    private hullCache: Array<{hull: NGraphHull; render: RenderHull}> | null = null;
    private layoutActive = true;
    private clusters: NGraphCluster[] = [];
    private clusterEdges: NGraphClusterEdge[] = [];
    /** Resolved cluster discs for the current positions; null = recompute on next use. */
    private clusterCache: RenderClusters | null = null;

    public constructor(container: HTMLElement, options: NGraphOptions = {}) {
        this.theme = NGraph.resolveTheme(options.theme ?? 'dark');
        this.showLabels = options.showLabels ?? true;
        this.detailPanelEnabled = options.detailPanel ?? true;
        this.labelMinZoom = options.labelMinZoom ?? 0.45;
        this.edgeMinZoom = options.edgeMinZoom ?? 0;
        this.clusterZoom = options.clusterZoom ?? 0.3;
        this.labelCollision = options.labelCollision ?? true;
        this.grid = options.grid ?? true;
        this.pauseWhenHidden = options.pauseWhenHidden ?? true;
        this.rendererMode = options.renderer ?? 'canvas';
        this.webglMinNodes = options.webglMinNodes ?? 50_000;
        this.tooltipText = options.tooltip === false
            ? null
            : typeof options.tooltip === 'function'
                ? options.tooltip
                : NGraph.defaultTooltip;
        this.edgeTooltipText = options.edgeTooltip === false
            ? null
            : typeof options.edgeTooltip === 'function'
                ? options.edgeTooltip
                : (edge) => NGraph.defaultEdgeTooltip(edge, this.styles.edge(edge).directed);

        this.root = document.createElement('div');
        this.root.style.cssText = 'position:relative; width:100%; height:100%; overflow:hidden;';
        container.appendChild(this.root);

        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'position:relative; display:block; width:100%; height:100%;';
        this.root.appendChild(this.canvas);

        this.camera = new Camera(options.minZoom ?? 0.1, options.maxZoom ?? 4);
        this.renderer = new CanvasRenderer(this.canvas, this.theme, () => this.loop.request());
        this.styles = new StyleResolver(this.theme, options.edgeKinds ?? {}, options.styleNode ?? null,
            options.styleEdge ?? null, options.labelStyle ?? 'plain', {
                nodeGlow: options.glow?.nodes ?? 0,
                edgeGlow: options.glow?.edges ?? 0,
                labelPosition: options.labelPosition ?? 'below',
                edgeColor: options.edgeColor ?? 'load'
            });
        this.layout = options.layoutMode === 'radial'
            ? new RadialLayout(options.radialLayout)
            : options.layoutMode === 'layered'
                ? new LayeredLayout(options.layeredLayout)
                : options.layoutMode === 'static'
                    ? new StaticLayout()
                    : new ForceLayout(options.layout);
        this.edgeStyle = options.edgeStyle ?? 'line';
        this.tooltip = new Tooltip(this.root, this.theme);
        this.panel = new NodePanel(this.root, this.theme);
        this.panel.onClose(() => {
            this.selectedId = null;
        });

        this.loop = new RenderLoop(this.frame);
        this.overlayContext = {
            timeMs: 0,
            scale: 1,
            nodePosition: (id) => {
                const node = this.visibleNode(id);
                return node === null ? null : {x: node.x, y: node.y};
            },
            nodeRadius: (id) => {
                const node = this.visibleNode(id);
                return node === null ? null : this.styles.node(node).radius;
            }
        };

        if (options.columnHeaders !== undefined) {
            this.setColumnHeaders(options.columnHeaders);
        }

        this.interaction = new InteractionController(
            this.canvas,
            {
                camera: this.camera,
                hitNode: (x, y) => this.hitNode(x, y),
                hitEdge: (x, y) => this.hitEdge(x, y),
                nodesInPolygon: (polygon) => this.nodesInPolygon(polygon),
                wantsEdgeHover: () => this.edgeTooltipText !== null || this.events.has('edgeHover')
            },
            {
                onHover: (node) => this.handleHover(node),
                onEdgeHover: (edge, at) => this.handleEdgeHover(edge, at),
                onClick: (node, edge, clientX, clientY, modifiers) => this.handleClick(node, edge, clientX, clientY, modifiers),
                onDoubleClick: (node) => {
                    if (node !== null) {
                        this.events.emit('nodeDblClick', node);
                    }
                },
                onContextMenu: (node, edge, clientX, clientY) => this.handleContextMenu(node, edge, clientX, clientY),
                onLasso: (nodes, modifiers) => this.applySelection(nodes.map((n) => n.id), modifiers.additive),
                onLassoChange: (points) => {
                    this.lassoPoints = points === null ? null : [...points];
                    this.loop.request();
                },
                onDragEnd: (node) => this.events.emit('nodeDragEnd', node),
                onViewportChange: () => this.events.emit('viewportChange', this.camera.getState()),
                onNeedsFrame: () => this.invalidatePositions(0.3)
            },
            {
                draggable: options.draggable ?? true,
                panZoom: options.panZoom ?? false,
                lasso: options.lasso ?? true
            }
        );

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.root);
        document.addEventListener('visibilitychange', this.onVisibilityChange);
        this.resize();
        this.onVisibilityChange();
        this.loop.request();
    }

    // ---- data ----------------------------------------------------------------

    /**
     * Replace the whole graph. Nodes without an explicit x/y are scattered
     * around the view centre; the layout settles them from there.
     */
    public setData(nodes: NGraphNodeData[], edges: NGraphEdgeData[]): void {
        for (const node of this.nodes.values()) {
            this.interaction.forget(node);
        }

        this.nodes.clear();
        this.edges.clear();

        for (const data of nodes) {
            this.addNode(data);
        }

        for (const data of edges) {
            this.addEdge(data);
        }

        this.pruneSelection();
        this.invalidateStructure();
    }

    /** Wake the layout up again (e.g. after scattering nodes by hand). */
    public relayout(): void {
        this.invalidatePositions(1);
    }

    public addNode(data: NGraphNodeData): void {
        const center = this.camera.toWorld(this.width / 2, this.height / 2);
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * (Math.min(this.width, this.height) / this.camera.scale) * 0.25;

        this.nodes.set(data.id, new GraphNode(data, center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius));
        this.invalidateStructure();
    }

    public updateNode(id: string, patch: Partial<NGraphNodeData>): void {
        this.nodes.get(id)?.updateFrom(patch);

        // Status/load/label patches (live monitoring) only need a redraw; only
        // geometry changes wake the layout, so a jittering load feed does not
        // keep the simulation hot forever.
        const geometry = patch.size !== undefined || patch.shape !== undefined || patch.ring !== undefined
            || patch.x !== undefined || patch.y !== undefined || patch.fixed !== undefined;

        this.structureDirty = true;

        if (geometry) {
            this.invalidatePositions(1);
        } else {
            this.spatial = null;
            this.loop.request();
        }
    }

    public removeNode(id: string): void {
        const node = this.nodes.get(id);

        if (node === undefined) {
            return;
        }

        this.interaction.forget(node);
        this.nodes.delete(id);

        for (const [edgeId, edge] of this.edges) {
            if (edge.source.id === id || edge.target.id === id) {
                this.edges.delete(edgeId);
            }
        }

        if (this.hoveredId === id) {
            this.hoveredId = null;
            this.tooltip.hide();
        }

        if (this.selectedId === id) {
            this.selectedId = null;
            this.panel.hide();
        }

        this.pruneSelection();
        this.invalidateStructure();
    }

    public addEdge(data: NGraphEdgeData): void {
        const source = this.nodes.get(data.source);
        const target = this.nodes.get(data.target);

        if (source === undefined || target === undefined) {
            throw new Error(`NGraph: addEdge('${data.id}') references an unknown node`);
        }

        this.edges.set(data.id, new GraphEdge(data, source, target));
        this.invalidateStructure();
    }

    public updateEdge(id: string, patch: Partial<NGraphEdgeData>): void {
        this.edges.get(id)?.updateFrom(patch);
        if (id === this.hoveredEdgeId) {
            this.updateTooltip();     // live load changes show while hovering
        }
        this.loop.request();
    }

    public removeEdge(id: string): void {
        this.edges.delete(id);
        this.invalidateStructure();
    }

    public hasNode(id: string): boolean {
        return this.nodes.has(id);
    }

    // ---- appearance ----------------------------------------------------------

    public setTheme(theme: 'dark' | 'light' | ThemeTokens): void {
        this.theme = NGraph.resolveTheme(theme);
        this.renderer.setTheme(this.theme);
        this.styles.setTheme(this.theme);
        this.tooltip.setTheme(this.theme);
        this.panel.setTheme(this.theme);
        this.loop.request();
    }

    public setShowLabels(show: boolean): void {
        this.showLabels = show;
        this.loop.request();
    }

    public setLabelStyle(labelStyle: LabelStyle): void {
        this.styles.setLabelStyle(labelStyle);
        this.loop.request();
    }

    /** Swap the style callbacks and/or edge-kind table at runtime (pass undefined to keep one). */
    public setStyle(style: {styleNode?: NodeStyler | null; styleEdge?: EdgeStyler | null; edgeKinds?: Record<string, EdgeKindStyle>}): void {
        if (style.styleNode !== undefined || style.styleEdge !== undefined) {
            const current = this.styles.stylers;

            this.styles.setStylers(
                style.styleNode !== undefined ? style.styleNode : current.node,
                style.styleEdge !== undefined ? style.styleEdge : current.edge
            );
        }

        if (style.edgeKinds !== undefined) {
            this.styles.setEdgeKinds(style.edgeKinds);
        }

        this.loop.request();
    }

    // ---- cluster hulls ---------------------------------------------------------

    /** Replace the cluster outlines (J6). An empty list removes them. */
    public setHulls(hulls: ReadonlyArray<NGraphHull>): void {
        this.hulls = [...hulls];
        this.hullCache = null;
        this.loop.request();
    }

    /** Ids of the hulls under a point in container coordinates, topmost first (for tooltips). */
    public hullsAt(x: number, y: number): string[] {
        const world = this.camera.toWorld(x, y);

        return this.hullPolygons()
            .filter((entry) => Geometry.pointInPolygon(world, entry.render.polygon))
            .map((entry) => entry.hull.id)
            .reverse();
    }

    // ---- clusters (J4 aggregation) -----------------------------------------------

    /**
     * Super-nodes for the zoomed-out view: below `clusterZoom` each cluster
     * is one disc (size by member count) and `edges` connect them; nodes and
     * edges come back when zooming in. An empty list turns aggregation off.
     */
    public setClusters(clusters: ReadonlyArray<NGraphCluster>, edges: ReadonlyArray<NGraphClusterEdge> = []): void {
        this.clusters = [...clusters];
        this.clusterEdges = [...edges];
        this.clusterCache = null;
        this.loop.request();
    }

    /** True while the clusters are drawn instead of the nodes. */
    public isClustered(): boolean {
        return this.clusters.length > 0 && this.camera.scale < this.clusterZoom;
    }

    /** Id of the cluster disc under a point in container coordinates (only while clustered). */
    public clusterAt(x: number, y: number): string | null {
        if (!this.isClustered()) {
            return null;
        }

        const discs = this.clusterScene().discs;

        for (let i = discs.length - 1; i >= 0; i--) {
            const c = discs[i] as RenderCluster;
            const at = this.camera.toScreen(c.x, c.y);
            const r = CanvasRenderer.clusterRadiusPx(c, this.camera.scale);

            if ((at.x - x) ** 2 + (at.y - y) ** 2 <= r * r) {
                return c.id;
            }
        }

        return null;
    }

    /** Zoom into a cluster: frame its members, at least far enough that they show. */
    public focusCluster(id: string, options: ClusterFocusOptions = {}): void {
        const cluster = this.clusters.find((c) => c.id === id);

        if (cluster === undefined || this.width === 0 || this.height === 0) {
            return;
        }

        const members: GraphNode[] = [];

        for (const nodeId of cluster.nodeIds ?? []) {
            const node = this.visibleNode(nodeId);

            if (node !== null) {
                members.push(node);
            }
        }

        const minScale = this.clusterZoom * CLUSTER_FOCUS_MARGIN;
        const fitted = this.fitTarget(members, options.padding ?? 40, Infinity);
        const bounds = Geometry.boundsOfPoints(members);
        const disc = this.clusterScene().discs.find((c) => c.id === id);
        const centre = bounds !== null
            ? {x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2}
            : disc !== undefined ? {x: disc.x, y: disc.y} : null;

        if (centre === null) {
            return;
        }

        const target = fitted !== null && fitted.scale >= minScale
            ? fitted
            : this.camera.centerState(centre.x, centre.y, this.width, this.height, Math.max(minScale, fitted?.scale ?? 0));

        this.moveCamera(target, options.animate ?? true);
    }

    // ---- overlays and effects (J8) ---------------------------------------------

    /** Add a drawing hook; returns a function that removes it again. */
    public addOverlay(overlay: NGraphOverlay): () => void {
        this.overlays.push(overlay);
        this.loop.request();

        return () => {
            this.overlays = this.overlays.filter((o) => o !== overlay);
            this.loop.request();
        };
    }

    /** Flash a ring on these nodes (e.g. "was read"). */
    public pulse(ids: Iterable<string>, color: string, options: PulseOptions = {}): void {
        this.effects.pulse(ids, color, options);
        this.loop.request();
    }

    /** A fading arc from one node to another (e.g. "followed a link"). */
    public trail(fromId: string, toId: string, color: string, options: TrailOptions = {}): void {
        this.effects.trail(fromId, toId, color, options);
        this.loop.request();
    }

    /** Circles spreading out from a node (e.g. "look here"). */
    public ripple(id: string, color: string, options: RippleOptions = {}): void {
        this.effects.ripple(id, color, options);
        this.loop.request();
    }

    // ---- positions -----------------------------------------------------------

    /**
     * Snapshot of all current node positions — persist it to restore a
     * hand-arranged view later via setPositions.
     */
    public getPositions(): Record<string, {x: number; y: number}> {
        const positions: Record<string, {x: number; y: number}> = {};

        for (const [id, node] of this.nodes) {
            positions[id] = {x: node.x, y: node.y};
        }

        return positions;
    }

    /**
     * Restore previously saved positions. With fix=true (default) the nodes
     * are pinned there; with fix=false the layout may move them again.
     */
    public setPositions(positions: Record<string, {x: number; y: number}>, fix = true): void {
        for (const [id, position] of Object.entries(positions)) {
            const node = this.nodes.get(id);

            if (node === undefined) {
                continue;
            }

            node.x = position.x;
            node.y = position.y;
            node.vx = 0;
            node.vy = 0;

            if (fix) {
                node.fixed = true;
            }
        }

        this.invalidatePositions(fix ? 0.3 : 1);
    }

    // ---- camera --------------------------------------------------------------

    public getViewport(): CameraState {
        return this.camera.getState();
    }

    public setViewport(state: CameraState, animate: boolean | number = false): void {
        this.moveCamera(state, animate);
    }

    /** Frame all visible nodes (or `options.ids`). */
    public fit(options: FitOptions = {}): void {
        const ids = options.ids !== undefined ? new Set(options.ids) : null;
        const nodes = this.currentVisibleNodes().filter((n) => ids === null || ids.has(n.id));
        const target = this.fitTarget(nodes, options.padding ?? 40, options.maxScale ?? 1.5);

        if (target !== null) {
            this.moveCamera(target, options.animate ?? false);
        }
    }

    /** Centre the camera on a node (animated by default). No-op for unknown ids. */
    public focusNode(id: string, options: FocusOptions = {}): void {
        const node = this.nodes.get(id);

        if (node === undefined) {
            return;
        }

        this.moveCamera(this.camera.centerState(node.x, node.y, this.width, this.height, options.scale ?? this.camera.scale), options.animate ?? true);
    }

    /** Zoom around the viewport centre. */
    public zoomTo(scale: number, animate: boolean | number = false): void {
        const center = this.camera.toWorld(this.width / 2, this.height / 2);

        this.moveCamera(this.camera.centerState(center.x, center.y, this.width, this.height, scale), animate);
    }

    public screenToWorld(x: number, y: number): Point {
        return this.camera.toWorld(x, y);
    }

    public worldToScreen(x: number, y: number): Point {
        return this.camera.toScreen(x, y);
    }

    // ---- highlight, filter, neighborhood --------------------------------------

    /**
     * Emphasize these nodes (search hits, a path, a neighborhood); with
     * dimOthers (default) everything else fades. null or an empty list clears.
     */
    public highlight(ids: Iterable<string> | null, options: HighlightOptions = {}): void {
        const set = ids === null ? null : new Set(ids);

        this.highlightSet = set === null || set.size === 0 ? null : set;
        this.dimOthers = options.dimOthers ?? true;
        this.loop.request();
    }

    public clearHighlight(): void {
        this.highlight(null);
    }

    public getHighlight(): string[] {
        return this.highlightSet === null ? [] : [...this.highlightSet];
    }

    /**
     * Show only nodes matching the predicate (their edges follow); hidden
     * nodes are neither drawn, hit-tested nor laid out. null shows all.
     */
    public filter(predicate: ((node: GraphNode) => boolean) | null): void {
        this.filterFn = predicate;
        this.invalidateStructure();
    }

    /** Ids within `depth` hops of `id` (including it). Ignores the filter. */
    public neighborhood(id: string, depth = 1, direction: NeighborDirection = 'both'): Set<string> {
        return GraphQuery.neighborhood(id, this.edges.values(), depth, direction, this.nodes);
    }

    /** Every node upstream and downstream of `id` (any depth, along edge direction): the paths through it. */
    public lineage(id: string): Set<string> {
        return GraphQuery.lineage(id, this.edges.values(), this.nodes);
    }

    // ---- flow look -------------------------------------------------------------

    /** Change the graph-wide glow / label position / edge colour mode (see the options). */
    public setLook(look: {glow?: {nodes?: number; edges?: number}; labelPosition?: LabelPosition; edgeColor?: EdgeColorMode}): void {
        const current = this.styles.styleDefaults;

        this.styles.setDefaults({
            nodeGlow: look.glow?.nodes ?? current.nodeGlow,
            edgeGlow: look.glow?.edges ?? current.edgeGlow,
            labelPosition: look.labelPosition ?? current.labelPosition,
            edgeColor: look.edgeColor ?? current.edgeColor
        });
        this.loop.request();
    }

    /** Column titles for the layered layout; null removes them. No effect with other layouts. */
    public setColumnHeaders(options: ColumnHeaderOptions | null): void {
        if (this.columnHeaders !== null) {
            const old = this.columnHeaders;
            this.overlays = this.overlays.filter((o) => o !== old.under && o !== old.over);
            this.columnHeaders = null;
        }

        const layout = this.layout;

        if (options !== null && layout instanceof LayeredLayout && layout.direction === 'right') {
            this.columnHeaders = new ColumnHeaders(options, () => layout.columns, this.camera, () => this.theme,
                () => ({width: this.width, height: this.height, dpr: window.devicePixelRatio || 1}));
            this.overlays.push(this.columnHeaders.under, this.columnHeaders.over);
        }

        this.loop.request();
    }

    // ---- selection -----------------------------------------------------------

    public getSelection(): string[] {
        return [...this.selection];
    }

    /** Replace the selection (or add to it with additive). Unknown ids are ignored. */
    public select(ids: Iterable<string>, options: {additive?: boolean} = {}): void {
        this.applySelection([...ids].filter((id) => this.nodes.has(id)), options.additive ?? false, false);
    }

    public clearSelection(): void {
        this.applySelection([], false, false);
    }

    // ---- events & lifecycle ----------------------------------------------------

    public on<K extends keyof NGraphEvents>(event: K, listener: (payload: NGraphEvents[K]) => void): void {
        this.events.on(event, listener);
    }

    public off<K extends keyof NGraphEvents>(event: K, listener: (payload: NGraphEvents[K]) => void): void {
        this.events.off(event, listener);
    }

    /** Stop rendering (e.g. the host hid this view). Changes made meanwhile show on resume. */
    public pause(): void {
        this.loop.pause();
    }

    public resume(): void {
        if (!(this.pauseWhenHidden && document.hidden)) {
            this.loop.resume();
        }
    }

    /** Draw again without touching positions (e.g. a styleNode input changed). */
    public repaint(): void {
        this.loop.request();
    }

    /** Force one redraw (e.g. after mutating a node object directly). */
    public redraw(): void {
        this.invalidatePositions(0);
    }

    public destroy(): void {
        this.loop.destroy();
        this.resizeObserver.disconnect();
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        this.interaction.destroy();
        this.tooltip.destroy();
        this.panel.destroy();
        this.events.clear();

        if (this.gl) {
            this.gl.destroy();
        }

        this.root.remove();
    }

    /** Which renderer drew the last frame: 'webgl' when the J11 layer is active, else 'canvas'. */
    public get activeRenderer(): 'canvas' | 'webgl' {
        return this.gl && this.gl.canvas.style.display !== 'none' ? 'webgl' : 'canvas';
    }

    // ---- internals -----------------------------------------------------------

    private moveCamera(target: CameraState, animate: boolean | number): void {
        const duration = animate === true ? 400 : animate === false ? 0 : animate;

        this.camera.flyTo(target, duration);

        if (duration <= 0) {
            this.events.emit('viewportChange', this.camera.getState());
        }

        this.loop.request();
    }

    /** Camera state that frames these nodes, or null when there is nothing to frame. */
    private fitTarget(nodes: ReadonlyArray<GraphNode>, padding: number, maxScale: number): CameraState | null {
        const bounds = Geometry.boundsOfPoints(nodes);

        if (bounds === null || this.width === 0 || this.height === 0) {
            return null;
        }

        const margin = nodes.reduce((m, n) => Math.max(m, n.shape === 'card' ? CanvasRenderer.cardSize(n).w / 2 : n.radius + 16), 0);
        const target = this.camera.fitState(Geometry.expand(bounds, margin), this.width, this.height, padding);

        return target.scale > maxScale
            ? this.camera.centerState((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, this.width, this.height, maxScale)
            : target;
    }

    /** Resolved cluster discs and edges (centroids from the current positions). */
    private clusterScene(): RenderClusters {
        if (this.clusterCache !== null) {
            return this.clusterCache;
        }

        const palette = this.theme.palette ?? Theme.palette;

        this.clusterCache = ClusterResolver.resolve(this.clusters, this.clusterEdges, (id) => this.visibleNode(id),
            (id) => Color.fromPalette(id, palette) ?? this.theme.nodeStroke);
        return this.clusterCache;
    }

    /**
     * Nodes to draw this frame. Large graphs only visit what is in view (the
     * quadtree query); the draw order stays the data order. While the layout
     * moves the index would be rebuilt every frame, so then all are drawn.
     */
    private nodesInView(): GraphNode[] {
        if (this.visibleNodes.length < CULL_MIN_NODES || this.layoutActive) {
            return this.visibleNodes;
        }

        const index = this.spatialIndex();
        const scale = this.camera.scale;
        // Same margin the renderer culls with (label room + 60 px).
        const view = Geometry.expand(this.camera.viewBounds(this.width, this.height), this.spatialExtent + 30 + 60 / scale);
        const hits = index.queryRect(view);

        if (hits.length === this.visibleNodes.length) {
            return this.visibleNodes;
        }

        hits.sort((a, b) => a.payload.order - b.payload.order);
        return hits.map((hit) => hit.payload.node);
    }

    private invalidateStructure(): void {
        this.structureDirty = true;
        this.invalidatePositions(1);
    }

    /** Positions changed or must be recomputed; `heat` warms the layout (0 = just redraw). */
    private invalidatePositions(heat = 0.3): void {
        this.spatial = null;
        this.hullCache = null;
        this.clusterCache = null;
        this.layoutActive = true;

        if (heat > 0) {
            this.layout.reheat(heat);
        }

        this.loop.request();
    }

    private currentVisibleNodes(): GraphNode[] {
        this.refreshVisible();
        return this.visibleNodes;
    }

    private refreshVisible(): void {
        if (!this.structureDirty) {
            return;
        }

        const filter = this.filterFn;

        this.visibleNodes = filter === null ? [...this.nodes.values()] : [...this.nodes.values()].filter(filter);

        if (filter === null) {
            this.visibleEdges = [...this.edges.values()];
        } else {
            const visible = new Set(this.visibleNodes);
            this.visibleEdges = [...this.edges.values()].filter((e) => visible.has(e.source) && visible.has(e.target));
        }

        EdgeLanes.assign(this.visibleEdges);

        this.structureDirty = false;
        this.spatial = null;
        this.clusterCache = null;
    }

    private spatialIndex(): Quadtree<{node: GraphNode; order: number}> {
        this.refreshVisible();

        if (this.spatial === null) {
            let extent = 0;

            this.spatial = Quadtree.build(this.visibleNodes.map((node, order) => {
                const style = this.styles.node(node);
                extent = Math.max(extent, style.shape === 'card' ? CanvasRenderer.cardSize(node).w / 2 : style.radius);

                return {x: node.x, y: node.y, payload: {node: node, order: order}};
            }));
            this.spatialExtent = extent;
        }

        return this.spatial;
    }

    /** The node under a screen point; small dots get a padded target (pickHit). */
    private hitNode(screenX: number, screenY: number): GraphNode | null {
        if (this.isClustered()) {
            return null;
        }

        const index = this.spatialIndex();
        const world = this.camera.toWorld(screenX, screenY);
        const minTarget = MIN_HIT_RADIUS_PX / this.camera.scale;
        const candidates: HitCandidate<GraphNode>[] = [];

        for (const candidate of index.queryRadius(world.x, world.y, Math.max(this.spatialExtent, minTarget) + 1)) {
            const {node, order} = candidate.payload;
            const style = this.styles.node(node);
            const size = style.shape === 'card' ? CanvasRenderer.cardSize(node) : null;
            candidates.push({
                item: node, x: node.x, y: node.y, order: order,
                shape: size !== null ? {kind: 'box', w: size.w, h: size.h} : {kind: 'circle', radius: style.radius}
            });
        }

        return pickHit(candidates, world.x, world.y, minTarget);
    }

    /** Nearest edge within ~6 screen px of the point. */
    private hitEdge(screenX: number, screenY: number): GraphEdge | null {
        if (this.isClustered() || this.camera.scale < this.edgeMinZoom) {
            return null;
        }

        this.refreshVisible();
        const p = this.camera.toWorld(screenX, screenY);
        let best: GraphEdge | null = null;
        let bestDist = 6 / this.camera.scale;

        for (const edge of this.visibleEdges) {
            let dist: number;

            const curve = CanvasRenderer.edgeCurve(edge, this.edgeStyle, false);

            if (curve !== null) {
                let prev = curve[0];
                dist = Infinity;

                for (let i = 1; i <= 16; i++) {
                    const next = CanvasRenderer.cubicPoint(curve, i / 16);
                    dist = Math.min(dist, Geometry.distToSegment(p, prev, next));
                    prev = next;
                }
            } else {
                dist = Geometry.distToSegment(p, edge.source, edge.target);
            }

            if (dist <= bestDist) {
                bestDist = dist;
                best = edge;
            }
        }

        return best;
    }

    private nodesInPolygon(screenPolygon: ReadonlyArray<Point>): GraphNode[] {
        const polygon = screenPolygon.map((p) => this.camera.toWorld(p.x, p.y));
        const box = Geometry.boundsOfPoints(polygon);

        if (box === null) {
            return [];
        }

        return this.spatialIndex()
            .queryRect(box)
            .filter((candidate) => Geometry.pointInPolygon(candidate, polygon))
            .map((candidate) => candidate.payload.node);
    }

    private pruneSelection(): void {
        let changed = false;

        for (const id of this.selection) {
            if (!this.nodes.has(id)) {
                this.selection.delete(id);
                changed = true;
            }
        }

        if (changed) {
            this.events.emit('selectionChange', [...this.selection]);
        }
    }

    /**
     * additive=false replaces the selection. additive=true with `toggle`
     * (a modifier-click) flips each id; without toggle (lasso) adds them.
     */
    private applySelection(ids: string[], additive: boolean, toggle = false): void {
        const before = [...this.selection].join('\u0000');

        if (!additive) {
            this.selection.clear();
        }

        for (const id of ids) {
            if (toggle && this.selection.has(id)) {
                this.selection.delete(id);
            } else {
                this.selection.add(id);
            }
        }

        if ([...this.selection].join('\u0000') !== before) {
            this.events.emit('selectionChange', [...this.selection]);
        }

        this.loop.request();
    }

    private handleHover(node: GraphNode | null): void {
        this.hoveredId = node?.id ?? null;
        this.events.emit('nodeHover', node);
        this.updateTooltip();
        this.loop.request();
    }

    private handleEdgeHover(edge: GraphEdge | null, at: Point): void {
        const id = edge?.id ?? null;

        this.edgePointer = at;

        if (id !== this.hoveredEdgeId) {
            this.hoveredEdgeId = id;
            this.events.emit('edgeHover', edge);
            this.loop.request();
        }

        this.updateTooltip();
    }

    private updateTooltip(): void {
        const node = this.hoveredId !== null ? this.nodes.get(this.hoveredId) : undefined;
        const text = node !== undefined && this.tooltipText !== null ? this.tooltipText(node) : null;

        if (node === undefined || text === null) {
            // No node tooltip: an edge under the pointer may have one.
            const edge = node === undefined && this.hoveredEdgeId !== null ? this.edges.get(this.hoveredEdgeId) : undefined;
            const edgeText = edge !== undefined && this.edgeTooltipText !== null ? this.edgeTooltipText(edge) : null;

            if (edgeText === null) {
                this.tooltip.hide();
            } else {
                this.tooltip.show(edgeText, this.edgePointer.x, this.edgePointer.y);
            }
            return;
        }

        // The tooltip lives inside `root` (position:relative), so it takes local coordinates.
        const at = this.camera.toScreen(node.x, node.y);
        this.tooltip.show(text, at.x, at.y);
    }

    private handleClick(node: GraphNode | null, edge: GraphEdge | null, clientX: number, clientY: number,
        modifiers: ClickModifiers): void {
        if (node === null && this.isClustered()) {
            const rect = this.canvas.getBoundingClientRect();
            const cluster = this.clusterAt(clientX - rect.left, clientY - rect.top);

            if (cluster !== null) {
                this.events.emit('clusterClick', cluster);
                return;
            }
        }

        if (node === null && edge !== null) {
            this.events.emit('edgeClick', edge);
            return;
        }

        this.events.emit('nodeClick', node);

        if (node === null) {
            if (!modifiers.additive) {
                this.applySelection([], false);
            }
        } else {
            this.applySelection([node.id], modifiers.additive, true);
        }

        this.selectedId = node?.id ?? null;

        if (node === null || !this.detailPanelEnabled || modifiers.additive) {
            this.panel.hide();
            return;
        }

        this.panel.show(node, clientX, clientY);
    }

    private handleContextMenu(node: GraphNode | null, edge: GraphEdge | null, clientX: number, clientY: number): boolean {
        if (!this.events.has('contextMenu')) {
            return false;
        }

        const rect = this.canvas.getBoundingClientRect();
        const world = this.camera.toWorld(clientX - rect.left, clientY - rect.top);

        this.events.emit('contextMenu', {node: node, edge: edge, clientX: clientX, clientY: clientY, world: world});
        return true;
    }

    private readonly onVisibilityChange = (): void => {
        if (!this.pauseWhenHidden) {
            return;
        }

        if (document.hidden) {
            this.loop.pause();
        } else {
            this.loop.resume();
        }
    };

    private resize(): void {
        const dpr = window.devicePixelRatio || 1;
        // clientWidth/Height report the CSS *layout* size, which — unlike
        // getBoundingClientRect — is not distorted by a CSS transform on an
        // ancestor. That keeps the graph laid out correctly when it lives
        // inside a zoomed/scaled container (e.g. a pan-zoom board).
        const width = this.root.clientWidth;
        const height = this.root.clientHeight;

        this.width = width;
        this.height = height;
        this.canvas.width = Math.max(1, Math.round(width * dpr));
        this.canvas.height = Math.max(1, Math.round(height * dpr));
        this.invalidatePositions();
    }

    /** Run the layout one tick; returns the largest node movement in world px. */
    private tickLayout(nodes: GraphNode[], edges: GraphEdge[]): number {
        if (this.positionScratch.length < nodes.length * 2) {
            this.positionScratch = new Float64Array(nodes.length * 2);
        }

        const before = this.positionScratch;

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i] as GraphNode;
            before[i * 2] = node.x;
            before[i * 2 + 1] = node.y;
        }

        this.layout.tick(nodes, edges, this.width, this.height);
        let moved = 0;

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i] as GraphNode;
            moved = Math.max(moved, Math.abs(node.x - (before[i * 2] ?? 0)), Math.abs(node.y - (before[i * 2 + 1] ?? 0)));
        }

        return moved;
    }

    private readonly frame = (timeMs: number): boolean => {
        // A container without size (display:none tab) has nothing to draw;
        // the ResizeObserver requests a frame once it is visible again.
        if (this.width === 0 || this.height === 0) {
            return false;
        }

        this.refreshVisible();
        const wasFlying = this.camera.animating;
        const flying = this.camera.step(timeMs);

        if (wasFlying) {
            this.events.emit('viewportChange', this.camera.getState());
        }

        let layoutMoving = false;

        if (this.layoutActive) {
            const moved = this.tickLayout(this.visibleNodes, this.visibleEdges);

            if (moved > 0) {
                this.spatial = null;
                this.hullCache = null;
                this.clusterCache = null;
            }

            layoutMoving = moved > SETTLE_EPSILON;

            if (!layoutMoving) {
                this.layoutActive = false;
                this.events.emit('layoutSettle', null);
            }
        }

        this.overlayContext.timeMs = timeMs;
        this.overlayContext.scale = this.camera.scale;

        const clustered = this.isClustered();
        const gl = this.glLayer();
        const animating = this.renderer.draw({
            nodes: clustered ? [] : this.nodesInView(),
            edges: clustered || this.camera.scale < this.edgeMinZoom ? [] : this.visibleEdges,
            camera: this.camera,
            width: this.width,
            height: this.height,
            timeMs: timeMs,
            hoveredId: this.hoveredId,
            hoveredEdgeId: this.hoveredEdgeId,
            selection: this.selection,
            highlight: this.highlightSet,
            dimOthers: this.dimOthers,
            showLabels: this.showLabels,
            labelMinZoom: this.labelMinZoom,
            labelCollision: this.labelCollision,
            edgeStyle: this.edgeStyle,
            grid: this.grid,
            lasso: this.lassoPoints,
            styles: this.styles,
            hulls: this.hullPolygons().map((entry) => entry.render),
            overlays: this.overlays,
            overlayContext: this.overlayContext,
            clusters: clustered ? this.clusterScene() : null
        }, gl === null ? null : gl.buffers);

        if (gl !== null) {
            const origin = this.camera.toScreen(0, 0);

            gl.render({scale: this.camera.scale, offsetX: origin.x, offsetY: origin.y},
                this.width, this.height, window.devicePixelRatio || 1, this.theme.background);
        }

        if (this.hoveredId !== null && (layoutMoving || flying)) {
            this.updateTooltip();
        }

        return flying || layoutMoving || animating;
    };

    /**
     * The WebGL layer for this frame, or null to draw everything on 2d.
     * Created lazily the first time it is wanted; a lost context or missing
     * WebGL2 switches to 2d for good.
     */
    private glLayer(): WebGLLayer | null {
        const wanted = this.rendererMode === 'webgl'
            || (this.rendererMode === 'auto' && this.visibleNodes.length >= this.webglMinNodes);

        if (this.gl === null && wanted) {
            const canvas = document.createElement('canvas');

            canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; pointer-events:none;';
            this.root.insertBefore(canvas, this.canvas);
            this.gl = WebGLLayer.create(canvas) ?? false;

            if (this.gl === false) {
                canvas.remove();
            } else {
                // Redraw at once on 2d, even when the loop is idle.
                canvas.addEventListener('webglcontextlost', () => this.loop.request());
            }
        }

        if (this.gl && this.gl.lost) {
            this.gl.canvas.remove();
            this.gl = false;
        }

        if (!this.gl) {
            return null;
        }

        this.gl.canvas.style.display = wanted ? '' : 'none';

        return wanted ? this.gl : null;
    }

    /** The node if it exists and passes the filter. */
    private visibleNode(id: string): GraphNode | null {
        const node = this.nodes.get(id);

        if (node === undefined || (this.filterFn !== null && !this.filterFn(node))) {
            return null;
        }

        return node;
    }

    private hullPolygons(): Array<{hull: NGraphHull; render: RenderHull}> {
        if (this.hullCache !== null) {
            return this.hullCache;
        }

        this.refreshVisible();
        const visible = this.filterFn === null ? null : new Set(this.visibleNodes);
        const palette = this.theme.palette ?? Theme.palette;
        const out: Array<{hull: NGraphHull; render: RenderHull}> = [];

        for (const hull of this.hulls) {
            const points: Point[] = [];

            for (const id of hull.nodeIds) {
                const node = this.nodes.get(id);

                if (node !== undefined && (visible === null || visible.has(node))) {
                    points.push({x: node.x, y: node.y});
                }
            }

            if (points.length === 0) {
                continue;
            }

            out.push({
                hull: hull,
                render: {
                    polygon: Hull.padded(points, hull.padding ?? 24),
                    color: hull.color ?? Color.fromPalette(hull.id, palette) ?? this.theme.nodeStroke,
                    opacity: Math.min(1, Math.max(0, hull.opacity ?? 0.12))
                }
            });
        }

        this.hullCache = out;
        return out;
    }

    private static defaultTooltip(node: GraphNode): string {
        const detail = node.sublabel ?? `${Math.round(node.load * 100)}% load`;

        return `${node.label} · ${detail}`;
    }

    /** "Router ↔ Server · 63% load" (→ for directed edges; the edge label replaces the load). */
    public static defaultEdgeTooltip(edge: GraphEdge, directed = edge.directed === true): string {
        const arrow = directed ? '→' : '↔';
        const detail = edge.label ?? `${Math.round(edge.load * 100)}% load`;

        return `${edge.source.label} ${arrow} ${edge.target.label} · ${detail}`;
    }

    private static resolveTheme(theme: 'dark' | 'light' | ThemeTokens): ThemeTokens {
        if (theme === 'dark') {
            return Theme.dark;
        }

        if (theme === 'light') {
            return Theme.light;
        }

        return theme;
    }

}
