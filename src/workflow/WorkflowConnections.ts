import { RectBoardGeometry, RectPoint } from '../rect/RectBoardGeometry';
import { WorkflowGeometry, WorkflowPortPlace } from './WorkflowGeometry';
import { WorkflowGroups } from './WorkflowGroups';
import { WorkflowModel } from './WorkflowModel';
import { WorkflowRenderer } from './WorkflowRenderer';
import { WorkflowRunState } from './WorkflowRunState';
import { WorkflowConnection } from './WorkflowTypes';

export interface WorkflowConnView {
    g: SVGGElement;
    hit: SVGPathElement;
    path: SVGPathElement;
    mid: RectPoint;
    /** Item-count pill, while the connection has one. */
    label: HTMLDivElement | null;
    /** The document label under the line, while the connection has one. */
    text: HTMLDivElement | null;
    /** Travelling dots, while the connection is active. */
    dots: SVGGElement | null;
}

/** What the connection layer needs from the editor. */
export interface WorkflowConnectionsHost {
    readonly model: WorkflowModel;
    readonly run: WorkflowRunState;
    selectedConnection(): string | null;
    /** Id of the connection whose label is being edited, or null. */
    editingConnection(): string | null;
    /** The edited connection is gone: drop its label editor without storing. */
    dropConnectionEdit(): void;
    /** Hide the insert/delete tools (viewer, or a gesture is running). */
    toolsHidden(): boolean;
    /** Something visible moved or changed (the minimap redraws). */
    changed(): void;
}

/**
 * The workflow editor's connections (internal): one SVG group per drawn
 * connection (hit path, line with arrow, travelling dots), its document
 * label and item-count pill in the label layer, and the insert/delete tools
 * on the hovered or selected connection.
 */
export class WorkflowConnections {

    /** Pull the arrow tip back from the port centre so it ends at the port's edge. */
    private static readonly ARROW_INSET = 8;

    public readonly views = new Map<string, WorkflowConnView>();
    /** The connection under the pointer (drives the tools), or null. */
    public hovered: string | null = null;

    public constructor(
        private readonly host: WorkflowConnectionsHost,
        private readonly scene: WorkflowRenderer,
        private readonly arrowId: string
    ) {}

    /** Forget all views (their elements went with `WorkflowRenderer.reset`). */
    public reset(): void {
        this.views.clear();
    }

    /** Sync the SVG connections with the model (create, update, drop). */
    public render(): void {
        const model = this.host.model;
        const seen = new Set<string>();

        for (const view of this.scene.nodeViews.values()) {
            for (const pv of view.ports.values()) {
                pv.el.classList.remove('wf-connected');
            }
        }

        this.scene.syncGroups();

        const hiddenBy = this.scene.hiddenBy;
        const obstacles = [...this.scene.nodeViews.values()].map((v) => v.rect);

        for (const conn of model.allConnections()) {
            if (WorkflowGroups.isInternal(conn, hiddenBy)) {
                continue;   // inside a collapsed group
            }

            const from = WorkflowGroups.drawnEnd(conn.from, hiddenBy);
            const to = WorkflowGroups.drawnEnd(conn.to, hiddenBy);
            const a = this.scene.nodeViews.get(from.node);
            const b = this.scene.nodeViews.get(to.node);
            const pa = a?.ports.get(`out:${from.port}`);
            const pb = b?.ports.get(`in:${to.port}`);

            if (a === undefined || b === undefined || pa === undefined || pb === undefined) {
                continue;   // kept in the document, just not drawable
            }

            seen.add(conn.id);
            pa.el.classList.add('wf-connected');
            pb.el.classList.add('wf-connected');

            let cv = this.views.get(conn.id);

            if (cv === undefined) {
                cv = this.createView(conn.id);
            }

            const {d, mid} = WorkflowGeometry.connectionPath(pa.place, WorkflowConnections.inset(pb.place), a.rect, b.rect, obstacles);
            cv.hit.setAttribute('d', d);
            cv.path.setAttribute('d', d);
            cv.mid = mid;
            cv.g.classList.toggle('wf-off',
                model.node(conn.from.node)?.disabled === true || model.node(conn.to.node)?.disabled === true);
            cv.g.classList.toggle('wf-selected', this.host.selectedConnection() === conn.id);
            this.applyText(conn, cv);
            this.applyStatus(conn.id, cv, d);
        }

        for (const [id, cv] of this.views) {
            if (!seen.has(id)) {
                if (this.host.editingConnection() === id) {
                    this.host.dropConnectionEdit();
                }
                cv.g.remove();
                cv.label?.remove();
                cv.text?.remove();
                this.views.delete(id);
            }
        }

        this.updateTools();
        this.host.changed();
    }

    /** Re-apply the run status of one drawn connection. */
    public refreshStatus(id: string): void {
        const cv = this.views.get(id);

        if (cv !== undefined) {
            this.applyStatus(id, cv, cv.path.getAttribute('d') ?? '');
        }
    }

    /** The document label under the line (hidden while it is being edited). */
    private applyText(conn: WorkflowConnection, cv: WorkflowConnView): void {
        if (conn.label === undefined) {
            cv.text?.remove();
            cv.text = null;
            return;
        }

        if (cv.text === null) {
            cv.text = document.createElement('div');
            cv.text.className = 'wf-conn-text';
            cv.text.dataset.wfConn = conn.id;      // clicks and hovers count as the connection's
            this.scene.labelLayer.appendChild(cv.text);
        }

        cv.text.textContent = conn.label;
        cv.text.title = conn.label;
        cv.text.style.left = `${cv.mid.x}px`;
        cv.text.style.top = `${cv.mid.y}px`;
        cv.text.style.visibility = this.host.editingConnection() === conn.id ? 'hidden' : '';
        cv.text.classList.toggle('wf-selected', this.host.selectedConnection() === conn.id);
        cv.text.classList.toggle('wf-off', cv.g.classList.contains('wf-off'));
        cv.text.classList.toggle('wf-dim', this.host.run.dims(conn));
    }

    /** Tint, item label, travelling dots and run-path dimming of one connection. */
    private applyStatus(id: string, cv: WorkflowConnView, d: string): void {
        const st = this.host.run.connection(id);
        const conn = this.host.model.connection(id);
        const text = st?.label ?? (st?.items === undefined ? undefined : WorkflowGeometry.itemsLabel(st.items));

        cv.g.classList.toggle('wf-st-success', st?.status === 'success');
        cv.g.classList.toggle('wf-st-error', st?.status === 'error');
        cv.g.classList.toggle('wf-dim', this.host.run.dims(conn));

        if (text === undefined) {
            cv.label?.remove();
            cv.label = null;
        } else {
            if (cv.label === null) {
                cv.label = document.createElement('div');
                cv.label.className = 'wf-conn-label';
                this.scene.labelLayer.appendChild(cv.label);
            }
            cv.label.textContent = text;
            cv.label.dataset.wfStatus = st?.status ?? '';
            cv.label.style.left = `${cv.mid.x}px`;
            cv.label.style.top = `${cv.mid.y}px`;
        }

        if (st?.active !== true) {
            cv.dots?.remove();
            cv.dots = null;
            return;
        }

        if (cv.dots === null) {
            // Three dots a third of a lap apart, each moving along the path (SMIL, no rAF needed).
            cv.dots = document.createElementNS(WorkflowRenderer.SVG_NS, 'g');
            cv.dots.classList.add('wf-dots');
            for (let i = 0; i < 3; i++) {
                const dot = document.createElementNS(WorkflowRenderer.SVG_NS, 'circle');
                const motion = document.createElementNS(WorkflowRenderer.SVG_NS, 'animateMotion');
                dot.setAttribute('r', '3.5');
                motion.setAttribute('dur', '1.2s');
                motion.setAttribute('repeatCount', 'indefinite');
                motion.setAttribute('begin', `${-i * 0.4}s`);
                dot.appendChild(motion);
                cv.dots.appendChild(dot);
            }
            cv.g.appendChild(cv.dots);
        }

        for (const motion of cv.dots.querySelectorAll('animateMotion')) {
            if (motion.getAttribute('path') !== d) {
                motion.setAttribute('path', d);
            }
        }
    }

    /** Show the insert/delete buttons on the hovered (else the selected) connection. */
    public updateTools(): void {
        const tools = this.scene.tools;
        const id = this.hovered ?? this.host.selectedConnection();
        const cv = id === null ? undefined : this.views.get(id);

        if (this.host.toolsHidden() || cv === undefined) {
            tools.style.display = 'none';
            return;
        }

        tools.dataset.wfFor = id!;
        tools.classList.toggle('wf-no-insert', !this.canInsertAt(id!));
        tools.style.display = '';
        tools.style.left = `${cv.mid.x}px`;
        tools.style.top = `${cv.mid.y}px`;
    }

    /** A node can be inserted into a connection only while its source node is shown. */
    public canInsertAt(connectionId: string): boolean {
        const conn = this.host.model.connection(connectionId);

        return conn !== undefined && !this.scene.hiddenBy.has(conn.from.node);
    }

    private createView(id: string): WorkflowConnView {
        const g = document.createElementNS(WorkflowRenderer.SVG_NS, 'g');
        const hit = document.createElementNS(WorkflowRenderer.SVG_NS, 'path');
        const path = document.createElementNS(WorkflowRenderer.SVG_NS, 'path');

        g.classList.add('wf-conn-g');
        g.dataset.wfConn = id;
        hit.classList.add('wf-conn-hit');
        path.classList.add('wf-conn');
        path.setAttribute('marker-end', `url(#${this.arrowId})`);
        g.append(hit, path);
        this.scene.connLayer.appendChild(g);

        const cv: WorkflowConnView = {g, hit, path, mid: {x: 0, y: 0}, label: null, text: null, dots: null};
        this.views.set(id, cv);

        return cv;
    }

    /** An input end moved out along its side normal, so the arrow tip meets the port edge. */
    public static inset(place: WorkflowPortPlace): WorkflowPortPlace {
        const n = RectBoardGeometry.normal(place.side);

        return {...place, x: place.x + n.x * WorkflowConnections.ARROW_INSET, y: place.y + n.y * WorkflowConnections.ARROW_INSET};
    }

}
