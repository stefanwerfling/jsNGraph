import { RectArea, RectBoardGeometry, RectPoint } from '../rect/RectBoardGeometry';
import { WorkflowGeometry, WorkflowPortPlace } from './WorkflowGeometry';
import { WorkflowGroups } from './WorkflowGroups';
import { WorkflowModel } from './WorkflowModel';
import { WorkflowRunState } from './WorkflowRunState';
import { WorkflowGroup, WorkflowNodeContext, WorkflowNodeData, WorkflowNodeType, WorkflowNote } from './WorkflowTypes';

export interface WorkflowPortView {
    place: WorkflowPortPlace;
    el: HTMLDivElement;
}

export interface WorkflowNodeView {
    el: HTMLDivElement;
    rect: RectArea;
    type: WorkflowNodeType | undefined;
    ports: Map<string, WorkflowPortView>;
}

export interface WorkflowBoxView {
    el: HTMLDivElement;
    rect: RectArea;
}

/** What the renderer needs from the editor. */
export interface WorkflowRendererHost {
    readonly model: WorkflowModel;
    readonly run: WorkflowRunState;
    /** The `groupBypass` option: frame headers get a bypass button. */
    readonly groupBypass: boolean;
    isSelected(id: string): boolean;
    /** Id of the group whose label is being edited, or null. */
    editingGroup(): string | null;
    /** The write-back handle for a custom node body. */
    nodeContext(id: string): WorkflowNodeContext;
    /** Something visible moved or changed (the minimap redraws). */
    changed(): void;
}

/**
 * The workflow editor's scene (internal): the stage with its layers, and
 * the DOM of nodes, sticky notes and groups (frames of expanded groups, one
 * node element per collapsed group) kept in sync with the model. The SVG
 * connection layer, label layer and connection tools live on the same stage
 * but are drawn by `WorkflowConnections`.
 */
export class WorkflowRenderer {

    public static readonly SVG_NS = 'http://www.w3.org/2000/svg';

    public readonly stage: HTMLDivElement;
    public readonly svg: SVGSVGElement;
    public readonly connLayer: SVGGElement;
    public readonly draftPath: SVGPathElement;
    public readonly nodeLayer: HTMLDivElement;
    public readonly noteLayer: HTMLDivElement;
    public readonly groupLayer: HTMLDivElement;
    public readonly labelLayer: HTMLDivElement;
    public readonly tools: HTMLDivElement;

    public readonly nodeViews = new Map<string, WorkflowNodeView>();
    public readonly noteViews = new Map<string, WorkflowBoxView>();
    /** Frames of expanded groups (a collapsed group is a node view under its own id). */
    public readonly groupViews = new Map<string, WorkflowBoxView>();

    /** Hidden node → the collapsed group drawn in its place. */
    private hidden = new Map<string, string>();
    /** Port layout of each drawn collapsed group, to notice when its border connections change. */
    private readonly groupSig = new Map<string, string>();

    public constructor(root: HTMLDivElement, private readonly host: WorkflowRendererHost, arrowId: string) {
        this.stage = document.createElement('div');
        this.stage.className = 'wf-stage';

        this.svg = document.createElementNS(WorkflowRenderer.SVG_NS, 'svg');
        this.svg.classList.add('wf-edges');
        this.svg.innerHTML =
            `<defs><marker id="${arrowId}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" ` +
            'markerWidth="10" markerHeight="10" orient="auto"><path class="wf-arrow" d="M0 1 L10 5 L0 9 z"/></marker></defs>';
        this.connLayer = document.createElementNS(WorkflowRenderer.SVG_NS, 'g');
        this.draftPath = document.createElementNS(WorkflowRenderer.SVG_NS, 'path');
        this.draftPath.classList.add('wf-conn-draft');
        this.draftPath.style.display = 'none';
        this.svg.append(this.connLayer, this.draftPath);

        this.nodeLayer = document.createElement('div');
        this.noteLayer = document.createElement('div');
        this.groupLayer = document.createElement('div');
        this.labelLayer = document.createElement('div');

        this.tools = document.createElement('div');
        this.tools.className = 'wf-conn-tools';
        this.tools.style.display = 'none';
        this.tools.innerHTML =
            '<button type="button" data-wf-tool="insert" title="Insert node">+</button>' +
            '<button type="button" data-wf-tool="delete" title="Delete connection">×</button>';

        this.stage.append(this.noteLayer, this.groupLayer, this.svg, this.nodeLayer, this.labelLayer, this.tools);
        root.appendChild(this.stage);
    }

    /** Hidden node → the collapsed group drawn in its place. */
    public get hiddenBy(): ReadonlyMap<string, string> {
        return this.hidden;
    }

    /** Empty every layer (connection layer and labels included) and forget all views. */
    public reset(): void {
        this.nodeLayer.replaceChildren();
        this.nodeViews.clear();
        this.noteLayer.replaceChildren();
        this.noteViews.clear();
        this.connLayer.replaceChildren();
        this.labelLayer.replaceChildren();
        this.groupLayer.replaceChildren();
        this.groupViews.clear();
        this.groupSig.clear();
    }

    public hasItem(id: string): boolean {
        return this.nodeViews.has(id) || this.noteViews.has(id) || this.groupViews.has(id);
    }

    public itemEl(id: string): HTMLElement | undefined {
        return this.nodeViews.get(id)?.el ?? this.noteViews.get(id)?.el ?? this.groupViews.get(id)?.el;
    }

    /** Drop the element of a removed node. */
    public removeNode(id: string): void {
        this.nodeViews.get(id)?.el.remove();
        this.nodeViews.delete(id);
    }

    /** Drop the element of a removed note. */
    public removeNote(id: string): void {
        this.noteViews.get(id)?.el.remove();
        this.noteViews.delete(id);
    }

    // ---- groups --------------------------------------------------------

    /**
     * Sync everything group-related with the model: which nodes are hidden
     * (members of collapsed groups), node elements for the visible ones, one
     * node element per collapsed group, and the frames of expanded groups.
     */
    public renderGroups(): void {
        const model = this.host.model;

        this.hidden = WorkflowGroups.hidden(model);

        for (const [id, view] of this.nodeViews) {
            if (model.node(id) === undefined || this.hidden.has(id)) {
                view.el.remove();             // gone, hidden, or a collapsed group (rebuilt below)
                this.nodeViews.delete(id);
            }
        }
        this.groupSig.clear();

        for (const node of model.allNodes()) {
            if (!this.hidden.has(node.id) && !this.nodeViews.has(node.id)) {
                this.renderNode(node);
            }
        }

        this.groupLayer.replaceChildren();
        this.groupViews.clear();

        // Outer frames first, so inner ones lie on top of them.
        const groups = model.allGroups().map((g) => ({g, depth: model.depth(g.id)})).sort((a, b) => a.depth - b.depth);

        for (const {g: group} of groups) {
            if (model.members(group.id).length === 0 || this.hidden.has(group.id)) {
                continue;
            }
            if (group.collapsed === true) {
                this.renderGroupBox(group);
            } else {
                this.renderGroupFrame(group);
            }
        }
    }

    /** A collapsed group as one node: proxy ports for the connections across its border. */
    private renderGroupBox(group: WorkflowGroup): void {
        const model = this.host.model;
        const type = WorkflowGroups.collapsedType(model, group);
        const rect = WorkflowGroups.collapsedRect(model, group, type);

        if (rect === null) {
            return;
        }

        const count = model.members(group.id).length;
        const data: WorkflowNodeData = {
            id: group.id, type: type.type, x: rect.x, y: rect.y,
            label: WorkflowGroups.label(group), sublabel: `${count} node${count === 1 ? '' : 's'}`
        };
        const view = this.buildNode(data, type, rect, true);
        const toggle = document.createElement('button');
        const old = this.nodeViews.get(group.id);

        view.el.dataset.wfGroup = group.id;
        view.el.classList.add('wf-group-node');
        toggle.type = 'button';
        toggle.className = 'wf-group-toggle';
        toggle.dataset.wfGroupToggle = group.id;
        toggle.title = 'Expand';
        toggle.textContent = '▸';
        view.el.appendChild(toggle);

        if (old === undefined) {
            this.nodeLayer.appendChild(view.el);
        } else {
            old.el.replaceWith(view.el);
        }

        this.nodeViews.set(group.id, view);
        this.groupSig.set(group.id, WorkflowRenderer.groupSignature(type));
        this.applyNodeStatus(group.id);
    }

    /** The frame around an expanded group: header with collapse button and label. */
    private renderGroupFrame(group: WorkflowGroup): void {
        const model = this.host.model;
        const el = document.createElement('div');
        const head = document.createElement('div');
        const toggle = document.createElement('button');
        const label = document.createElement('span');
        const count = document.createElement('span');
        const n = model.members(group.id).length;

        el.className = 'wf-group';
        el.dataset.wfGroupFrame = group.id;
        el.classList.toggle('wf-selected', this.host.isSelected(group.id));
        if (group.color !== undefined) {
            el.style.setProperty('--wf-group-color', group.color);
        }
        head.className = 'wf-group-head';
        head.dataset.wfGroupHead = group.id;
        toggle.type = 'button';
        toggle.className = 'wf-group-toggle';
        toggle.dataset.wfGroupToggle = group.id;
        toggle.title = 'Collapse';
        toggle.textContent = '▾';
        label.className = 'wf-group-label';
        label.textContent = WorkflowGroups.label(group);
        label.style.visibility = this.host.editingGroup() === group.id ? 'hidden' : '';
        count.className = 'wf-group-count';
        count.textContent = `${n} node${n === 1 ? '' : 's'}`;
        head.append(toggle, label, count);

        if (this.host.groupBypass) {
            const off = this.bypassed(group.id);
            const bypass = document.createElement('button');

            bypass.type = 'button';
            bypass.className = 'wf-group-bypass';
            bypass.dataset.wfGroupBypass = group.id;
            bypass.classList.toggle('wf-off', off);
            bypass.title = off ? 'Bypassed — click to enable' : 'Bypass';
            head.appendChild(bypass);
        }
        el.appendChild(head);
        this.groupLayer.appendChild(el);
        this.groupViews.set(group.id, {el, rect: {x: 0, y: 0, w: 0, h: 0}});
        this.positionGroup(group.id);
    }

    /** Every member node of a group (nested ones too) is disabled. */
    private bypassed(id: string): boolean {
        const model = this.host.model;
        const members = model.expandGroups([id]).filter((m) => model.node(m) !== undefined);

        return members.length > 0 && members.every((m) => model.node(m)!.disabled === true);
    }

    /** Group header bypass buttons follow their members' `disabled` state. */
    public refreshGroupBypass(): void {
        if (!this.host.groupBypass) {
            return;
        }

        for (const [id, frame] of this.groupViews) {
            const button = frame.el.querySelector<HTMLButtonElement>('[data-wf-group-bypass]');
            const off = this.bypassed(id);

            if (button !== null) {
                button.classList.toggle('wf-off', off);
                button.title = off ? 'Bypassed — click to enable' : 'Bypass';
            }
        }
    }

    /** Follow the members: move/resize a frame, move a collapsed group's node. */
    private positionGroup(id: string): void {
        const group = this.host.model.group(id);
        const frame = this.groupViews.get(id);

        if (group === undefined) {
            return;
        }
        if (frame === undefined) {
            this.positionNode(id);
            return;
        }

        const rect = WorkflowGroups.frameOf(this.host.model, group);

        if (rect === null) {
            return;
        }

        frame.rect = rect;
        frame.el.style.left = `${rect.x}px`;
        frame.el.style.top = `${rect.y}px`;
        frame.el.style.width = `${rect.w}px`;
        frame.el.style.height = `${rect.h}px`;
    }

    /**
     * Before connections are drawn: frames follow their members, and a
     * collapsed group whose border connections changed gets new ports.
     */
    public syncGroups(): void {
        const model = this.host.model;

        for (const group of model.allGroups()) {
            if (group.collapsed === true && this.nodeViews.has(group.id)) {
                const sig = WorkflowRenderer.groupSignature(WorkflowGroups.collapsedType(model, group));

                if (sig !== this.groupSig.get(group.id)) {
                    this.renderGroupBox(group);
                    continue;
                }
            }
            this.positionGroup(group.id);
        }
    }

    private static groupSignature(type: WorkflowNodeType): string {
        return JSON.stringify([type.label, type.color, type.inputs, type.outputs]);
    }

    /** Top-left of what is drawn for an id: a node, or a collapsed group at its members' corner. */
    private drawnAt(id: string): RectPoint | undefined {
        const model = this.host.model;
        const node = model.node(id);

        if (node !== undefined) {
            return node;
        }

        const group = model.group(id);

        return group?.collapsed === true ? WorkflowGroups.collapsedRect(model, group) ?? undefined : undefined;
    }

    // ---- nodes ---------------------------------------------------------

    /** (Re)build one node's element (a hidden node's collapsed group instead). */
    public renderNode(node: WorkflowNodeData): void {
        const hiddenIn = this.hidden.get(node.id);

        if (hiddenIn !== undefined) {
            const group = this.host.model.group(hiddenIn);
            if (group !== undefined) {
                this.renderGroupBox(group);
            }
            return;
        }

        const type = this.host.model.getType(node.type);
        const size = WorkflowGeometry.nodeSize(type, node);
        const view = this.buildNode(node, type, {x: node.x, y: node.y, w: size.w, h: size.h});
        const old = this.nodeViews.get(node.id);

        if (old === undefined) {
            this.nodeLayer.appendChild(view.el);
        } else {
            old.el.replaceWith(view.el);
        }

        this.nodeViews.set(node.id, view);
        this.positionNode(node.id);
        this.applyNodeStatus(node.id);
    }

    /** Status classes, badge and run-path dimming of one node. */
    public applyNodeStatus(id: string): void {
        const el = this.nodeViews.get(id)?.el;

        if (el === undefined) {
            return;
        }

        const st = this.host.run.statusOf(this.host.model, id);
        const status = st?.status ?? 'idle';

        for (const s of ['waiting', 'running', 'success', 'error'] as const) {
            el.classList.toggle(`wf-st-${s}`, status === s);
        }
        el.classList.toggle('wf-dim', !this.host.run.ran(this.host.model, id));

        let badge = el.querySelector<HTMLDivElement>(':scope > .wf-badge');

        if (status === 'idle') {
            badge?.remove();
            return;
        }
        if (badge === null) {
            badge = document.createElement('div');
            badge.className = 'wf-badge';
            el.appendChild(badge);
        }

        badge.dataset.wfStatus = status;
        badge.textContent = status === 'success' ? '✓' : status === 'error' ? '!' : status === 'waiting' ? '…' : '';
        badge.title = st?.message ?? status;
    }

    /** A node's element with body, ports, "+" buttons and port labels (not yet placed). */
    public buildNode(node: WorkflowNodeData, type: WorkflowNodeType | undefined, rect: RectArea, proxy = false): WorkflowNodeView {
        const size = {w: rect.w, h: rect.h};
        const el = document.createElement('div');

        el.className = 'wf-node';
        el.dataset.wfNode = node.id;
        el.style.width = `${size.w}px`;
        el.style.height = `${size.h}px`;
        el.classList.toggle('wf-disabled', node.disabled === true);
        el.classList.toggle('wf-collapsed', node.collapsed === true);
        el.classList.toggle('wf-unknown', type === undefined);
        el.classList.toggle('wf-selected', this.host.isSelected(node.id));
        if (type?.color !== undefined) {
            el.style.setProperty('--wf-node-color', type.color);
        }

        const body = document.createElement('div');
        body.className = 'wf-node-body';

        if (type?.render !== undefined && !proxy) {
            body.classList.add('wf-node-custom');
            type.render(structuredClone(node), body, this.host.nodeContext(node.id));
        } else {
            WorkflowRenderer.defaultBody(node, type, body);
        }
        el.appendChild(body);

        const view: WorkflowNodeView = {el, rect, type, ports: new Map()};

        for (const [key, place] of WorkflowGeometry.placePorts(type, rect)) {
            const portEl = document.createElement('div');
            portEl.className = 'wf-port';
            // A collapsed group's ports stand in for member ports: shown, not grabbed.
            portEl.dataset[proxy ? 'wfProxy' : 'wfPort'] = place.port.id;
            portEl.dataset.wfDir = place.dir;
            portEl.style.left = `${place.x - rect.x}px`;
            portEl.style.top = `${place.y - rect.y}px`;
            portEl.title = place.port.label ?? place.port.id;
            el.appendChild(portEl);

            // "+" for a free output, and for a free input that is not the main
            // left-hand one (sockets like a model/tool input at the bottom).
            if (!proxy && (place.dir === 'out' || place.side !== 'left')) {
                const n = RectBoardGeometry.normal(place.side);
                const add = document.createElement('button');
                add.type = 'button';
                add.className = 'wf-add';
                add.textContent = '+';
                add.title = 'Add node';
                add.dataset.wfAdd = place.port.id;
                add.dataset.wfDir = place.dir;
                add.style.left = `${place.x - rect.x + n.x * 36}px`;
                add.style.top = `${place.y - rect.y + n.y * 36}px`;
                el.appendChild(add);     // right after its port: CSS hides it once the port is connected
            }

            if (place.port.label !== undefined) {
                el.appendChild(WorkflowRenderer.portLabel(place, rect));
            }

            view.ports.set(key, {place, el: portEl});
        }

        return view;
    }

    /** Move a node's element to the model position and refresh its port places. */
    public positionNode(id: string): void {
        const view = this.nodeViews.get(id);
        const node = this.drawnAt(id);

        if (view === undefined || node === undefined) {
            return;
        }

        view.rect.x = node.x;
        view.rect.y = node.y;
        view.el.style.left = `${node.x}px`;
        view.el.style.top = `${node.y}px`;

        const places = WorkflowGeometry.placePorts(view.type, view.rect);

        for (const [key, pv] of view.ports) {
            const place = places.get(key);

            if (place !== undefined) {
                pv.place = place;
            }
        }
    }

    private static defaultBody(node: WorkflowNodeData, type: WorkflowNodeType | undefined, body: HTMLElement): void {
        const icon = document.createElement('div');
        icon.className = 'wf-node-icon';

        if (typeof type?.icon === 'function') {
            icon.appendChild(type.icon(structuredClone(node)));
        } else {
            icon.textContent = type?.icon ?? (type?.label ?? node.type).slice(0, 1).toUpperCase();
        }

        const text = document.createElement('div');
        text.className = 'wf-node-text';

        const label = document.createElement('div');
        label.className = 'wf-node-label';
        label.textContent = node.label ?? type?.label ?? node.type;
        text.appendChild(label);

        const subText = node.sublabel ?? (node.label !== undefined && type !== undefined ? type.label : undefined);

        if (subText !== undefined) {
            const sub = document.createElement('div');
            sub.className = 'wf-node-sub';
            sub.textContent = subText;
            text.appendChild(sub);
        }

        body.append(icon, text);
    }

    /** A port's label, placed outside the node next to its port. */
    private static portLabel(place: WorkflowPortPlace, rect: RectArea): HTMLSpanElement {
        const span = document.createElement('span');
        const px = place.x - rect.x;
        const py = place.y - rect.y;

        span.className = 'wf-port-label';
        span.textContent = place.port.label ?? '';

        switch (place.side) {
            case 'right':
                span.style.left = `${px + 10}px`;
                span.style.top = `${py - 16}px`;
                break;
            case 'left':
                span.style.right = `${rect.w - px + 10}px`;
                span.style.top = `${py - 16}px`;
                break;
            case 'top':
                span.style.left = `${px + 9}px`;
                span.style.top = `${py - 18}px`;
                break;
            default:
                span.style.left = `${px + 9}px`;
                span.style.top = `${py + 8}px`;
        }

        return span;
    }

    // ---- notes ---------------------------------------------------------

    /** (Re)build one sticky note's element. */
    public renderNote(note: WorkflowNote): void {
        const el = document.createElement('div');
        const text = document.createElement('div');
        const grip = document.createElement('div');

        el.className = 'wf-note';
        el.dataset.wfNote = note.id;
        el.classList.toggle('wf-selected', this.host.isSelected(note.id));
        if (note.color !== undefined) {
            el.style.setProperty('--wf-note-color', note.color);
        }
        text.className = 'wf-note-text';
        text.textContent = note.text;
        grip.className = 'wf-note-resize';
        grip.dataset.wfResize = note.id;
        el.append(text, grip);

        const old = this.noteViews.get(note.id);

        if (old === undefined) {
            this.noteLayer.appendChild(el);
        } else {
            old.el.replaceWith(el);
        }

        this.noteViews.set(note.id, {el, rect: {x: note.x, y: note.y, w: note.w, h: note.h}});
        this.positionNote(note.id);
    }

    public positionNote(id: string): void {
        const view = this.noteViews.get(id);
        const note = this.host.model.note(id);

        if (view === undefined || note === undefined) {
            return;
        }

        view.rect = {x: note.x, y: note.y, w: note.w, h: note.h};
        view.el.style.left = `${note.x}px`;
        view.el.style.top = `${note.y}px`;
        view.el.style.width = `${note.w}px`;
        view.el.style.height = `${note.h}px`;
        this.host.changed();
    }

}
