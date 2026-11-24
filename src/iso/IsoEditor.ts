import { EventEmitter } from '../util/EventEmitter';
import { Camera, CameraState } from '../view/Camera';
import { Color } from '../util/Color';
import { RectHistory } from '../rect/RectHistory';
import { IsoIcons } from './IsoIcons';
import { IsoFragment, IsoModel } from './IsoModel';
import { IsoBounds, IsoProjection } from './IsoProjection';
import { IsoRoute } from './IsoRoute';
import { IsoStyles, IsoStyleVar } from './IsoStyles';
import {
    IsoActor, IsoAnchor, IsoChangeKind, IsoConnector, IsoConnectorStatus, IsoDocument, IsoEditorEvents, IsoEditorOptions,
    IsoIconType, IsoItem, IsoItemStatus, IsoMode, IsoRegion, IsoText, IsoTile
} from './IsoTypes';

type Doc = Required<IsoDocument>;

/** A handle under the pointer: region corner, connector waypoint, segment midpoint or end. */
interface Handle {
    kind: 'corner' | 'via' | 'mid' | 'end';
    owner: string;
    index: number;
}

type Gesture =
    | {kind: 'pan'}
    | {kind: 'band'; x0: number; y0: number; x1: number; y1: number; additive: boolean}
    | {kind: 'move'; ids: Set<string>; start: IsoTile; dx: number; dy: number; orig: Doc}
    | {kind: 'region'; start: IsoTile; end: IsoTile}
    | {kind: 'connect'; from: IsoAnchor; to: IsoAnchor | null}
    | {kind: 'handle'; handle: Handle; orig: Doc; via: number};

/**
 * Isometric architecture diagram editor: items (devices, services) with our
 * own 3D icons standing on a tile grid, labels floating above them, regions
 * and text on the floor, connectors routed along the grid. DOM + SVG on one
 * stage moved by the shared camera; the floor is a single SVG group under the
 * isometric matrix, so everything on it is drawn in tile units.
 *
 * Editing (unless `readOnly`): move with tile snap, lasso, region corners,
 * connector waypoints and ends, modes for drawing connectors / regions /
 * texts, palette drops (`beginDrag`), inline label editing, keyboard,
 * clipboard, undo. The widget owns the document: one `change` event per
 * finished gesture.
 */
export class IsoEditor {

    private static readonly SVG = 'http://www.w3.org/2000/svg';
    private static readonly CLIP_KEY = 'jsngraph-iso';
    private static readonly REGION_COLORS = ['#8b7cf6', '#2fb3a5', '#e0664f', '#f0a03c', '#5b8def', '#d062a8'];

    private readonly root: HTMLDivElement;
    private readonly stage: HTMLDivElement;
    private readonly floor: SVGSVGElement;
    private readonly floorG: SVGGElement;
    private readonly gridPath: SVGPathElement;
    private readonly regionG: SVGGElement;
    private readonly baseG: SVGGElement;
    private readonly textG: SVGGElement;
    private readonly connG: SVGGElement;
    private readonly handleG: SVGGElement;
    private readonly statusG: SVGGElement;
    private readonly wallLayer: HTMLDivElement;
    private readonly actorLayer: HTMLDivElement;
    private readonly itemStatus = new Map<string, IsoItemStatus>();
    private readonly connStatus = new Map<string, IsoConnectorStatus>();
    private readonly actorEls = new Map<string, HTMLDivElement>();
    private readonly draftG: SVGGElement;
    private readonly connLabelLayer: HTMLDivElement;
    private readonly itemLayer: HTMLDivElement;
    private readonly labelLayer: HTMLDivElement;
    private readonly band: HTMLDivElement;
    private readonly events = new EventEmitter<IsoEditorEvents>();
    private readonly camera: Camera;
    private readonly proj: IsoProjection;
    private readonly icons = new Map<string, IsoIconType>();
    private readonly resizeObserver: ResizeObserver;
    private readonly history: RectHistory<Doc>;
    private doc: Doc = {items: [], connectors: [], regions: [], texts: []};
    private showGrid: boolean;
    private readOnlyMode: boolean;
    private mode: IsoMode;
    private selected = new Set<string>();
    private highlighted: Set<string> | null = null;
    private hoverId: string | null = null;
    private userMoved = false;
    private press: {x: number; y: number; target: EventTarget | null; moved: boolean; id: number; button: number; shift: boolean} | null = null;
    private gesture: Gesture | null = null;
    /** First end of a two-click connection in connect mode. */
    private pending: IsoAnchor | null = null;
    private pointer: {x: number; y: number} | null = null;
    private clipboard: IsoFragment | null = null;
    private editor: {el: HTMLInputElement; done: (commit: boolean) => void} | null = null;
    private dragCleanup: (() => void) | null = null;
    private raf = 0;
    private gridKey = '';

    public constructor(container: HTMLElement, options: IsoEditorOptions = {}) {
        IsoStyles.ensure();
        this.proj = new IsoProjection(options.tileSize ?? 100);
        this.camera = new Camera(options.minScale ?? 0.15, options.maxScale ?? 3);
        this.showGrid = options.grid ?? true;
        this.readOnlyMode = options.readOnly ?? false;
        this.mode = options.mode ?? 'select';
        for (const t of IsoIcons.builtins()) {
            this.icons.set(t.id, t);
        }
        for (const t of options.icons ?? []) {
            this.icons.set(t.id, {...t});
        }

        this.root = document.createElement('div');
        this.root.className = 'iso-root';
        this.root.tabIndex = 0;
        this.root.dataset.isoTheme = options.theme ?? 'dark';
        this.stage = document.createElement('div');
        this.stage.className = 'iso-stage';

        this.floor = document.createElementNS(IsoEditor.SVG, 'svg');
        this.floor.setAttribute('class', 'iso-floor');
        this.floorG = document.createElementNS(IsoEditor.SVG, 'g');
        this.floorG.setAttribute('transform', `matrix(${this.proj.floorMatrix().join(' ')})`);
        this.gridPath = document.createElementNS(IsoEditor.SVG, 'path');
        this.gridPath.setAttribute('class', 'iso-grid');
        this.regionG = document.createElementNS(IsoEditor.SVG, 'g');
        this.baseG = document.createElementNS(IsoEditor.SVG, 'g');
        this.textG = document.createElementNS(IsoEditor.SVG, 'g');
        this.connG = document.createElementNS(IsoEditor.SVG, 'g');
        this.handleG = document.createElementNS(IsoEditor.SVG, 'g');
        this.draftG = document.createElementNS(IsoEditor.SVG, 'g');
        this.statusG = document.createElementNS(IsoEditor.SVG, 'g');
        // connectors lie under the base tiles, so a line meets an item at its tile edge
        this.floorG.append(this.gridPath, this.regionG, this.textG, this.connG, this.baseG, this.statusG, this.draftG);
        this.floor.appendChild(this.floorG);
        // handles get their own floor-plane SVG above every label, so nothing covers them
        const handleSvg = document.createElementNS(IsoEditor.SVG, 'svg');
        handleSvg.setAttribute('class', 'iso-floor iso-handles');
        const handleMatrix = document.createElementNS(IsoEditor.SVG, 'g');
        handleMatrix.setAttribute('transform', `matrix(${this.proj.floorMatrix().join(' ')})`);
        handleMatrix.appendChild(this.handleG);
        handleSvg.appendChild(handleMatrix);

        this.itemLayer = document.createElement('div');
        this.itemLayer.className = 'iso-items';
        this.labelLayer = document.createElement('div');
        this.labelLayer.className = 'iso-labels';
        this.connLabelLayer = document.createElement('div');
        this.connLabelLayer.className = 'iso-labels';
        this.wallLayer = document.createElement('div');
        this.wallLayer.className = 'iso-items iso-walls';
        this.actorLayer = document.createElement('div');
        this.actorLayer.className = 'iso-items iso-actors';
        this.stage.append(this.floor, this.wallLayer, this.itemLayer, this.actorLayer, this.connLabelLayer, this.labelLayer, handleSvg);
        this.band = document.createElement('div');
        this.band.className = 'iso-band';
        this.band.hidden = true;
        this.root.append(this.stage, this.band);
        container.appendChild(this.root);
        this.applyModeClass();

        this.root.addEventListener('pointerdown', this.onDown);
        this.root.addEventListener('pointermove', this.onMove);
        this.root.addEventListener('pointerup', this.onUp);
        this.root.addEventListener('pointercancel', this.onUp);
        this.root.addEventListener('pointerleave', this.onLeave);
        this.root.addEventListener('wheel', this.onWheel, {passive: false});
        this.root.addEventListener('dblclick', this.onDblClick);
        this.root.addEventListener('keydown', this.onKey);
        document.addEventListener('copy', this.onCopy);
        document.addEventListener('cut', this.onCut);
        document.addEventListener('paste', this.onPaste);
        this.resizeObserver = new ResizeObserver(() => {
            if (!this.userMoved) {
                this.fit(false);
            } else {
                this.applyCamera();
            }
        });
        this.resizeObserver.observe(this.root);

        this.doc = IsoModel.normalize(options.document ?? {items: []});
        this.history = new RectHistory<Doc>(this.doc, options.historySize ?? 100, (d) => JSON.parse(JSON.stringify(d)) as Doc);
        this.render();
        this.fit(false);
    }

    // ---- public API: document ------------------------------------------------------------------------------

    public get element(): HTMLDivElement {
        return this.root;
    }

    public on<K extends keyof IsoEditorEvents>(event: K, listener: (payload: IsoEditorEvents[K]) => void): this {
        this.events.on(event, listener);
        return this;
    }

    public off<K extends keyof IsoEditorEvents>(event: K, listener: (payload: IsoEditorEvents[K]) => void): this {
        this.events.off(event, listener);
        return this;
    }

    /** A copy of the document. */
    public getDocument(): IsoDocument {
        return JSON.parse(JSON.stringify(this.doc)) as IsoDocument;
    }

    /** Replace the document (forgets the undo history). */
    public setDocument(doc: IsoDocument): void {
        this.doc = IsoModel.normalize(doc);
        this.history.reset(this.doc);
        this.pruneSelection();
        this.render();
        if (!this.userMoved) {
            this.fit(false);
        }
    }

    /** Add an item; it lands on the nearest free tile. Returns its id. */
    public addItem(data: Omit<IsoItem, 'id'> & {id?: string}): string {
        const id = data.id ?? IsoModel.uid(this.doc, 'item');
        const it: IsoItem = {...JSON.parse(JSON.stringify(data)) as IsoItem, id, tile: IsoModel.freeTileNear(this.doc, data.tile)};

        this.doc.items.push(it);
        this.commit('add', [id]);

        return id;
    }

    public addConnector(from: IsoAnchor, to: IsoAnchor, data: Partial<Omit<IsoConnector, 'id' | 'from' | 'to'>> & {id?: string} = {}): string {
        const id = data.id ?? IsoModel.uid(this.doc, 'link');

        this.doc.connectors.push({
            ...JSON.parse(JSON.stringify(data)) as Partial<IsoConnector>, id,
            from: IsoEditor.cloneAnchor(from), to: IsoEditor.cloneAnchor(to)
        });
        this.commit('connect', [id]);

        return id;
    }

    public addRegion(from: IsoTile, to: IsoTile, data: Partial<Omit<IsoRegion, 'id' | 'from' | 'to'>> & {id?: string} = {}): string {
        const id = data.id ?? IsoModel.uid(this.doc, 'region');
        const r = IsoProjection.rect(from, to);

        this.doc.regions.push({
            color: IsoEditor.REGION_COLORS[this.doc.regions.length % IsoEditor.REGION_COLORS.length],
            ...JSON.parse(JSON.stringify(data)) as Partial<IsoRegion>, id,
            from: {x: r.x0, y: r.y0}, to: {x: r.x1, y: r.y1}
        });
        this.commit('region', [id]);

        return id;
    }

    public addText(tile: IsoTile, text: string, data: Partial<Omit<IsoText, 'id' | 'tile' | 'text'>> & {id?: string} = {}): string {
        const id = data.id ?? IsoModel.uid(this.doc, 'text');

        this.doc.texts.push({...JSON.parse(JSON.stringify(data)) as Partial<IsoText>, id, tile: {x: tile.x, y: tile.y}, text});
        this.commit('text', [id]);

        return id;
    }

    /** Remove these elements (and connectors attached to removed items). */
    public remove(ids: string[]): void {
        const removed = IsoModel.remove(this.doc, new Set(ids));

        if (removed.length > 0) {
            this.pruneSelection();
            this.commit('remove', removed);
        }
    }

    /** Patch one item (moving it re-routes its connectors). One undo step. */
    public updateItem(id: string, patch: Partial<Omit<IsoItem, 'id'>>): void {
        this.patch(this.doc.items.find((i) => i.id === id), patch);
    }

    /** Patch one connector (style, label, animation, ends, waypoints). One undo step. */
    public updateConnector(id: string, patch: Partial<Omit<IsoConnector, 'id'>>): void {
        this.patch(this.doc.connectors.find((x) => x.id === id), patch);
    }

    public updateRegion(id: string, patch: Partial<Omit<IsoRegion, 'id'>>): void {
        this.patch(this.doc.regions.find((x) => x.id === id), patch);
    }

    public updateText(id: string, patch: Partial<Omit<IsoText, 'id'>>): void {
        this.patch(this.doc.texts.find((x) => x.id === id), patch);
    }

    /** The element with this id, whatever its kind. */
    public get(id: string): IsoItem | IsoConnector | IsoRegion | IsoText | undefined {
        const all: Array<{id: string}> = [...this.doc.items, ...this.doc.connectors, ...this.doc.regions, ...this.doc.texts];
        const hit = all.find((x) => x.id === id) as IsoItem | IsoConnector | IsoRegion | IsoText | undefined;

        return hit === undefined ? undefined : JSON.parse(JSON.stringify(hit)) as typeof hit;
    }

    public kindOf(id: string): 'item' | 'connector' | 'region' | 'text' | null {
        return IsoModel.kindOf(this.doc, id);
    }

    /** The tiles a connector runs through (corners only), as drawn. */
    public getRoute(id: string): IsoTile[] {
        const c = this.doc.connectors.find((x) => x.id === id);
        const r = c !== undefined ? this.route(c) : null;

        return r === null ? [] : r.corners.map((t) => ({x: t.x, y: t.y}));
    }

    public undo(): boolean {
        return this.restore(this.history.undo(), 'undo');
    }

    public redo(): boolean {
        return this.restore(this.history.redo(), 'redo');
    }

    public get canUndo(): boolean {
        return this.history.canUndo;
    }

    public get canRedo(): boolean {
        return this.history.canRedo;
    }

    // ---- public API: clipboard, palette ---------------------------------------------------------------------

    /** Copy the selection (also to the system clipboard when allowed). Returns a copy of the fragment. */
    public copy(): IsoFragment | null {
        if (this.selected.size === 0) {
            return null;
        }
        this.clipboard = IsoModel.fragment(this.doc, this.selected);
        const json = JSON.stringify(this.clipboard);
        navigator.clipboard?.writeText(`{"${IsoEditor.CLIP_KEY}":${json}}`).catch(() => undefined);

        return JSON.parse(json) as IsoFragment;
    }

    public cut(): void {
        if (this.copy() !== null) {
            this.remove([...this.selected]);
        }
    }

    /** Paste a fragment (default: the last copied) with its top-left at `at` (default: the tile under the pointer). */
    public paste(fragment?: IsoFragment, at?: IsoTile): string[] {
        const f = fragment ?? this.clipboard;

        if (f === null || f === undefined) {
            return [];
        }
        const o = IsoModel.origin(f) ?? {x: 0, y: 0};
        const target = at ?? this.pointerTile() ?? {x: o.x + 1, y: o.y + 1};
        const ids = IsoModel.paste(this.doc, f, target);

        this.selected = new Set(ids);
        this.commit('paste', ids);
        this.events.emit('selectionChange', ids);

        return ids;
    }

    /** Copy the selection one tile down-right. */
    public duplicate(): string[] {
        if (this.selected.size === 0) {
            return [];
        }
        const f = IsoModel.fragment(this.doc, this.selected);
        const o = IsoModel.origin(f) ?? {x: 0, y: 0};

        return this.paste(f, {x: o.x + 1, y: o.y + 1});
    }

    /**
     * Start dragging a new item from a host palette: call it from the palette
     * entry's `pointerdown`. A ghost follows the pointer; releasing over the
     * editor places the item (`dropAt`), Escape cancels.
     */
    public beginDrag(icon: string, event: PointerEvent, data: Partial<Omit<IsoItem, 'id' | 'tile' | 'icon'>> = {}): void {
        if (this.readOnly) {
            return;
        }
        this.dragCleanup?.();
        event.preventDefault();
        const type = this.icons.get(icon) ?? this.icons.get('box')!;
        const ghost = document.createElement('div');
        const size = (): number => this.proj.tileW * this.camera.scale;

        ghost.className = 'iso-ghost';
        ghost.innerHTML = IsoIcons.svg(type, data.color);
        document.body.appendChild(ghost);
        const place = (x: number, y: number): void => {
            const s = size();
            ghost.style.width = `${s}px`;
            ghost.style.height = `${s * 1.4}px`;
            ghost.style.transform = `translate(${x - s / 2}px, ${y - s * 1.15}px)`;
            const tile = this.inside(x, y) ? this.tileAtClient(x, y) : null;
            this.drawCursor(tile !== null ? IsoModel.freeTileNear(this.doc, tile) : null);
        };
        const move = (e: PointerEvent): void => place(e.clientX, e.clientY);
        const up = (e: PointerEvent): void => {
            cleanup();
            if (this.inside(e.clientX, e.clientY)) {
                this.dropAt(icon, e.clientX, e.clientY, data);
            }
        };
        const key = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                cleanup();
            }
        };
        const cleanup = (): void => {
            ghost.remove();
            this.drawCursor(null);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('keydown', key);
            this.dragCleanup = null;
        };
        this.dragCleanup = cleanup;
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('keydown', key);
        place(event.clientX, event.clientY);
    }

    /** Place a new item at a client point (nearest free tile); label defaults to the icon's name. */
    public dropAt(icon: string, clientX: number, clientY: number, data: Partial<Omit<IsoItem, 'id' | 'tile' | 'icon'>> = {}): string {
        const type = this.icons.get(icon);
        const id = this.addItem({label: type?.label ?? icon, ...data, icon, tile: this.tileAtClient(clientX, clientY)});

        this.select([id]);
        this.root.focus({preventScroll: true});

        return id;
    }

    // ---- public API: live status, actors (display state, not document data) ------------------------------

    /** Show an item's live state: a ring on the floor, a status line and progress bar in its label. null clears. */
    public setItemStatus(id: string, status: IsoItemStatus | null): void {
        if (status === null) {
            this.itemStatus.delete(id);
        } else {
            this.itemStatus.set(id, {...status});
        }
        this.applyItemStatus(id);
    }

    public setConnectorStatus(id: string, status: IsoConnectorStatus | null): void {
        if (status === null) {
            this.connStatus.delete(id);
        } else {
            this.connStatus.set(id, {...status});
        }
        this.applyConnectorStatus(id);
    }

    public clearStatus(): void {
        const items = [...this.itemStatus.keys()], conns = [...this.connStatus.keys()];

        this.itemStatus.clear();
        this.connStatus.clear();
        items.forEach((id) => this.applyItemStatus(id));
        conns.forEach((id) => this.applyConnectorStatus(id));
    }

    /**
     * Place the moving things: actors keep their element across calls (only
     * position, depth and look change), actors missing from the list go away.
     */
    public setActors(actors: IsoActor[]): void {
        const k = this.proj.tileW / IsoIcons.W;
        const keep = new Set<string>();

        for (const a of actors) {
            keep.add(a.id);
            let el = this.actorEls.get(a.id);
            const look = `${a.icon}|${a.color ?? ''}`;
            if (el === undefined) {
                el = document.createElement('div');
                el.className = 'iso-item iso-actor';
                el.dataset.actor = a.id;
                this.actorLayer.appendChild(el);
                this.actorEls.set(a.id, el);
            }
            if (el.dataset.look !== look) {
                el.dataset.look = look;
                el.innerHTML = IsoIcons.svg(this.icons.get(a.icon) ?? this.icons.get('box')!, a.color);
            }
            const s = a.scale ?? 1;
            const c = this.proj.toWorld(a.u, a.v);
            el.style.left = `${c.x - IsoIcons.CX * k * s}px`;
            el.style.top = `${c.y - IsoIcons.CY * k * s}px`;
            el.style.width = `${IsoIcons.W * k * s}px`;
            el.style.height = `${IsoIcons.H * k * s}px`;
            el.style.transform = a.flip === true ? 'scaleX(-1)' : '';
            // just in front of an item on the same spot (a crate on a conveyor)
            el.style.zIndex = String(IsoProjection.zOf(a.u, a.v, 2));
            if (a.title !== undefined) {
                el.title = a.title;
            }
        }
        for (const [id, el] of this.actorEls) {
            if (!keep.has(id)) {
                el.remove();
                this.actorEls.delete(id);
            }
        }
    }

    // ---- public API: view, mode ----------------------------------------------------------------------------

    /** True while the editor is a viewer (no editing gestures). */
    public get readOnly(): boolean {
        return this.readOnlyMode;
    }

    /** @deprecated use the `readOnly` getter. */
    public isReadOnly(): boolean {
        return this.readOnlyMode;
    }

    public setReadOnly(readOnly: boolean): void {
        this.readOnlyMode = readOnly;
        this.cancelGesture();
        this.closeEditor(false);
        this.applyModeClass();
        this.renderHandles();
    }

    public getMode(): IsoMode {
        return this.mode;
    }

    public setMode(mode: IsoMode): void {
        if (mode === this.mode) {
            return;
        }
        this.mode = mode;
        this.pending = null;
        this.cancelGesture();
        this.applyModeClass();
        this.renderHandles();
        this.events.emit('modeChange', mode);
    }

    public setTheme(theme: 'dark' | 'light'): void {
        this.root.dataset.isoTheme = theme;
    }

    public setGrid(on: boolean): void {
        this.showGrid = on;
        this.gridKey = '';
        this.drawGrid();
    }

    /** Add or replace icon types (re-renders). */
    public registerIcons(types: readonly IsoIconType[]): void {
        for (const t of types) {
            this.icons.set(t.id, {...t});
        }
        this.render();
    }

    /** All known icon types (built-in and registered), e.g. for a palette — copies. */
    public getIconTypes(): IsoIconType[] {
        return [...this.icons.values()].map((t) => ({...t}));
    }

    /** Override `--iso-*` custom properties on the root (null removes an override). */
    public setStyleVars(vars: Partial<Record<IsoStyleVar, string | null>>): void {
        for (const [k, v] of Object.entries<string | null | undefined>(vars)) {
            if (v === null || v === undefined) {
                this.root.style.removeProperty(`--iso-${k}`);
            } else {
                this.root.style.setProperty(`--iso-${k}`, v);
            }
        }
    }

    public select(ids: string[]): void {
        this.selected = new Set(ids.filter((id) => IsoModel.kindOf(this.doc, id) !== null));
        this.applyClasses();
        this.renderHandles();
        this.events.emit('selectionChange', [...this.selected]);
    }

    public selectAll(): void {
        this.select([...this.doc.items, ...this.doc.connectors, ...this.doc.regions, ...this.doc.texts].map((x) => x.id));
    }

    public getSelection(): string[] {
        return [...this.selected];
    }

    /** Emphasise these items (everything else dims); null clears. */
    public highlight(ids: string[] | null): void {
        this.highlighted = ids === null ? null : new Set(ids);
        this.applyClasses();
    }

    /** Edit the label of an item, connector or region, or a text, in place. */
    public editLabel(id: string): void {
        const kind = IsoModel.kindOf(this.doc, id);

        if (kind === null || this.readOnly) {
            return;
        }
        const el = this.root.querySelector<HTMLElement>(
            kind === 'item' ? `.iso-label[data-item="${CSS.escape(id)}"]` : kind === 'connector' ? `.iso-conn-label[data-connector="${CSS.escape(id)}"]` : '.none');
        const r = this.root.getBoundingClientRect();
        let x: number, y: number;

        if (el !== null) {
            const b = el.getBoundingClientRect();
            x = b.left + b.width / 2 - r.left;
            y = b.top + b.height / 2 - r.top;
        } else {
            const w = this.labelWorld(id);
            const s = this.camera.toScreen(w.x, w.y);
            x = s.x;
            y = s.y;
        }
        const current = this.labelOf(id);
        const input = document.createElement('input');

        input.className = 'iso-input';
        input.value = current;
        input.placeholder = kind === 'text' ? 'text' : 'label';
        input.style.left = `${x}px`;
        input.style.top = `${y}px`;
        this.root.appendChild(input);
        input.focus();
        input.select();
        const done = (commit: boolean): void => {
            if (this.editor?.el !== input) {
                return;
            }
            this.editor = null;
            input.remove();
            this.root.focus({preventScroll: true});
            if (commit && input.value !== current) {
                this.setLabel(id, input.value);
            }
        };
        this.editor = {el: input, done};
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                done(true);
            } else if (e.key === 'Escape') {
                done(false);
            }
        });
        input.addEventListener('blur', () => done(true));
    }

    /** Frame the whole diagram. */
    public fit(animate = true): void {
        const b = this.contentBounds();
        const w = this.root.clientWidth, h = this.root.clientHeight;

        if (w <= 0 || h <= 0) {
            return;
        }
        let target = this.camera.fitState(b, w, h, 40, 40);
        if (target.scale > 1.4) {
            target = this.camera.centerState((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, w, h, 1.4);
        }
        this.userMoved = false;
        this.flyTo(target, animate);
    }

    /** Centre an item (zooming in to at least `scale`). */
    public focus(id: string, scale = 1): void {
        const it = this.doc.items.find((i) => i.id === id);

        if (it === undefined) {
            return;
        }
        const c = this.proj.center(it.tile);
        this.userMoved = true;
        this.flyTo(this.camera.centerState(c.x, c.y - this.proj.tileW * 0.4, this.root.clientWidth, this.root.clientHeight,
            Math.max(scale, this.camera.scale)), true);
    }

    public getViewport(): CameraState {
        return this.camera.getState();
    }

    public setViewport(state: CameraState): void {
        this.userMoved = true;
        this.camera.setState(state);
        this.applyCamera();
    }

    public destroy(): void {
        cancelAnimationFrame(this.raf);
        this.dragCleanup?.();
        this.resizeObserver.disconnect();
        document.removeEventListener('copy', this.onCopy);
        document.removeEventListener('cut', this.onCut);
        document.removeEventListener('paste', this.onPaste);
        this.events.clear();
        this.root.remove();
    }

    // ---- document plumbing --------------------------------------------------------------------------------

    private patch<T extends object>(target: T | undefined, patch: object): void {
        if (target === undefined) {
            return;
        }
        Object.assign(target, JSON.parse(JSON.stringify(patch)));
        this.commit('update', [(target as {id: string}).id]);
    }

    /** Record an undo step, redraw, tell the host. */
    private commit(kind: IsoChangeKind, ids: string[]): void {
        this.history.record(this.doc);
        this.render();
        this.events.emit('change', {kind, ids});
    }

    private restore(state: Doc | undefined, kind: 'undo' | 'redo'): boolean {
        if (state === undefined) {
            return false;
        }
        this.doc = JSON.parse(JSON.stringify(state)) as Doc;
        this.pruneSelection();
        this.render();
        this.events.emit('change', {kind, ids: []});
        this.events.emit('selectionChange', [...this.selected]);

        return true;
    }

    private pruneSelection(): void {
        this.selected = new Set([...this.selected].filter((id) => IsoModel.kindOf(this.doc, id) !== null));
    }

    private labelOf(id: string): string {
        const x = this.get(id);

        return x === undefined ? '' : 'text' in x && typeof x.text === 'string' ? x.text : (x as {label?: string}).label ?? '';
    }

    private setLabel(id: string, value: string): void {
        const kind = IsoModel.kindOf(this.doc, id);
        const v = value.trim();

        if (kind === 'text') {
            if (v === '') {
                this.remove([id]);
            } else {
                this.updateText(id, {text: v});
            }
            return;
        }
        const target = kind === 'item' ? this.doc.items.find((i) => i.id === id)
            : kind === 'connector' ? this.doc.connectors.find((c) => c.id === id) : this.doc.regions.find((r) => r.id === id);
        if (target === undefined) {
            return;
        }
        if (v === '') {
            delete target.label;
        } else {
            target.label = v;
        }
        this.commit('update', [id]);
    }

    /** World point where an element's label sits (for the inline editor when no label is drawn yet). */
    private labelWorld(id: string): {x: number; y: number} {
        const it = this.doc.items.find((i) => i.id === id);
        if (it !== undefined) {
            const c = this.proj.center(it.tile);
            return {x: c.x, y: c.y - (this.iconType(it).height ?? 70) * this.proj.tileW / IsoIcons.W - this.proj.tileH};
        }
        const c = this.doc.connectors.find((x) => x.id === id);
        if (c !== undefined) {
            const r = this.route(c);
            const p = r !== null ? IsoRoute.at(r.line, c.labelAt ?? 0.5) : {u: 0, v: 0};
            return this.proj.toWorld(p.u, p.v);
        }
        const g = this.doc.regions.find((x) => x.id === id);
        if (g !== undefined) {
            const r = IsoProjection.rect(g.from, g.to);
            return this.proj.toWorld(r.x0 + 1, r.y1 + 0.6);
        }
        const t = this.doc.texts.find((x) => x.id === id);

        return t !== undefined ? this.proj.toWorld(t.tile.x + 1, t.tile.y + 0.5) : {x: 0, y: 0};
    }

    // ---- rendering --------------------------------------------------------------------------------------------

    private render(): void {
        this.regionG.replaceChildren(...this.doc.regions.map((r) => this.regionEl(r)));
        this.textG.replaceChildren(...this.doc.texts.map((t) => this.textEl(t)));
        const conns = this.doc.connectors.map((c) => this.connectorEl(c)).filter((x): x is NonNullable<typeof x> => x !== null);
        this.connG.replaceChildren(...conns.map((c) => c.g));
        this.connLabelLayer.replaceChildren(...conns.map((c) => c.label).filter((l): l is HTMLDivElement => l !== null));

        const items = [...this.doc.items].sort((a, b) => IsoProjection.depth(a.tile) - IsoProjection.depth(b.tile));
        this.baseG.replaceChildren(...items.map((it) => this.baseEl(it)).filter((e): e is SVGRectElement => e !== null));
        this.itemLayer.replaceChildren(...items.map((it) => this.itemEl(it)));
        this.labelLayer.replaceChildren(...items.map((it) => this.calloutEl(it)).filter((e): e is HTMLDivElement => e !== null));
        this.wallLayer.replaceChildren(...this.doc.regions.flatMap((r) => this.wallEls(r)));
        this.statusG.replaceChildren();
        for (const id of this.itemStatus.keys()) {
            this.applyItemStatus(id);
        }
        for (const id of this.connStatus.keys()) {
            this.applyConnectorStatus(id);
        }
        this.applyClasses();
        this.renderHandles();
    }

    /** Back walls of a region, one SVG per tile piece so each gets its own depth. */
    private wallEls(r: IsoRegion): SVGSVGElement[] {
        if (r.wall === undefined || r.wall <= 0) {
            return [];
        }
        const h = r.wall * this.proj.tileH;
        const base = r.color ?? '#8b7cf6';
        const fill = {left: Color.lerp(base, '#eef1f6', 0.78), right: Color.lerp(base, '#b4bccb', 0.74)};
        const cap = Color.lerp(base, '#ffffff', 0.85);
        const t = 0.07;

        return IsoProjection.walls(r.from, r.to, r.doors).map((w) => {
            const pt = (u: number, v: number, z: number): string => {
                const p = this.proj.toWorld(u, v, z);
                return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            };
            // the wall stands just outside the edge; its top is a thin cap
            const du = w.face === 'right' ? -t : 0, dv = w.face === 'left' ? -t : 0;
            const svg = document.createElementNS(IsoEditor.SVG, 'svg');
            svg.setAttribute('class', 'iso-wall');
            const face = document.createElementNS(IsoEditor.SVG, 'polygon');
            face.setAttribute('points', [pt(w.u0, w.v0, 0), pt(w.u1, w.v1, 0), pt(w.u1, w.v1, h), pt(w.u0, w.v0, h)].join(' '));
            face.setAttribute('fill', fill[w.face]);
            const top = document.createElementNS(IsoEditor.SVG, 'polygon');
            top.setAttribute('points', [pt(w.u0, w.v0, h), pt(w.u1, w.v1, h), pt(w.u1 + du, w.v1 + dv, h), pt(w.u0 + du, w.v0 + dv, h)].join(' '));
            top.setAttribute('fill', cap);
            svg.append(face, top);
            svg.style.zIndex = String(IsoProjection.zOf((w.u0 + w.u1) / 2, (w.v0 + w.v1) / 2));
            return svg;
        });
    }

    private applyItemStatus(id: string): void {
        const st = this.itemStatus.get(id);
        const it = this.doc.items.find((i) => i.id === id);

        this.statusG.querySelector(`[data-status="${CSS.escape(id)}"]`)?.remove();
        const label = this.labelLayer.querySelector<HTMLElement>(`.iso-label[data-item="${CSS.escape(id)}"]`);
        label?.querySelector('.iso-st')?.remove();
        label?.querySelector('.iso-progress')?.remove();
        if (st === undefined || it === undefined) {
            return;
        }
        const ring = document.createElementNS(IsoEditor.SVG, 'rect');
        ring.setAttribute('class', `iso-status-ring iso-st-${st.state}`);
        ring.setAttribute('x', String(it.tile.x + 0.02));
        ring.setAttribute('y', String(it.tile.y + 0.02));
        ring.setAttribute('width', '0.96');
        ring.setAttribute('height', '0.96');
        ring.setAttribute('rx', '0.22');
        ring.dataset.status = id;
        this.statusG.appendChild(ring);
        if (label === null) {
            return;
        }
        const line = document.createElement('span');
        line.className = `iso-st iso-st-${st.state}`;
        line.textContent = st.message ?? st.state;
        label.appendChild(line);
        if (st.progress !== undefined) {
            const bar = document.createElement('i');
            bar.className = `iso-progress iso-st-${st.state}`;
            const fillEl = document.createElement('b');
            fillEl.style.width = `${Math.round(Math.max(0, Math.min(1, st.progress)) * 100)}%`;
            bar.appendChild(fillEl);
            label.appendChild(bar);
        }
    }

    private applyConnectorStatus(id: string): void {
        const st = this.connStatus.get(id);
        const c = this.doc.connectors.find((x) => x.id === id);
        const g = this.connG.querySelector<SVGGElement>(`.iso-conn[data-connector="${CSS.escape(id)}"]`);

        if (g === null || c === undefined) {
            return;
        }
        g.classList.toggle('iso-conn-off', st?.active === false);
        const color = st?.color ?? c.color ?? 'var(--iso-line)';
        g.querySelector<SVGPathElement>('.iso-conn-line')!.style.stroke = color;
        for (const tri of g.querySelectorAll<SVGPolygonElement>('polygon')) {
            tri.style.fill = color;
        }
    }

    private regionEl(r: IsoRegion): SVGGElement {
        const {x0, y0, x1, y1} = IsoProjection.rect(r.from, r.to);
        const color = r.color ?? '#8b7cf6';
        const g = document.createElementNS(IsoEditor.SVG, 'g');
        const rect = document.createElementNS(IsoEditor.SVG, 'rect');

        rect.setAttribute('class', 'iso-region');
        rect.setAttribute('x', String(x0 + 0.05));
        rect.setAttribute('y', String(y0 + 0.05));
        rect.setAttribute('width', String(x1 - x0 + 0.9));
        rect.setAttribute('height', String(y1 - y0 + 0.9));
        rect.setAttribute('rx', '0.35');
        rect.setAttribute('fill', Color.withAlpha(color, 0.22));
        rect.setAttribute('stroke', Color.withAlpha(color, 0.8));
        rect.dataset.region = r.id;
        g.appendChild(rect);
        if (r.label !== undefined && r.label !== '') {
            // along the front edge (nearest the viewer), so nested regions never print over each other
            const label = this.floorText({id: `${r.id}:label`, tile: {x: x0, y: y1}, text: r.label, size: 0.32, bold: true,
                color: Color.lerp(color, '#ffffff', 0.15)}, 0.3, 0.62);
            label.dataset.region = r.id;
            g.appendChild(label);
        }

        return g;
    }

    private textEl(t: IsoText): SVGGElement {
        const g = this.floorText(t, 0.1, 0.5);

        g.dataset.text = t.id;
        g.classList.add('iso-text');

        return g;
    }

    /** Text lying on the floor: drawn at 100× size and scaled down, so tiny font sizes never hit browser minimums. */
    private floorText(t: IsoText, du: number, dv: number): SVGGElement {
        const g = document.createElementNS(IsoEditor.SVG, 'g');
        const size = t.size ?? 0.4;
        // along y the text reads towards the upper right (−v), its top towards the upper left — never mirrored
        const rot = t.axis === 'y' ? ' rotate(-90)' : '';
        const x = t.axis === 'y' ? t.tile.x + dv : t.tile.x + du;
        const y = t.axis === 'y' ? t.tile.y + 1 - du : t.tile.y + dv;
        const text = document.createElementNS(IsoEditor.SVG, 'text');

        g.setAttribute('transform', `translate(${x} ${y})${rot} scale(0.01)`);
        text.setAttribute('class', 'iso-floortext');
        text.setAttribute('font-size', String(size * 100));
        text.setAttribute('dominant-baseline', 'middle');
        if (t.bold === true) {
            text.setAttribute('font-weight', '600');
        }
        if (t.color !== undefined) {
            text.style.fill = t.color;
        }
        text.textContent = t.text;
        g.appendChild(text);

        return g;
    }

    private baseEl(it: IsoItem): SVGRectElement | null {
        if (it.base === '') {
            return null;
        }
        const rect = document.createElementNS(IsoEditor.SVG, 'rect');

        rect.setAttribute('class', 'iso-base');
        rect.setAttribute('x', String(it.tile.x + 0.08));
        rect.setAttribute('y', String(it.tile.y + 0.08));
        rect.setAttribute('width', '0.84');
        rect.setAttribute('height', '0.84');
        rect.setAttribute('rx', '0.16');
        if (it.base !== undefined) {
            rect.style.fill = Color.withAlpha(it.base, 0.45);
            rect.style.stroke = it.base;
        }
        rect.dataset.item = it.id;

        return rect;
    }

    private iconType(it: IsoItem): IsoIconType {
        return this.icons.get(it.icon) ?? this.icons.get('box')!;
    }

    private itemEl(it: IsoItem): HTMLDivElement {
        const k = this.proj.tileW / IsoIcons.W * (it.scale ?? 1);
        const c = this.proj.center(it.tile);
        const el = document.createElement('div');
        const type = this.iconType(it);

        el.className = 'iso-item';
        el.dataset.item = it.id;
        el.style.left = `${c.x - IsoIcons.CX * k}px`;
        el.style.top = `${c.y - IsoIcons.CY * k}px`;
        el.style.width = `${IsoIcons.W * k}px`;
        el.style.height = `${IsoIcons.H * k}px`;
        el.style.zIndex = String(IsoProjection.zOf(it.tile.x + 0.5, it.tile.y + 0.5));
        if (it.flip === true) {
            el.style.transform = 'scaleX(-1)';
        }
        el.innerHTML = IsoIcons.svg(type, it.color);
        el.title = it.label ?? type.label ?? it.icon;

        return el;
    }

    private calloutEl(it: IsoItem): HTMLDivElement | null {
        if (it.label === undefined || it.label === '') {
            return null;
        }
        const k = this.proj.tileW / IsoIcons.W * (it.scale ?? 1);
        const c = this.proj.center(it.tile);
        const iconTop = (this.iconType(it).height ?? 70) * k;
        const rise = (it.labelHeight ?? 1) * this.proj.tileH;
        const el = document.createElement('div');
        const leader = document.createElement('div');
        const label = document.createElement('div');

        el.className = 'iso-callout';
        el.dataset.item = it.id;
        el.style.left = `${c.x}px`;
        el.style.top = `${c.y - iconTop}px`;
        el.style.zIndex = String(IsoProjection.zOf(it.tile.x + 0.5, it.tile.y + 0.5));
        leader.className = 'iso-leader';
        leader.style.top = `${-rise}px`;
        leader.style.height = `${Math.max(0, rise - 4)}px`;
        label.className = 'iso-label';
        label.dataset.item = it.id;
        label.style.bottom = `${rise}px`;
        label.textContent = it.label;
        if (it.description !== undefined && it.description !== '') {
            const small = document.createElement('small');
            small.textContent = it.description;
            label.appendChild(small);
        }
        el.append(leader, label);

        return el;
    }

    private anchorTile(a: IsoAnchor): IsoTile | null {
        if ('item' in a) {
            return this.doc.items.find((i) => i.id === a.item)?.tile ?? null;
        }

        return a.tile;
    }

    private blocked(): Set<string> {
        return new Set(this.doc.items.map((i) => IsoRoute.key(i.tile)));
    }

    /** Route of a connector: every other item's tile is avoided. Null when an end is missing. */
    private route(c: IsoConnector): {tiles: IsoTile[]; corners: IsoTile[]; line: number[]} | null {
        const a = this.anchorTile(c.from), b = this.anchorTile(c.to);

        if (a === null || b === null) {
            return null;
        }
        const tiles = IsoRoute.route(a, b, c.via ?? [], {blocked: this.blocked()});
        const corners = IsoRoute.corners(tiles);

        return {tiles, corners, line: IsoRoute.centres(corners)};
    }

    private static cloneAnchor(a: IsoAnchor): IsoAnchor {
        return 'item' in a ? {item: a.item} : {tile: {x: a.tile.x, y: a.tile.y}};
    }

    private static endGap(a: IsoAnchor): number {
        return 'item' in a ? 0.62 : 0.12;
    }

    private connectorEl(c: IsoConnector): {g: SVGGElement; label: HTMLDivElement | null} | null {
        const r = this.route(c);

        if (r === null || r.line.length < 4) {
            return null;
        }
        const {line} = r;
        const d = IsoRoute.pathData(line);
        const color = c.color ?? 'var(--iso-line)';
        const width = c.width ?? 6;
        const g = document.createElementNS(IsoEditor.SVG, 'g');
        const path = (cls: string, w: number): SVGPathElement => {
            const el = document.createElementNS(IsoEditor.SVG, 'path');
            el.setAttribute('class', cls);
            el.setAttribute('d', d);
            el.style.strokeWidth = String(w);
            return el;
        };

        g.setAttribute('class', 'iso-conn');
        g.dataset.connector = c.id;
        g.appendChild(path('iso-conn-sel', width + 6));
        const main = path('iso-conn-line', width);
        main.style.stroke = color;
        if (c.style === 'dashed') {
            main.style.strokeDasharray = `${width * 2.4} ${width * 1.7}`;
            main.style.strokeLinecap = 'butt';
        } else if (c.style === 'dotted') {
            main.style.strokeDasharray = `0.1 ${width * 2}`;
        }
        g.appendChild(main);

        // arrowheads lie on the floor, just outside the end items' base tiles
        const total = IsoRoute.measure(line);
        const arrows = c.arrows ?? 'end';
        const heads: number[][] = [];
        if (arrows !== 'none' && total > 1) {
            heads.push(IsoRoute.arrow(IsoRoute.atDistance(line, total - IsoEditor.endGap(c.to)), 0.3, 0.26));
        }
        if (arrows === 'both' && total > 1) {
            const p = IsoRoute.atDistance(line, IsoEditor.endGap(c.from));
            heads.push(IsoRoute.arrow({u: p.u, v: p.v, du: -p.du, dv: -p.dv}, 0.3, 0.26));
        }
        for (const h of heads) {
            const tri = document.createElementNS(IsoEditor.SVG, 'polygon');
            tri.setAttribute('points', h.join(' '));
            tri.style.fill = color;
            g.appendChild(tri);
        }
        // a free end (on a tile, not an item) gets a small ring
        for (const [a, i] of [[c.from, 0], [c.to, line.length - 2]] as const) {
            if ('tile' in a) {
                const ring = document.createElementNS(IsoEditor.SVG, 'circle');
                ring.setAttribute('class', 'iso-conn-end');
                ring.setAttribute('cx', String(line[i]));
                ring.setAttribute('cy', String(line[i + 1]));
                ring.setAttribute('r', '0.12');
                ring.style.stroke = color;
                g.appendChild(ring);
            }
        }
        if (c.animated === true && !IsoEditor.reducedMotion()) {
            // dots on the floor travelling the route; three per connector, evenly spaced
            const dur = Math.max(0.8, total / 1.8);
            for (let k = 0; k < 3; k++) {
                const dot = document.createElementNS(IsoEditor.SVG, 'circle');
                dot.setAttribute('r', '0.1');
                dot.style.fill = '#ffffff';
                dot.style.opacity = '0.9';
                dot.style.pointerEvents = 'none';
                const anim = document.createElementNS(IsoEditor.SVG, 'animateMotion');
                anim.setAttribute('dur', `${dur}s`);
                anim.setAttribute('begin', `${-k * dur / 3}s`);
                anim.setAttribute('repeatCount', 'indefinite');
                anim.setAttribute('path', d);
                dot.appendChild(anim);
                g.appendChild(dot);
            }
        }
        const hit = path('iso-conn-hit', Math.max(16, width + 10));
        hit.dataset.connector = c.id;
        g.appendChild(hit);

        let label: HTMLDivElement | null = null;
        if (c.label !== undefined && c.label !== '') {
            const p = IsoRoute.at(line, c.labelAt ?? 0.5);
            const w = this.proj.toWorld(p.u, p.v);
            label = document.createElement('div');
            label.className = 'iso-conn-label';
            label.dataset.connector = c.id;
            label.style.left = `${w.x}px`;
            label.style.top = `${w.y}px`;
            label.textContent = c.label;
        }

        return {g, label};
    }

    private static reducedMotion(): boolean {
        return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /** Corner handles of one selected region; waypoint, midpoint and end handles of one selected connector. */
    private renderHandles(): void {
        const out: SVGElement[] = [];

        if (!this.readOnly && this.mode === 'select' && this.selected.size === 1) {
            const id = [...this.selected][0]!;
            const dot = (u: number, v: number, h: Handle, cls = ''): void => {
                const c = document.createElementNS(IsoEditor.SVG, 'circle');
                c.setAttribute('class', `iso-handle ${cls}`);
                c.setAttribute('cx', String(u));
                c.setAttribute('cy', String(v));
                c.setAttribute('r', cls === 'iso-handle-mid' ? '0.15' : '0.2');
                c.dataset.handle = `${h.kind}|${h.owner}|${h.index}`;
                out.push(c);
            };
            const region = this.doc.regions.find((r) => r.id === id);
            if (region !== undefined) {
                const {x0, y0, x1, y1} = IsoProjection.rect(region.from, region.to);
                [[x0, y0], [x1 + 1, y0], [x1 + 1, y1 + 1], [x0, y1 + 1]].forEach(([u, v], i) => dot(u!, v!, {kind: 'corner', owner: id, index: i}));
            }
            const conn = this.doc.connectors.find((c) => c.id === id);
            const r = conn !== undefined ? this.route(conn) : null;
            if (conn !== undefined && r !== null) {
                for (let k = 0; k + 3 < r.line.length; k += 2) {
                    const len = Math.hypot(r.line[k + 2]! - r.line[k]!, r.line[k + 3]! - r.line[k + 1]!);
                    if (len >= 3) {
                        dot((r.line[k]! + r.line[k + 2]!) / 2, (r.line[k + 1]! + r.line[k + 3]!) / 2, {kind: 'mid', owner: id, index: k / 2}, 'iso-handle-mid');
                    }
                }
                (conn.via ?? []).forEach((t, i) => dot(t.x + 0.5, t.y + 0.5, {kind: 'via', owner: id, index: i}));
                const total = IsoRoute.measure(r.line);
                const a = IsoRoute.atDistance(r.line, IsoEditor.endGap(conn.from));
                const b = IsoRoute.atDistance(r.line, total - IsoEditor.endGap(conn.to));
                dot(a.u, a.v, {kind: 'end', owner: id, index: 0}, 'iso-handle-end');
                dot(b.u, b.v, {kind: 'end', owner: id, index: 1}, 'iso-handle-end');
            }
        }
        this.handleG.replaceChildren(...out);
    }

    private drawCursor(tile: IsoTile | null): void {
        this.draftG.querySelector('.iso-cursor')?.remove();
        if (tile === null) {
            return;
        }
        const rect = document.createElementNS(IsoEditor.SVG, 'rect');
        rect.setAttribute('class', 'iso-cursor');
        rect.setAttribute('x', String(tile.x + 0.04));
        rect.setAttribute('y', String(tile.y + 0.04));
        rect.setAttribute('width', '0.92');
        rect.setAttribute('height', '0.92');
        rect.setAttribute('rx', '0.14');
        this.draftG.appendChild(rect);
    }

    /** Draft of a connector being drawn or a region being dragged out. */
    private drawDraft(): void {
        for (const el of [...this.draftG.querySelectorAll('.iso-draft')]) {
            el.remove();
        }
        const g = this.gesture;
        const fromPending = this.pending !== null && this.mode === 'connect' ? this.pending : null;

        if (g?.kind === 'region') {
            const {x0, y0, x1, y1} = IsoProjection.rect(g.start, g.end);
            const rect = document.createElementNS(IsoEditor.SVG, 'rect');
            rect.setAttribute('class', 'iso-draft iso-draft-region');
            rect.setAttribute('x', String(x0 + 0.05));
            rect.setAttribute('y', String(y0 + 0.05));
            rect.setAttribute('width', String(x1 - x0 + 0.9));
            rect.setAttribute('height', String(y1 - y0 + 0.9));
            rect.setAttribute('rx', '0.35');
            this.draftG.appendChild(rect);
            return;
        }
        const from = g?.kind === 'connect' ? g.from : fromPending;
        const toTile = g?.kind === 'connect' ? (g.to !== null ? this.anchorTile(g.to) : null) : this.pointerTile();
        const a = from !== null ? this.anchorTile(from) : null;
        if (a !== null && toTile !== null) {
            const blocked = this.blocked();
            const line = IsoRoute.centres(IsoRoute.corners(IsoRoute.route(a, toTile, [], {blocked})));
            const path = document.createElementNS(IsoEditor.SVG, 'path');
            path.setAttribute('class', 'iso-draft iso-draft-line');
            path.setAttribute('d', IsoRoute.pathData(line.length >= 4 ? line : [...line, ...line]));
            this.draftG.appendChild(path);
        }
    }

    private applyModeClass(): void {
        this.root.classList.toggle('iso-edit', !this.readOnly);
        this.root.dataset.isoMode = this.readOnly ? 'view' : this.mode;
    }

    private applyClasses(): void {
        const dim = (id: string): boolean => this.highlighted !== null && !this.highlighted.has(id);
        const ends = new Map(this.doc.connectors.map((c) => [c.id, [c.from, c.to]]));
        // a connector stays lit when it is highlighted itself or both of its items are
        const dimConn = (id: string): boolean => {
            if (this.highlighted === null || this.highlighted.has(id)) {
                return false;
            }
            const e = ends.get(id);
            return e === undefined || !e.every((a) => 'item' in a && this.highlighted!.has(a.item));
        };

        for (const el of this.root.querySelectorAll<HTMLElement | SVGElement>('.iso-conn, .iso-conn-label')) {
            const id = el.dataset.connector!;
            el.classList.toggle('iso-selected', this.selected.has(id));
            el.classList.toggle('iso-hover', this.hoverId === id);
            el.classList.toggle('iso-dim', dimConn(id));
        }
        for (const el of this.root.querySelectorAll<SVGElement>('.iso-region')) {
            el.classList.toggle('iso-selected', this.selected.has(el.dataset.region!));
        }
        for (const el of this.root.querySelectorAll<SVGElement>('.iso-text')) {
            el.classList.toggle('iso-selected', this.selected.has(el.dataset.text!));
        }
        for (const el of this.root.querySelectorAll<HTMLElement | SVGElement>('[data-item]')) {
            const id = el.dataset.item!;
            el.classList.toggle('iso-selected', this.selected.has(id) && !el.classList.contains('iso-callout'));
            el.classList.toggle('iso-hover', this.hoverId === id);
            if (!el.classList.contains('iso-label')) {
                el.classList.toggle('iso-dim', dim(id));
            }
        }
    }

    /** World box of everything drawn (icons, labels, regions, texts, routes). */
    private contentBounds(): IsoBounds {
        const k = this.proj.tileW / IsoIcons.W;
        let b: IsoBounds | null = null;

        for (const it of this.doc.items) {
            const c = this.proj.center(it.tile);
            const top = it.label !== undefined && it.label !== ''
                ? (this.iconType(it).height ?? 70) * k + (it.labelHeight ?? 1) * this.proj.tileH + 46
                : IsoIcons.CY * k;
            b = IsoProjection.union(b, {minX: c.x - 60 * k, maxX: c.x + 60 * k, minY: c.y - top, maxY: c.y + 30 * k});
        }
        for (const r of this.doc.regions) {
            const rb = this.proj.rectBounds(r.from, r.to);
            rb.minY -= (r.wall ?? 0) * this.proj.tileH;
            b = IsoProjection.union(b, rb);
        }
        for (const t of this.doc.texts) {
            b = IsoProjection.union(b, this.proj.rectBounds(t.tile, t.tile));
        }
        for (const c of this.doc.connectors) {
            for (const t of this.route(c)?.corners ?? []) {
                b = IsoProjection.union(b, this.proj.rectBounds(t, t));
            }
        }

        return b ?? {minX: -300, minY: -150, maxX: 300, maxY: 150};
    }

    // ---- camera -----------------------------------------------------------------------------------------------

    private flyTo(state: CameraState, animate: boolean): void {
        cancelAnimationFrame(this.raf);
        if (!animate) {
            this.camera.setState(state);
            this.applyCamera();
            return;
        }
        this.camera.flyTo(state, 380);
        const tick = (now: number): void => {
            const more = this.camera.step(now);
            this.applyCamera();
            if (more) {
                this.raf = requestAnimationFrame(tick);
            }
        };
        this.raf = requestAnimationFrame(tick);
    }

    private applyCamera(): void {
        const {scale, offsetX, offsetY} = this.camera;

        this.stage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        this.drawGrid();
        this.events.emit('viewportChange', {scale, offsetX, offsetY});
    }

    /** Grid lines over the visible tiles only (redrawn when the visible range changes). */
    private drawGrid(): void {
        if (!this.showGrid) {
            this.gridPath.setAttribute('d', '');
            return;
        }
        const view = this.camera.viewBounds(this.root.clientWidth, this.root.clientHeight);
        const t = this.proj.tilesIn({minX: view.minX, minY: view.minY, maxX: view.maxX, maxY: view.maxY});
        const key = `${t.x0},${t.x1},${t.y0},${t.y1}`;

        if (key === this.gridKey) {
            return;
        }
        this.gridKey = key;
        // far out: thin the grid to every n-th line
        const n = Math.max(1, Math.ceil(Math.max(t.x1 - t.x0, t.y1 - t.y0) / 160));
        const parts: string[] = [];
        for (let x = Math.floor(t.x0 / n) * n; x <= t.x1; x += n) {
            parts.push(`M${x} ${t.y0}V${t.y1}`);
        }
        for (let y = Math.floor(t.y0 / n) * n; y <= t.y1; y += n) {
            parts.push(`M${t.x0} ${y}H${t.x1}`);
        }
        this.gridPath.setAttribute('d', parts.join(''));
    }

    // ---- geometry helpers ---------------------------------------------------------------------------------

    private local(e: {clientX: number; clientY: number}): {x: number; y: number} {
        const r = this.root.getBoundingClientRect();

        return {x: e.clientX - r.left, y: e.clientY - r.top};
    }

    private inside(clientX: number, clientY: number): boolean {
        const r = this.root.getBoundingClientRect();

        return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    }

    private floorAt(x: number, y: number): {u: number; v: number} {
        const w = this.camera.toWorld(x, y);

        return this.proj.toFloor(w.x, w.y);
    }

    private tileAt(x: number, y: number): IsoTile {
        const f = this.floorAt(x, y);

        return {x: Math.floor(f.u), y: Math.floor(f.v)};
    }

    private tileAtClient(clientX: number, clientY: number): IsoTile {
        const p = this.local({clientX, clientY});

        return this.tileAt(p.x, p.y);
    }

    private pointerTile(): IsoTile | null {
        return this.pointer === null ? null : this.tileAt(this.pointer.x, this.pointer.y);
    }

    private static targetId(target: EventTarget | null, attr: 'item' | 'region' | 'connector' | 'text' | 'handle'): string | null {
        const el = target instanceof Element ? target.closest(`[data-${attr}]`) : null;

        return el instanceof HTMLElement || el instanceof SVGElement ? el.dataset[attr] ?? null : null;
    }

    /** What is under a client point (works while the pointer is captured). */
    private hitAt(clientX: number, clientY: number): Element | null {
        return document.elementFromPoint(clientX, clientY);
    }

    /** Item or tile under a client point, as a connector end. */
    private anchorAt(clientX: number, clientY: number, target?: EventTarget | null): IsoAnchor {
        const id = IsoEditor.targetId(target ?? this.hitAt(clientX, clientY), 'item');

        return id !== null ? {item: id} : {tile: this.tileAtClient(clientX, clientY)};
    }

    // ---- input -------------------------------------------------------------------------------------------------

    private cancelGesture(): void {
        this.gesture = null;
        this.press = null;
        this.band.hidden = true;
        this.drawDraft();
        this.root.classList.remove('iso-panning');
    }

    private closeEditor(commit: boolean): void {
        this.editor?.done(commit);
    }

    private readonly onDown = (e: PointerEvent): void => {
        if (e.target instanceof Element && e.target.closest('.iso-input') !== null) {
            return;
        }
        if (e.button !== 0 && e.button !== 1) {
            return;
        }
        this.root.focus({preventScroll: true});
        const p = this.local(e);
        this.press = {x: p.x, y: p.y, target: e.target, moved: false, id: e.pointerId, button: e.button, shift: e.shiftKey};
    };

    /** The gesture a press turns into once it moves. */
    private startGesture(press: NonNullable<IsoEditor['press']>): Gesture {
        const editable = !this.readOnly;
        const t = press.target;

        if (!editable || press.button === 1 || this.mode === 'pan') {
            return {kind: 'pan'};
        }
        if (this.mode === 'connect') {
            const fromItem = IsoEditor.targetId(t, 'item');
            return {kind: 'connect', from: fromItem !== null ? {item: fromItem} : {tile: this.tileAt(press.x, press.y)}, to: null};
        }
        if (this.mode === 'region') {
            const s = this.tileAt(press.x, press.y);
            return {kind: 'region', start: s, end: s};
        }
        const handle = IsoEditor.targetId(t, 'handle');
        if (handle !== null) {
            const [kind, owner, index] = handle.split('|');
            return {kind: 'handle', handle: {kind: kind as Handle['kind'], owner: owner!, index: Number(index)}, orig: this.snapshot(), via: -1};
        }
        // a region is large: dragging on it pans unless it is already selected
        const regionId = IsoEditor.targetId(t, 'region');
        const hitId = IsoEditor.targetId(t, 'item') ?? IsoEditor.targetId(t, 'text')
            ?? (regionId !== null && this.selected.has(regionId) ? regionId : null);
        if (hitId !== null) {
            if (!this.selected.has(hitId)) {
                this.select(press.shift ? [...this.selected, hitId] : [hitId]);
            }
            const ids = new Set([...this.selected].filter((id) => IsoModel.kindOf(this.doc, id) !== 'connector'));
            return {kind: 'move', ids, start: this.tileAt(press.x, press.y), dx: 0, dy: 0, orig: this.snapshot()};
        }
        if (press.shift) {
            return {kind: 'band', x0: press.x, y0: press.y, x1: press.x, y1: press.y, additive: true};
        }

        return {kind: 'pan'};
    }

    private snapshot(): Doc {
        return JSON.parse(JSON.stringify(this.doc)) as Doc;
    }

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);
        const press = this.press;
        this.pointer = p;

        if (press !== null) {
            if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) > 3) {
                press.moved = true;
                this.root.setPointerCapture(press.id);
                cancelAnimationFrame(this.raf);
                this.camera.cancelFlight();
                this.gesture = this.startGesture(press);
                if (this.gesture.kind === 'pan') {
                    this.root.classList.add('iso-panning');
                }
            }
            if (press.moved && this.gesture !== null) {
                this.dragGesture(this.gesture, p, e);
                press.x = p.x;
                press.y = p.y;
                return;
            }
        }
        this.updateHover(e.target);
        if (!this.readOnly && (this.mode === 'connect' || this.mode === 'region' || this.mode === 'text')) {
            this.drawCursor(this.tileAt(p.x, p.y));
            if (this.pending !== null) {
                this.drawDraft();
            }
        }
    };

    private dragGesture(g: Gesture, p: {x: number; y: number}, e: PointerEvent): void {
        const press = this.press!;

        switch (g.kind) {
            case 'pan':
                this.camera.panBy(p.x - press.x, p.y - press.y);
                this.userMoved = true;
                this.applyCamera();
                return;
            case 'band': {
                g.x1 = p.x;
                g.y1 = p.y;
                this.band.hidden = false;
                Object.assign(this.band.style, {
                    left: `${Math.min(g.x0, g.x1)}px`, top: `${Math.min(g.y0, g.y1)}px`,
                    width: `${Math.abs(g.x1 - g.x0)}px`, height: `${Math.abs(g.y1 - g.y0)}px`
                });
                return;
            }
            case 'move': {
                const t = this.tileAt(p.x, p.y);
                const dx = t.x - g.start.x, dy = t.y - g.start.y;
                if (dx === g.dx && dy === g.dy) {
                    return;
                }
                const trial = JSON.parse(JSON.stringify(g.orig)) as Doc;
                // keep the last valid place while the target is taken
                if (!IsoModel.canMove(trial, g.ids, dx, dy)) {
                    return;
                }
                IsoModel.move(trial, g.ids, dx, dy);
                g.dx = dx;
                g.dy = dy;
                this.doc = trial;
                this.render();
                return;
            }
            case 'region':
                g.end = this.tileAt(p.x, p.y);
                this.drawDraft();
                return;
            case 'connect': {
                const a = this.anchorAt(e.clientX, e.clientY);
                g.to = a;
                this.drawDraft();
                this.drawCursor(this.anchorTile(a));
                return;
            }
            case 'handle':
                this.dragHandle(g, p, e);
                return;
        }
    }

    private dragHandle(g: Extract<Gesture, {kind: 'handle'}>, p: {x: number; y: number}, e: PointerEvent): void {
        const trial = JSON.parse(JSON.stringify(g.orig)) as Doc;
        const h = g.handle;

        if (h.kind === 'corner') {
            const r = trial.regions.find((x) => x.id === h.owner);
            if (r === undefined) {
                return;
            }
            const f = this.floorAt(p.x, p.y);
            const gx = Math.round(f.u), gy = Math.round(f.v);
            const tile = [{x: gx, y: gy}, {x: gx - 1, y: gy}, {x: gx - 1, y: gy - 1}, {x: gx, y: gy - 1}][h.index]!;
            IsoModel.resizeRegion(r, h.index, tile);
        } else {
            const c = trial.connectors.find((x) => x.id === h.owner);
            if (c === undefined) {
                return;
            }
            if (h.kind === 'end') {
                const a = this.anchorAt(e.clientX, e.clientY);
                if (h.index === 0) {
                    c.from = a;
                } else {
                    c.to = a;
                }
            } else {
                const t = this.tileAt(p.x, p.y);
                const via = c.via ?? [];
                if (h.kind === 'mid' && g.via < 0) {
                    g.via = this.insertIndex(g.orig, c, h.index);
                }
                const index = h.kind === 'via' ? h.index : g.via;
                if (h.kind === 'mid') {
                    via.splice(index, 0, t);
                } else {
                    via[index] = t;
                }
                c.via = via;
            }
        }
        this.doc = trial;
        this.render();
        this.drawCursor(h.kind === 'corner' ? null : this.tileAt(p.x, p.y));
    }

    /** Where a new waypoint for segment `seg` of the drawn route goes in `via`. */
    private insertIndex(doc: Doc, c: IsoConnector, seg: number): number {
        const saved = this.doc;
        this.doc = doc;
        const r = this.route(c);
        this.doc = saved;
        if (r === null) {
            return 0;
        }
        const pos = (t: IsoTile, from = 0): number => r.tiles.findIndex((x, i) => i >= from && x.x === t.x && x.y === t.y);
        const a = r.corners[seg]!, b = r.corners[seg + 1]!;
        const mid = pos({x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2)});
        let count = 0, from = 0;
        for (const v of c.via ?? []) {
            const at = pos(v, from);
            if (at >= 0 && at < mid) {
                count++;
                from = at;
            }
        }

        return count;
    }

    private readonly onUp = (e: PointerEvent): void => {
        const press = this.press;
        const g = this.gesture;
        this.press = null;
        this.gesture = null;
        this.root.classList.remove('iso-panning');
        if (this.root.hasPointerCapture(e.pointerId)) {
            this.root.releasePointerCapture(e.pointerId);
        }
        if (press === null || e.type === 'pointercancel') {
            this.cancelGesture();
            return;
        }
        if (press.moved && g !== null) {
            this.finishGesture(g);
            return;
        }
        this.click(press, e);
    };

    private finishGesture(g: Gesture): void {
        switch (g.kind) {
            case 'band': {
                this.band.hidden = true;
                const x0 = Math.min(g.x0, g.x1), x1 = Math.max(g.x0, g.x1), y0 = Math.min(g.y0, g.y1), y1 = Math.max(g.y0, g.y1);
                const inBox = (wx: number, wy: number): boolean => {
                    const s = this.camera.toScreen(wx, wy);
                    return s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1;
                };
                const ids = new Set(g.additive ? this.selected : []);
                for (const it of this.doc.items) {
                    const c = this.proj.center(it.tile);
                    if (inBox(c.x, c.y)) {
                        ids.add(it.id);
                    }
                }
                for (const r of this.doc.regions) {
                    const b = this.proj.rectBounds(r.from, r.to);
                    if (inBox(b.minX, b.minY) && inBox(b.maxX, b.maxY)) {
                        ids.add(r.id);
                    }
                }
                for (const t of this.doc.texts) {
                    const c = this.proj.center(t.tile);
                    if (inBox(c.x, c.y)) {
                        ids.add(t.id);
                    }
                }
                for (const c of this.doc.connectors) {
                    if ([c.from, c.to].every((a) => 'item' in a && ids.has(a.item))) {
                        ids.add(c.id);
                    }
                }
                this.select([...ids]);
                return;
            }
            case 'move':
                if (g.dx !== 0 || g.dy !== 0) {
                    this.commit('move', [...g.ids]);
                }
                return;
            case 'region': {
                this.drawDraft();
                const id = this.addRegion(g.start, g.end);
                this.select([id]);
                return;
            }
            case 'connect': {
                this.drawDraft();
                this.drawCursor(null);
                if (g.to !== null && !IsoEditor.sameAnchor(g.from, g.to)) {
                    const id = this.addConnector(g.from, g.to);
                    this.select([id]);
                }
                return;
            }
            case 'handle': {
                this.drawCursor(null);
                const kind = g.handle.kind === 'corner' ? 'resize' : 'reroute';
                if (JSON.stringify(g.orig) !== JSON.stringify(this.doc)) {
                    this.commit(kind, [g.handle.owner]);
                }
                return;
            }
            default:
                return;
        }
    }

    private static sameAnchor(a: IsoAnchor, b: IsoAnchor): boolean {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    private click(press: NonNullable<IsoEditor['press']>, e: PointerEvent): void {
        const t = press.target;

        if (!this.readOnly && this.mode === 'connect') {
            const a = this.anchorAt(e.clientX, e.clientY, t);
            if (this.pending === null) {
                this.pending = a;
            } else {
                const from = this.pending;
                this.pending = null;
                this.drawDraft();
                if (!IsoEditor.sameAnchor(from, a)) {
                    this.select([this.addConnector(from, a)]);
                }
            }
            this.drawDraft();
            return;
        }
        if (!this.readOnly && this.mode === 'text') {
            const id = this.addText(this.tileAt(press.x, press.y), 'Text');
            this.select([id]);
            this.editLabel(id);
            return;
        }
        if (!this.readOnly && this.mode === 'region') {
            return;
        }

        const pick = (id: string): void => {
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                if (this.selected.has(id)) {
                    this.selected.delete(id);
                } else {
                    this.selected.add(id);
                }
                this.select([...this.selected]);
            } else {
                this.select([id]);
            }
        };
        const itemId = IsoEditor.targetId(t, 'item');
        const item = itemId !== null ? this.doc.items.find((i) => i.id === itemId) : undefined;
        if (item !== undefined) {
            pick(item.id);
            this.events.emit('itemClick', {item, originalEvent: e});
            return;
        }
        const connId = IsoEditor.targetId(t, 'connector');
        const connector = connId !== null ? this.doc.connectors.find((c) => c.id === connId) : undefined;
        if (connector !== undefined) {
            pick(connector.id);
            this.events.emit('connectorClick', {connector, originalEvent: e});
            return;
        }
        const textId = IsoEditor.targetId(t, 'text');
        if (textId !== null) {
            pick(textId);
            return;
        }
        const regionId = IsoEditor.targetId(t, 'region');
        const region = regionId !== null ? this.doc.regions.find((r) => r.id === regionId) : undefined;
        if (region !== undefined) {
            // regions are selectable while editing; in the viewer a click passes through to the floor
            if (!this.readOnly) {
                pick(region.id);
            }
            this.events.emit('regionClick', {region, originalEvent: e});
            if (!this.readOnly) {
                return;
            }
        }
        if (this.selected.size > 0 && !(e.shiftKey || e.ctrlKey || e.metaKey)) {
            this.select([]);
        }
        this.events.emit('floorClick', {tile: this.tileAt(press.x, press.y), originalEvent: e});
    }

    private updateHover(target: EventTarget | null): void {
        const itemId = IsoEditor.targetId(target, 'item');
        const connId = itemId === null ? IsoEditor.targetId(target, 'connector') : null;
        const id = itemId ?? connId;

        if (id === this.hoverId) {
            return;
        }
        const wasConn = this.hoverId !== null && this.doc.connectors.some((c) => c.id === this.hoverId);
        const wasItem = this.hoverId !== null && !wasConn;
        this.hoverId = id;
        this.applyClasses();
        if (itemId !== null || wasItem) {
            this.events.emit('itemHover', itemId === null ? null : this.doc.items.find((i) => i.id === itemId) ?? null);
        }
        if (connId !== null || wasConn) {
            this.events.emit('connectorHover', connId === null ? null : this.doc.connectors.find((c) => c.id === connId) ?? null);
        }
    }

    private readonly onLeave = (): void => {
        this.pointer = null;
        if (this.press === null) {
            this.drawCursor(null);
            if (this.hoverId !== null) {
                const wasConn = this.doc.connectors.some((c) => c.id === this.hoverId);
                this.hoverId = null;
                this.applyClasses();
                this.events.emit(wasConn ? 'connectorHover' : 'itemHover', null);
            }
        }
    };

    private readonly onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        const p = this.local(e);
        cancelAnimationFrame(this.raf);
        this.camera.cancelFlight();
        this.camera.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
        this.userMoved = true;
        this.applyCamera();
    };

    private readonly onDblClick = (e: MouseEvent): void => {
        if (e.target instanceof Element && e.target.closest('.iso-input') !== null) {
            return;
        }
        if (!this.readOnly && this.mode !== 'select') {
            return;
        }
        const itemId = IsoEditor.targetId(e.target, 'item');
        const item = itemId !== null ? this.doc.items.find((i) => i.id === itemId) : undefined;

        if (item !== undefined) {
            this.events.emit('itemDblClick', {item, originalEvent: e});
            this.editLabel(item.id);
            return;
        }
        const other = IsoEditor.targetId(e.target, 'connector') ?? IsoEditor.targetId(e.target, 'text') ?? IsoEditor.targetId(e.target, 'region');
        if (other !== null && !this.readOnly) {
            this.editLabel(other);
            return;
        }
        if (IsoEditor.targetId(e.target, 'handle') !== null) {
            // double-click a waypoint removes it
            const [kind, owner, index] = IsoEditor.targetId(e.target, 'handle')!.split('|');
            const c = this.doc.connectors.find((x) => x.id === owner);
            if (kind === 'via' && c?.via !== undefined) {
                c.via.splice(Number(index), 1);
                this.commit('reroute', [c.id]);
            }
            return;
        }
        this.fit(true);
    };

    private readonly onKey = (e: KeyboardEvent): void => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
            return;
        }
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();

        if (e.key === 'Escape') {
            if (this.pending !== null || this.gesture !== null) {
                this.pending = null;
                this.cancelGesture();
            } else if (this.mode !== 'select') {
                this.setMode('select');
            } else {
                this.select([]);
            }
            return;
        }
        if (this.readOnly) {
            return;
        }
        if (mod && key === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
                this.redo();
            } else {
                this.undo();
            }
        } else if (mod && key === 'y') {
            e.preventDefault();
            this.redo();
        } else if (mod && key === 'a') {
            e.preventDefault();
            this.selectAll();
        } else if (mod && key === 'd') {
            e.preventDefault();
            this.duplicate();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            this.remove([...this.selected]);
        } else if (e.key === 'F2' && this.selected.size === 1) {
            this.editLabel([...this.selected][0]!);
        } else if (e.key.startsWith('Arrow') && this.selected.size > 0) {
            e.preventDefault();
            const [dx, dy] = {ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1]}[e.key] ?? [0, 0];
            const ids = new Set([...this.selected].filter((id) => IsoModel.kindOf(this.doc, id) !== 'connector'));
            if (IsoModel.canMove(this.doc, ids, dx!, dy!)) {
                IsoModel.move(this.doc, ids, dx!, dy!);
                this.commit('move', [...ids]);
            }
        } else if (!mod && !e.altKey) {
            const mode = ({v: 'select', c: 'connect', r: 'region', t: 'text', h: 'pan'} as Record<string, IsoMode>)[key];
            if (mode !== undefined) {
                this.setMode(mode);
            }
        }
    };

    private focused(): boolean {
        return document.activeElement === this.root && this.editor === null;
    }

    private readonly onCopy = (e: ClipboardEvent): void => {
        if (!this.focused() || this.selected.size === 0) {
            return;
        }
        this.clipboard = IsoModel.fragment(this.doc, this.selected);
        e.clipboardData?.setData('text/plain', JSON.stringify({[IsoEditor.CLIP_KEY]: this.clipboard}));
        e.preventDefault();
    };

    private readonly onCut = (e: ClipboardEvent): void => {
        if (!this.focused() || this.selected.size === 0 || this.readOnly) {
            return;
        }
        this.onCopy(e);
        this.remove([...this.selected]);
    };

    private readonly onPaste = (e: ClipboardEvent): void => {
        if (!this.focused() || this.readOnly) {
            return;
        }
        let f: IsoFragment | null = this.clipboard;
        const text = e.clipboardData?.getData('text/plain') ?? '';
        try {
            const parsed = JSON.parse(text) as Record<string, IsoFragment>;
            const ours = parsed[IsoEditor.CLIP_KEY];
            if (ours !== undefined) {
                f = ours;
            }
        } catch {
            // not ours: keep the internal clipboard
        }
        if (f !== null) {
            e.preventDefault();
            this.paste(f);
        }
    };

}
