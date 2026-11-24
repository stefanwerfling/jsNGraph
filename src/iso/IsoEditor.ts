import { EventEmitter } from '../util/EventEmitter';
import { Camera, CameraState } from '../view/Camera';
import { RectHistory } from '../rect/RectHistory';
import { IsoGestures } from './IsoGestures';
import { IsoDoc, IsoHost } from './IsoHost';
import { IsoIcons } from './IsoIcons';
import { IsoKeyboard } from './IsoKeyboard';
import { IsoLabelEditor } from './IsoLabelEditor';
import { IsoLive } from './IsoLive';
import { IsoFragment, IsoModel } from './IsoModel';
import { IsoOverlay } from './IsoOverlay';
import { IsoProjection } from './IsoProjection';
import { IsoScene } from './IsoScene';
import { IsoStyles, IsoStyleVar } from './IsoStyles';
import {
    IsoActor, IsoAnchor, IsoChangeKind, IsoConnector, IsoConnectorStatus, IsoDocument, IsoEditorEvents, IsoEditorOptions,
    IsoIconType, IsoItem, IsoItemStatus, IsoMode, IsoRegion, IsoText, IsoTile
} from './IsoTypes';

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
 *
 * This class is the façade: it owns the document, history, selection, mode,
 * camera and events; drawing (`IsoScene`, `IsoOverlay`, `IsoLive`) and input
 * (`IsoGestures`, `IsoKeyboard`, `IsoLabelEditor`) are internal parts that
 * reach back through an `IsoHost`.
 */
export class IsoEditor {

    private static readonly REGION_COLORS = ['#8b7cf6', '#2fb3a5', '#e0664f', '#f0a03c', '#5b8def', '#d062a8'];

    private readonly root: HTMLDivElement;
    private readonly events = new EventEmitter<IsoEditorEvents>();
    private readonly camera: Camera;
    private readonly proj: IsoProjection;
    private readonly icons = new Map<string, IsoIconType>();
    private readonly scene: IsoScene;
    private readonly overlay: IsoOverlay;
    private readonly live: IsoLive;
    private readonly gestures: IsoGestures;
    private readonly labels: IsoLabelEditor;
    private readonly keys: IsoKeyboard;
    private readonly resizeObserver: ResizeObserver;
    private readonly history: RectHistory<IsoDoc>;
    private doc: IsoDoc = {items: [], connectors: [], regions: [], texts: []};
    private readOnlyMode: boolean;
    private mode: IsoMode;
    private selected = new Set<string>();
    private highlighted: Set<string> | null = null;
    private userMoved = false;
    private raf = 0;

    public constructor(container: HTMLElement, options: IsoEditorOptions = {}) {
        IsoStyles.ensure();
        this.proj = new IsoProjection(options.tileSize ?? 100);
        this.camera = new Camera(options.minScale ?? 0.15, options.maxScale ?? 3);
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

        const host = this.createHost();
        this.scene = new IsoScene(host, options.grid ?? true);
        this.overlay = new IsoOverlay(host, this.scene);
        this.live = new IsoLive(host, this.scene);
        this.gestures = new IsoGestures(host, this.overlay);
        this.labels = new IsoLabelEditor(host);
        this.keys = new IsoKeyboard(host, this.gestures, this.labels);
        container.appendChild(this.root);
        this.applyModeClass();

        this.resizeObserver = new ResizeObserver(() => {
            if (!this.userMoved) {
                this.fit(false);
            } else {
                this.applyCamera();
            }
        });
        this.resizeObserver.observe(this.root);

        this.doc = IsoModel.normalize(options.document ?? {items: []});
        this.history = new RectHistory<IsoDoc>(this.doc, options.historySize ?? 100, (d) => JSON.parse(JSON.stringify(d)) as IsoDoc);
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

    /** A given id (must be unused by any element) or a new one with `prefix`. */
    private freshId(id: string | undefined, prefix: string): string {
        if (id === undefined || id === '') {
            return IsoModel.uid(this.doc, prefix);
        }
        if (IsoModel.kindOf(this.doc, id) !== null) {
            throw new Error(`Iso element id '${id}' already exists`);
        }

        return id;
    }

    /** Add an item; it lands on the nearest free tile. Returns its id; throws when `data.id` is taken. */
    public addItem(data: Omit<IsoItem, 'id'> & {id?: string}): string {
        const id = this.freshId(data.id, 'item');
        const it: IsoItem = {...JSON.parse(JSON.stringify(data)) as IsoItem, id, tile: IsoModel.freeTileNear(this.doc, data.tile)};

        this.doc.items.push(it);
        this.commit('add', [id]);

        return id;
    }

    public addConnector(from: IsoAnchor, to: IsoAnchor, data: Partial<Omit<IsoConnector, 'id' | 'from' | 'to'>> & {id?: string} = {}): string {
        const id = this.freshId(data.id, 'link');

        this.doc.connectors.push({
            ...JSON.parse(JSON.stringify(data)) as Partial<IsoConnector>, id,
            from: IsoEditor.cloneAnchor(from), to: IsoEditor.cloneAnchor(to)
        });
        this.commit('connect', [id]);

        return id;
    }

    public addRegion(from: IsoTile, to: IsoTile, data: Partial<Omit<IsoRegion, 'id' | 'from' | 'to'>> & {id?: string} = {}): string {
        const id = this.freshId(data.id, 'region');
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
        const id = this.freshId(data.id, 'text');

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
        const r = c !== undefined ? IsoScene.route(this.doc, c) : null;

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
        return this.keys.copy();
    }

    public cut(): void {
        if (this.copy() !== null) {
            this.remove([...this.selected]);
        }
    }

    /** Paste a fragment (default: the last copied) with its top-left at `at` (default: the tile under the pointer). */
    public paste(fragment?: IsoFragment, at?: IsoTile): string[] {
        const f = fragment ?? this.keys.stored;

        if (f === null || f === undefined) {
            return [];
        }
        const o = IsoModel.origin(f) ?? {x: 0, y: 0};
        const target = at ?? this.gestures.pointerTile() ?? {x: o.x + 1, y: o.y + 1};
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
        this.gestures.beginDrag(icon, event, data);
    }

    /** Place a new item at a client point (nearest free tile); label defaults to the icon's name. */
    public dropAt(icon: string, clientX: number, clientY: number, data: Partial<Omit<IsoItem, 'id' | 'tile' | 'icon'>> = {}): string {
        const type = this.icons.get(icon);
        const id = this.addItem({label: type?.label ?? icon, ...data, icon, tile: this.gestures.tileAtClient(clientX, clientY)});

        this.select([id]);
        this.root.focus({preventScroll: true});

        return id;
    }

    // ---- public API: live status, actors (display state, not document data) ------------------------------

    /** Show an item's live state: a ring on the floor, a status line and progress bar in its label. null clears. */
    public setItemStatus(id: string, status: IsoItemStatus | null): void {
        this.live.setItemStatus(id, status);
    }

    public setConnectorStatus(id: string, status: IsoConnectorStatus | null): void {
        this.live.setConnectorStatus(id, status);
    }

    public clearStatus(): void {
        this.live.clearStatus();
    }

    /**
     * Place the moving things: actors keep their element across calls (only
     * position, depth and look change), actors missing from the list go away.
     */
    public setActors(actors: IsoActor[]): void {
        this.live.setActors(actors);
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
        this.gestures.cancel();
        this.labels.close(false);
        this.applyModeClass();
        this.overlay.renderHandles();
    }

    public getMode(): IsoMode {
        return this.mode;
    }

    public setMode(mode: IsoMode): void {
        if (mode === this.mode) {
            return;
        }
        this.mode = mode;
        this.gestures.clearPending();
        this.gestures.cancel();
        this.applyModeClass();
        this.overlay.renderHandles();
        this.events.emit('modeChange', mode);
    }

    public setTheme(theme: 'dark' | 'light'): void {
        this.root.dataset.isoTheme = theme;
    }

    public setGrid(on: boolean): void {
        this.scene.setGrid(on);
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
        this.overlay.renderHandles();
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
        this.labels.open(id);
    }

    /** Frame the whole diagram. */
    public fit(animate = true): void {
        const b = this.scene.bounds();
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
        this.gestures.destroy();
        this.resizeObserver.disconnect();
        this.keys.destroy();
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

    private restore(state: IsoDoc | undefined, kind: 'undo' | 'redo'): boolean {
        if (state === undefined) {
            return false;
        }
        this.doc = JSON.parse(JSON.stringify(state)) as IsoDoc;
        this.pruneSelection();
        this.render();
        this.events.emit('change', {kind, ids: []});
        this.events.emit('selectionChange', [...this.selected]);

        return true;
    }

    private pruneSelection(): void {
        this.selected = new Set([...this.selected].filter((id) => IsoModel.kindOf(this.doc, id) !== null));
    }

    // ---- rendering ----------------------------------------------------------------------------------------------

    private render(): void {
        this.scene.render();
        this.live.reapply();
        this.applyClasses();
        this.overlay.renderHandles();
    }

    private applyClasses(): void {
        this.scene.applyClasses(this.selected, this.gestures.hoverId, this.highlighted);
    }

    private applyModeClass(): void {
        this.root.classList.toggle('iso-edit', !this.readOnly);
        this.root.dataset.isoMode = this.readOnly ? 'view' : this.mode;
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

        this.scene.stage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        this.scene.drawGrid();
        this.events.emit('viewportChange', {scale, offsetX, offsetY});
    }

    private static cloneAnchor(a: IsoAnchor): IsoAnchor {
        return 'item' in a ? {item: a.item} : {tile: {x: a.tile.x, y: a.tile.y}};
    }

    // ---- parts ------------------------------------------------------------------------------------------------

    /** The narrow view of this editor its internal parts work through. */
    private createHost(): IsoHost {
        return {
            root: this.root,
            camera: this.camera,
            proj: this.proj,
            events: this.events,
            doc: () => this.doc,
            setDoc: (doc) => {
                this.doc = doc;
            },
            selected: () => this.selected,
            mode: () => this.mode,
            readOnly: () => this.readOnly,
            iconType: (id) => this.icons.get(id) ?? this.icons.get('box')!,
            select: (ids) => this.select(ids),
            commit: (kind, ids) => this.commit(kind, ids),
            render: () => this.render(),
            applyClasses: () => this.applyClasses(),
            applyCamera: () => this.applyCamera(),
            markMoved: () => {
                this.userMoved = true;
            },
            stopFlight: () => {
                cancelAnimationFrame(this.raf);
                this.camera.cancelFlight();
            },
            setMode: (mode) => this.setMode(mode),
            fit: (animate) => this.fit(animate),
            editLabel: (id) => this.editLabel(id),
            addConnector: (from, to) => this.addConnector(from, to),
            addRegion: (from, to) => this.addRegion(from, to),
            addText: (tile, text) => this.addText(tile, text),
            dropAt: (icon, clientX, clientY, data) => this.dropAt(icon, clientX, clientY, data),
            updateText: (id, patch) => this.updateText(id, patch),
            remove: (ids) => this.remove(ids),
            undo: () => this.undo(),
            redo: () => this.redo(),
            selectAll: () => this.selectAll(),
            duplicate: () => this.duplicate(),
            paste: (fragment) => this.paste(fragment)
        };
    }

}
