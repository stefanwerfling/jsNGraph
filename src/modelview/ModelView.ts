import { Camera, Bounds } from './Camera';
import { FlowLayout, FlowLayoutOptions } from './FlowLayout';
import { Granularity, GranModule } from './Granularity';
import { ModelEdge } from './ModelEdge';
import { ModelInteraction } from './ModelInteraction';
import { ModelNode } from './ModelNode';
import { ModelPanel } from './ModelPanel';
import { GroupFrame, ModelRenderer } from './ModelRenderer';
import { ModelFlowData, ModelGraphData } from './ModelTypes';
import { Theme, ThemeTokens } from '../render/Theme';
import { Tooltip } from '../ui/Tooltip';
import { EventEmitter } from '../util/EventEmitter';

export interface ModelViewOptions {
    /** 'dark' (default) | 'light' | a custom palette. */
    theme?: 'dark' | 'light' | ThemeTokens;
    /** Draw the label/sublabel inside each block. Default true. */
    showLabels?: boolean;
    /** Animate flowing dots along edges marked `animated`. Default true. */
    animate?: boolean;
    /** Show the built-in click-to-open detail panel. Default true. */
    detailPanel?: boolean;
    /** Initial granularity level (0 = coarsest block view). Default 0. */
    level?: number;
    /** Flow-layout tuning (rank/lane gaps). */
    layout?: FlowLayoutOptions;
}

interface ModelViewEvents {
    moduleHover: ModelNode | null;
    moduleClick: ModelNode | null;
    [key: string]: unknown;
}

/**
 * Public entry point: an interactive, pan/zoom model-architecture graph drawn
 * on a canvas inside `container`. Feed it modules + flows, it lays them out
 * top-down, draws them as accent-coded blocks with animated data flow, and
 * handles pan/zoom/hover/click. A pure renderer — it never fetches or parses
 * a model; the consumer supplies whatever structure it wants to show.
 *
 * Modules may form a containment forest (`parent` + `level`): `setLevel`
 * walks between granularities, collapsing deeper modules onto their coarser
 * ancestors (see Granularity).
 */
export class ModelView {

    private readonly root: HTMLDivElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly renderer: ModelRenderer;
    private readonly camera: Camera;
    private readonly layout: FlowLayout;
    private readonly interaction: ModelInteraction;
    private readonly tooltip: Tooltip;
    private readonly panel: ModelPanel;
    private readonly events = new EventEmitter<ModelViewEvents>();
    private readonly resizeObserver: ResizeObserver;

    /** Every module from the last setData, keyed by id (all levels). */
    private readonly allNodes = new Map<string, ModelNode>();
    private allFlows: ModelFlowData[] = [];
    /** The subset shown at the current granularity level, laid out. */
    private visibleNodes: ModelNode[] = [];
    private edges: ModelEdge[] = [];
    /** Container frames for expanded parent modules at the current level. */
    private groups: GroupFrame[] = [];
    private level = 0;
    private maxLevel = 0;

    private theme: ThemeTokens;
    private showLabels: boolean;
    private animate: boolean;
    private detailPanelEnabled: boolean;
    private selectedId: string | null = null;
    private hoveredId: string | null = null;
    private rafId: number | null = null;
    /** While false, every resize re-frames the graph; a user pan/zoom locks it. */
    private userAdjusted = false;
    private width = 0;
    private height = 0;

    public constructor(container: HTMLElement, options: ModelViewOptions = {}) {
        this.theme = ModelView.resolveTheme(options.theme ?? 'dark');
        this.showLabels = options.showLabels ?? true;
        this.animate = options.animate ?? true;
        this.detailPanelEnabled = options.detailPanel ?? true;
        this.level = Math.max(0, Math.floor(options.level ?? 0));

        this.root = document.createElement('div');
        this.root.style.cssText = 'position:relative; width:100%; height:100%; overflow:hidden;';
        container.appendChild(this.root);

        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'display:block; width:100%; height:100%; cursor:grab;';
        this.root.appendChild(this.canvas);

        this.renderer = new ModelRenderer(this.canvas, this.theme);
        this.camera = new Camera();
        this.layout = new FlowLayout(options.layout);
        this.tooltip = new Tooltip(this.root, this.theme);
        this.panel = new ModelPanel(this.root, this.theme);
        this.panel.onClose(() => {
            this.selectedId = null;
        });

        this.interaction = new ModelInteraction(
            this.canvas,
            this.camera,
            () => this.visibleNodes,
            {
                onHover: (node) => this.handleHover(node),
                onClick: (node, clientX, clientY) => this.handleClick(node, clientX, clientY),
                onCameraChange: () => {
                    this.userAdjusted = true;
                    this.panel.hide();
                }
            }
        );

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.root);
        this.resize();

        this.rafId = requestAnimationFrame(this.frame);
    }

    /**
     * Replace the whole graph. Builds every module (all levels), clamps the
     * current level to the data's depth, derives the visible set, lays it out
     * and frames it.
     */
    public setData(data: ModelGraphData): void {
        this.allNodes.clear();
        this.selectedId = null;
        this.hoveredId = null;
        this.panel.hide();
        this.tooltip.hide();

        for (const moduleData of data.modules) {
            this.allNodes.set(moduleData.id, new ModelNode(moduleData));
        }

        // A module that is some other module's parent can be expanded for detail.
        const parentIds = new Set<string>();

        for (const moduleData of data.modules) {
            if (moduleData.parent !== undefined) {
                parentIds.add(moduleData.parent);
            }
        }

        for (const node of this.allNodes.values()) {
            node.expandable = parentIds.has(node.id);
        }

        for (const flowData of data.flows) {
            if (!this.allNodes.has(flowData.source) || !this.allNodes.has(flowData.target)) {
                throw new Error(`ModelView: flow '${flowData.source}->${flowData.target}' references an unknown module`);
            }
        }

        this.allFlows = data.flows;
        this.maxLevel = Granularity.maxLevel(this.metas());
        this.level = Math.min(this.level, this.maxLevel);

        this.rebuild();
    }

    /** Switch to granularity `level` (0 = coarsest); clamped to the data depth. */
    public setLevel(level: number): void {
        const clamped = Math.min(this.maxLevel, Math.max(0, Math.floor(level)));

        if (clamped === this.level) {
            return;
        }

        this.level = clamped;
        this.rebuild();
    }

    public getLevel(): number {
        return this.level;
    }

    /** Deepest granularity available in the current data (0 if flat). */
    public getMaxLevel(): number {
        return this.maxLevel;
    }

    public setTheme(theme: 'dark' | 'light' | ThemeTokens): void {
        this.theme = ModelView.resolveTheme(theme);
        this.renderer.setTheme(this.theme);
        this.tooltip.setTheme(this.theme);
        this.panel.setTheme(this.theme);
    }

    public setShowLabels(show: boolean): void {
        this.showLabels = show;
    }

    public setAnimate(animate: boolean): void {
        this.animate = animate;
    }

    /** Frame the whole graph in the viewport. */
    public fit(): void {
        if (this.visibleNodes.length === 0 || this.width === 0 || this.height === 0) {
            return;
        }

        this.camera.fit(this.bounds(), this.width, this.height);
        this.userAdjusted = false;
        this.panel.hide();
    }

    public zoomIn(): void {
        this.camera.zoomAt(this.width / 2, this.height / 2, 1.2);
        this.userAdjusted = true;
        this.panel.hide();
    }

    public zoomOut(): void {
        this.camera.zoomAt(this.width / 2, this.height / 2, 1 / 1.2);
        this.userAdjusted = true;
        this.panel.hide();
    }

    public on<K extends keyof ModelViewEvents>(event: K, listener: (payload: ModelViewEvents[K]) => void): void {
        this.events.on(event, listener);
    }

    public off<K extends keyof ModelViewEvents>(event: K, listener: (payload: ModelViewEvents[K]) => void): void {
        this.events.off(event, listener);
    }

    public destroy(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
        }

        this.resizeObserver.disconnect();
        this.interaction.destroy();
        this.tooltip.destroy();
        this.panel.destroy();
        this.root.remove();
    }

    /** Lightweight {id, level, parent} view of the modules for Granularity. */
    private metas(): GranModule[] {
        return [...this.allNodes.values()].map((node) => ({id: node.id, level: node.level, parent: node.parent}));
    }

    /**
     * Recompute the visible module set + resolved edges for the current level,
     * lay them out, and re-frame. Called on setData and every setLevel.
     */
    private rebuild(): void {
        const metas = this.metas();
        const visible = Granularity.visible(metas, this.level);
        const byId = new Map(metas.map((meta) => [meta.id, meta]));

        this.visibleNodes = [...this.allNodes.values()].filter((node) => visible.has(node.id));

        const resolved = Granularity.resolveFlows(this.allFlows, byId, visible);

        this.edges = resolved.map((flow, index) => new ModelEdge(
            {source: flow.source, target: flow.target, kind: flow.kind, animated: flow.animated, label: flow.label ?? undefined},
            this.allNodes.get(flow.source)!,
            this.allNodes.get(flow.target)!,
            (index * 0.37) % 1
        ));

        // Each visible node's outermost open-group ancestor (or '' for the
        // backbone) — lets the layout keep branch groups in their own column.
        const clusterOf = new Map<string, string>();

        for (const node of this.visibleNodes) {
            let outer = '';
            let parentId = node.parent;

            while (parentId !== null) {
                const parent = this.allNodes.get(parentId);

                if (parent === undefined) {
                    break;
                }

                if (!visible.has(parentId)) {
                    outer = parentId;
                }

                parentId = parent.parent;
            }

            clusterOf.set(node.id, outer);
        }

        this.layout.apply(this.visibleNodes, resolved, (node) => clusterOf.get(node.id) ?? '');
        this.groups = this.computeGroups(visible);

        // A selected/hovered module may have been collapsed away.
        if (this.selectedId !== null && !visible.has(this.selectedId)) {
            this.selectedId = null;
            this.panel.hide();
        }

        if (this.hoveredId !== null && !visible.has(this.hoveredId)) {
            this.hoveredId = null;
            this.tooltip.hide();
        }

        this.userAdjusted = false;

        if (this.width > 0 && this.height > 0 && this.visibleNodes.length > 0) {
            this.camera.fit(this.bounds(), this.width, this.height);
        }
    }

    private bounds(): Bounds {
        const bounds: Bounds = {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity};

        for (const node of this.visibleNodes) {
            bounds.minX = Math.min(bounds.minX, node.x - node.w / 2);
            bounds.minY = Math.min(bounds.minY, node.y - node.h / 2);
            bounds.maxX = Math.max(bounds.maxX, node.x + node.w / 2);
            bounds.maxY = Math.max(bounds.maxY, node.y + node.h / 2);
        }

        // Group frames (and their top label tabs) extend beyond the nodes.
        for (const group of this.groups) {
            bounds.minX = Math.min(bounds.minX, group.minX - group.pad);
            bounds.minY = Math.min(bounds.minY, group.minY - group.pad - 9);
            bounds.maxX = Math.max(bounds.maxX, group.maxX + group.pad);
            bounds.maxY = Math.max(bounds.maxY, group.maxY + group.pad);
        }

        return bounds;
    }

    /**
     * One container frame per EXPANDED parent (a module hidden at this level
     * but with visible descendants): the bounding box of those descendants,
     * padded more for outer groups so nested frames sit cleanly inside.
     */
    private computeGroups(visible: Set<string>): GroupFrame[] {
        const boxes = new Map<string, {minX: number; minY: number; maxX: number; maxY: number}>();

        for (const node of this.visibleNodes) {
            let parentId = node.parent;

            while (parentId !== null) {
                const parent = this.allNodes.get(parentId);

                if (parent === undefined) {
                    break;
                }

                if (!visible.has(parentId)) {
                    let box = boxes.get(parentId);

                    if (box === undefined) {
                        box = {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity};
                        boxes.set(parentId, box);
                    }

                    box.minX = Math.min(box.minX, node.x - node.w / 2);
                    box.minY = Math.min(box.minY, node.y - node.h / 2);
                    box.maxX = Math.max(box.maxX, node.x + node.w / 2);
                    box.maxY = Math.max(box.maxY, node.y + node.h / 2);
                }

                parentId = parent.parent;
            }
        }

        // depth = how many open-group ancestors a group has (deeper = inner).
        const depth = new Map<string, number>();

        for (const groupId of boxes.keys()) {
            let d = 0;
            let parentId = this.allNodes.get(groupId)!.parent;

            while (parentId !== null) {
                const parent = this.allNodes.get(parentId);

                if (parent === undefined) {
                    break;
                }

                if (boxes.has(parentId)) {
                    d++;
                }

                parentId = parent.parent;
            }

            depth.set(groupId, d);
        }

        const maxDepth = Math.max(0, ...depth.values());
        const frames: GroupFrame[] = [];

        for (const [groupId, box] of boxes) {
            const node = this.allNodes.get(groupId)!;

            frames.push({
                node: node,
                minX: box.minX,
                minY: box.minY,
                maxX: box.maxX,
                maxY: box.maxY,
                pad: 14 + 10 * (maxDepth - (depth.get(groupId) ?? 0))
            });
        }

        // Outer frames first so inner frames paint on top.
        frames.sort((a, b) => (depth.get(a.node.id) ?? 0) - (depth.get(b.node.id) ?? 0));

        return frames;
    }

    private handleHover(node: ModelNode | null): void {
        this.hoveredId = node?.id ?? null;
        this.events.emit('moduleHover', node);

        if (node === null) {
            this.tooltip.hide();
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        const screenX = node.x * this.camera.scale + this.camera.offsetX + rect.left;
        const screenY = (node.y - node.h / 2) * this.camera.scale + this.camera.offsetY + rect.top;
        const detail = node.sublabel ?? node.kind;

        this.tooltip.show(`${node.label} · ${detail}`, screenX, screenY);
    }

    private handleClick(node: ModelNode | null, clientX: number, clientY: number): void {
        this.events.emit('moduleClick', node);
        this.selectedId = node?.id ?? null;

        if (node === null || !this.detailPanelEnabled) {
            this.panel.hide();
            return;
        }

        this.panel.show(node, this.renderer.accentFor(node), clientX, clientY);
    }

    private resize(): void {
        const dpr = window.devicePixelRatio || 1;
        const width = this.root.clientWidth;
        const height = this.root.clientHeight;

        this.width = width;
        this.height = height;
        this.canvas.width = Math.max(1, Math.round(width * dpr));
        this.canvas.height = Math.max(1, Math.round(height * dpr));

        // Keep the graph framed on every resize until the user pans/zooms —
        // this also corrects the initial fit, whose dimensions may have been
        // stale when setData ran before the canvas was laid out.
        if (!this.userAdjusted && this.visibleNodes.length > 0 && width > 0 && height > 0) {
            this.camera.fit(this.bounds(), width, height);
        }
    }

    private readonly frame = (timeMs: number): void => {
        this.renderer.draw(
            this.visibleNodes,
            this.edges,
            this.groups,
            this.camera,
            this.hoveredId,
            this.selectedId,
            timeMs,
            {showLabels: this.showLabels, animate: this.animate}
        );

        this.rafId = requestAnimationFrame(this.frame);
    };

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
