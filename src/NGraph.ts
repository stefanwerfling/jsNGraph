import { ForceLayoutOptions, ForceLayout } from './layout/ForceLayout';
import { GraphEdge } from './model/GraphEdge';
import { GraphNode } from './model/GraphNode';
import { NGraphEdgeData, NGraphNodeData } from './model/NGraphTypes';
import { CanvasRenderer } from './render/CanvasRenderer';
import { Theme, ThemeTokens } from './render/Theme';
import { InteractionController } from './interaction/InteractionController';
import { Tooltip } from './ui/Tooltip';
import { NodePanel } from './ui/NodePanel';
import { EventEmitter } from './util/EventEmitter';

export interface NGraphOptions {
    /** 'dark' (default) | 'light' | a custom palette. */
    theme?: 'dark' | 'light' | ThemeTokens;
    /** Draw a label under each node. Default true. */
    showLabels?: boolean;
    /** Allow dragging nodes to reposition them. Default true. */
    draggable?: boolean;
    /** Show the built-in click-to-open detail panel. Default true. */
    detailPanel?: boolean;
    layout?: ForceLayoutOptions;
}

interface NGraphEvents {
    nodeHover: GraphNode | null;
    nodeClick: GraphNode | null;
    [key: string]: unknown;
}

/**
 * Public entry point: an interactive, force-directed network topology graph
 * rendered on a canvas inside `container`. Feed it nodes/edges, it lays them
 * out, animates traffic on edges by load, and handles hover/click/drag.
 */
export class NGraph {

    private readonly root: HTMLDivElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly renderer: CanvasRenderer;
    private readonly layout: ForceLayout;
    private readonly interaction: InteractionController;
    private readonly tooltip: Tooltip;
    private readonly panel: NodePanel;
    private readonly events = new EventEmitter<NGraphEvents>();
    private readonly resizeObserver: ResizeObserver;

    private readonly nodes = new Map<string, GraphNode>();
    private readonly edges = new Map<string, GraphEdge>();

    private theme: ThemeTokens;
    private showLabels: boolean;
    private detailPanelEnabled: boolean;
    private selectedId: string | null = null;
    private hoveredId: string | null = null;
    private rafId: number | null = null;
    private width = 0;
    private height = 0;

    public constructor(container: HTMLElement, options: NGraphOptions = {}) {
        this.theme = NGraph.resolveTheme(options.theme ?? 'dark');
        this.showLabels = options.showLabels ?? true;
        this.detailPanelEnabled = options.detailPanel ?? true;

        this.root = document.createElement('div');
        this.root.style.cssText = 'position:relative; width:100%; height:100%; overflow:hidden;';
        container.appendChild(this.root);

        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'display:block; width:100%; height:100%;';
        this.root.appendChild(this.canvas);

        this.renderer = new CanvasRenderer(this.canvas, this.theme);
        this.layout = new ForceLayout(options.layout);
        this.tooltip = new Tooltip(this.root, this.theme);
        this.panel = new NodePanel(this.root, this.theme);
        this.panel.onClose(() => {
            this.selectedId = null;
        });

        this.interaction = new InteractionController(
            this.canvas,
            () => [...this.nodes.values()],
            {
                onHover: (node) => this.handleHover(node),
                onClick: (node, clientX, clientY) => this.handleClick(node, clientX, clientY)
            },
            options.draggable ?? true
        );

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.root);
        this.resize();

        this.rafId = requestAnimationFrame(this.frame);
    }

    /**
     * Replace the whole graph. Nodes without an explicit x/y are scattered
     * around the canvas center; the layout settles them from there.
     */
    public setData(nodes: NGraphNodeData[], edges: NGraphEdgeData[]): void {
        this.nodes.clear();
        this.edges.clear();

        for (const data of nodes) {
            this.addNode(data);
        }

        for (const data of edges) {
            this.addEdge(data);
        }
    }

    public addNode(data: NGraphNodeData): void {
        const cx = this.width / 2;
        const cy = this.height / 2;
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * Math.min(this.width, this.height) * 0.25;

        this.nodes.set(data.id, new GraphNode(data, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius));
    }

    public updateNode(id: string, patch: Partial<NGraphNodeData>): void {
        this.nodes.get(id)?.updateFrom(patch);
    }

    public removeNode(id: string): void {
        this.nodes.delete(id);

        for (const [edgeId, edge] of this.edges) {
            if (edge.source.id === id || edge.target.id === id) {
                this.edges.delete(edgeId);
            }
        }
    }

    public addEdge(data: NGraphEdgeData): void {
        const source = this.nodes.get(data.source);
        const target = this.nodes.get(data.target);

        if (source === undefined || target === undefined) {
            throw new Error(`NGraph: addEdge('${data.id}') references an unknown node`);
        }

        this.edges.set(data.id, new GraphEdge(data, source, target));
    }

    public updateEdge(id: string, patch: Partial<NGraphEdgeData>): void {
        this.edges.get(id)?.updateFrom(patch);
    }

    public removeEdge(id: string): void {
        this.edges.delete(id);
    }

    public setTheme(theme: 'dark' | 'light' | ThemeTokens): void {
        this.theme = NGraph.resolveTheme(theme);
        this.renderer.setTheme(this.theme);
        this.tooltip.setTheme(this.theme);
        this.panel.setTheme(this.theme);
    }

    public setShowLabels(show: boolean): void {
        this.showLabels = show;
    }

    public on<K extends keyof NGraphEvents>(event: K, listener: (payload: NGraphEvents[K]) => void): void {
        this.events.on(event, listener);
    }

    public off<K extends keyof NGraphEvents>(event: K, listener: (payload: NGraphEvents[K]) => void): void {
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

    private handleHover(node: GraphNode | null): void {
        this.hoveredId = node?.id ?? null;
        this.events.emit('nodeHover', node);

        if (node === null) {
            this.tooltip.hide();
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        this.tooltip.show(`${node.label} · ${Math.round(node.load * 100)}% load`, node.x + rect.left, node.y + rect.top);
    }

    private handleClick(node: GraphNode | null, clientX: number, clientY: number): void {
        this.events.emit('nodeClick', node);
        this.selectedId = node?.id ?? null;

        if (node === null || !this.detailPanelEnabled) {
            this.panel.hide();
            return;
        }

        this.panel.show(node, clientX, clientY);
    }

    private resize(): void {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.root.getBoundingClientRect();

        this.width = rect.width;
        this.height = rect.height;
        this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
        this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    }

    private readonly frame = (timeMs: number): void => {
        this.layout.tick([...this.nodes.values()], [...this.edges.values()], this.width, this.height);
        this.renderer.draw(
            [...this.nodes.values()],
            [...this.edges.values()],
            this.hoveredId,
            this.selectedId,
            timeMs,
            {showLabels: this.showLabels}
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
