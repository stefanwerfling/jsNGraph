import { EventEmitter } from '../util/EventEmitter';
import { Camera, CameraState } from '../view/Camera';
import { Color } from '../util/Color';
import { IsoIcons } from './IsoIcons';
import { IsoBounds, IsoProjection } from './IsoProjection';
import { IsoStyles } from './IsoStyles';
import {
    IsoDocument, IsoEditorEvents, IsoEditorOptions, IsoIconType, IsoItem, IsoRegion, IsoText
} from './IsoTypes';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Isometric architecture diagram: items (devices, services) with our own
 * 3D icons standing on a tile grid, labels floating above them, regions and
 * text on the floor. DOM + SVG on one stage moved by the shared camera; the
 * floor is a single SVG group under the isometric matrix, so everything on it
 * is drawn in tile units. Milestone I1: viewing (pan, zoom, hover, click,
 * select, highlight, focus); connectors and editing follow.
 */
export class IsoEditor {

    private readonly root: HTMLDivElement;
    private readonly stage: HTMLDivElement;
    private readonly floor: SVGSVGElement;
    private readonly floorG: SVGGElement;
    private readonly gridPath: SVGPathElement;
    private readonly regionG: SVGGElement;
    private readonly baseG: SVGGElement;
    private readonly textG: SVGGElement;
    private readonly itemLayer: HTMLDivElement;
    private readonly labelLayer: HTMLDivElement;
    private readonly events = new EventEmitter<IsoEditorEvents>();
    private readonly camera: Camera;
    private readonly proj: IsoProjection;
    private readonly icons = new Map<string, IsoIconType>();
    private readonly resizeObserver: ResizeObserver;
    private doc: IsoDocument = {items: []};
    private showGrid: boolean;
    private readOnly: boolean;
    private selected = new Set<string>();
    private highlighted: Set<string> | null = null;
    private hoverId: string | null = null;
    private userMoved = false;
    private press: {x: number; y: number; target: EventTarget | null; moved: boolean; id: number} | null = null;
    private raf = 0;
    private gridKey = '';

    public constructor(container: HTMLElement, options: IsoEditorOptions = {}) {
        IsoStyles.ensure();
        this.proj = new IsoProjection(options.tileSize ?? 100);
        this.camera = new Camera(options.minScale ?? 0.15, options.maxScale ?? 3);
        this.showGrid = options.grid ?? true;
        this.readOnly = options.readOnly ?? true;
        for (const t of IsoIcons.builtins()) {
            this.icons.set(t.id, t);
        }
        for (const t of options.icons ?? []) {
            this.icons.set(t.id, t);
        }

        this.root = document.createElement('div');
        this.root.className = 'iso-root';
        this.root.dataset.isoTheme = options.theme ?? 'dark';
        this.stage = document.createElement('div');
        this.stage.className = 'iso-stage';

        this.floor = document.createElementNS(SVG, 'svg');
        this.floor.setAttribute('class', 'iso-floor');
        this.floorG = document.createElementNS(SVG, 'g');
        this.floorG.setAttribute('transform', `matrix(${this.proj.floorMatrix().join(' ')})`);
        this.gridPath = document.createElementNS(SVG, 'path');
        this.gridPath.setAttribute('class', 'iso-grid');
        this.regionG = document.createElementNS(SVG, 'g');
        this.baseG = document.createElementNS(SVG, 'g');
        this.textG = document.createElementNS(SVG, 'g');
        this.floorG.append(this.gridPath, this.regionG, this.textG, this.baseG);
        this.floor.appendChild(this.floorG);

        this.itemLayer = document.createElement('div');
        this.itemLayer.className = 'iso-items';
        this.labelLayer = document.createElement('div');
        this.labelLayer.className = 'iso-labels';
        this.stage.append(this.floor, this.itemLayer, this.labelLayer);
        this.root.appendChild(this.stage);
        container.appendChild(this.root);

        this.root.addEventListener('pointerdown', this.onDown);
        this.root.addEventListener('pointermove', this.onMove);
        this.root.addEventListener('pointerup', this.onUp);
        this.root.addEventListener('pointercancel', this.onUp);
        this.root.addEventListener('pointerleave', this.onLeave);
        this.root.addEventListener('wheel', this.onWheel, {passive: false});
        this.root.addEventListener('dblclick', this.onDblClick);
        this.resizeObserver = new ResizeObserver(() => {
            if (!this.userMoved) {
                this.fit(false);
            } else {
                this.applyCamera();
            }
        });
        this.resizeObserver.observe(this.root);

        this.setDocument(options.document ?? {items: []});
    }

    // ---- public API -----------------------------------------------------------------------------------------

    public get element(): HTMLDivElement {
        return this.root;
    }

    public on<K extends keyof IsoEditorEvents>(event: K, listener: (payload: IsoEditorEvents[K]) => void): void {
        this.events.on(event, listener);
    }

    public off<K extends keyof IsoEditorEvents>(event: K, listener: (payload: IsoEditorEvents[K]) => void): void {
        this.events.off(event, listener);
    }

    /** A copy of the document. */
    public getDocument(): IsoDocument {
        return JSON.parse(JSON.stringify(this.doc)) as IsoDocument;
    }

    public setDocument(doc: IsoDocument): void {
        this.doc = JSON.parse(JSON.stringify(doc)) as IsoDocument;
        const ids = new Set(this.doc.items.map((i) => i.id));
        this.selected = new Set([...this.selected].filter((id) => ids.has(id)));
        this.render();
        if (!this.userMoved) {
            this.fit(false);
        }
    }

    public isReadOnly(): boolean {
        return this.readOnly;
    }

    /** Editing arrives with milestone I3; until then the widget is always a viewer. */
    public setReadOnly(readOnly: boolean): void {
        this.readOnly = readOnly;
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
    public registerIcons(types: IsoIconType[]): void {
        for (const t of types) {
            this.icons.set(t.id, t);
        }
        this.render();
    }

    /** All known icon types (built-in and registered), e.g. for a palette. */
    public getIconTypes(): IsoIconType[] {
        return [...this.icons.values()];
    }

    /** Override `--iso-*` custom properties on the root. */
    public setStyleVars(vars: Record<string, string>): void {
        for (const [k, v] of Object.entries(vars)) {
            this.root.style.setProperty(`--iso-${k}`, v);
        }
    }

    public select(ids: string[]): void {
        this.selected = new Set(ids);
        this.applyClasses();
        this.events.emit('selectionChange', [...this.selected]);
    }

    public getSelection(): string[] {
        return [...this.selected];
    }

    /** Emphasise these items (everything else dims); null clears. */
    public highlight(ids: string[] | null): void {
        this.highlighted = ids === null ? null : new Set(ids);
        this.applyClasses();
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
        this.resizeObserver.disconnect();
        this.events.clear();
        this.root.remove();
    }

    // ---- rendering --------------------------------------------------------------------------------------------

    private render(): void {
        this.regionG.replaceChildren(...(this.doc.regions ?? []).map((r) => this.regionEl(r)));
        this.textG.replaceChildren(...(this.doc.texts ?? []).map((t) => this.textEl(t)));

        const items = [...this.doc.items].sort((a, b) => IsoProjection.depth(a.tile) - IsoProjection.depth(b.tile));
        this.baseG.replaceChildren(...items.map((it) => this.baseEl(it)).filter((e): e is SVGRectElement => e !== null));
        this.itemLayer.replaceChildren(...items.map((it, i) => this.itemEl(it, i)));
        this.labelLayer.replaceChildren(...items.map((it, i) => this.calloutEl(it, i)).filter((e): e is HTMLDivElement => e !== null));
        this.applyClasses();
        this.gridKey = '';
        this.applyCamera();
    }

    private regionEl(r: IsoRegion): SVGGElement {
        const {x0, y0, x1, y1} = IsoProjection.rect(r.from, r.to);
        const color = r.color ?? '#8b7cf6';
        const g = document.createElementNS(SVG, 'g');
        const rect = document.createElementNS(SVG, 'rect');

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
            g.appendChild(this.floorText({id: `${r.id}:label`, tile: {x: x0, y: y1}, text: r.label, size: 0.32, bold: true,
                color: Color.lerp(color, '#ffffff', 0.15)}, 0.3, 0.62));
        }

        return g;
    }

    private textEl(t: IsoText): SVGGElement {
        return this.floorText(t, 0.1, 0.5);
    }

    /** Text lying on the floor: drawn at 100× size and scaled down, so tiny font sizes never hit browser minimums. */
    private floorText(t: IsoText, du: number, dv: number): SVGGElement {
        const g = document.createElementNS(SVG, 'g');
        const size = t.size ?? 0.4;
        // along y the text reads towards the upper right (−v), its top towards the upper left — never mirrored
        const rot = t.axis === 'y' ? ' rotate(-90)' : '';
        const x = t.axis === 'y' ? t.tile.x + dv : t.tile.x + du;
        const y = t.axis === 'y' ? t.tile.y + 1 - du : t.tile.y + dv;
        const text = document.createElementNS(SVG, 'text');

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
        const rect = document.createElementNS(SVG, 'rect');

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

    private itemEl(it: IsoItem, order: number): HTMLDivElement {
        const k = this.proj.tileW / IsoIcons.W;
        const c = this.proj.center(it.tile);
        const el = document.createElement('div');
        const type = this.iconType(it);

        el.className = 'iso-item';
        el.dataset.item = it.id;
        el.style.left = `${c.x - IsoIcons.CX * k}px`;
        el.style.top = `${c.y - IsoIcons.CY * k}px`;
        el.style.width = `${IsoIcons.W * k}px`;
        el.style.height = `${IsoIcons.H * k}px`;
        el.style.zIndex = String(order + 1);
        el.innerHTML = IsoIcons.svg(type, it.color);
        el.title = it.label ?? type.label ?? it.icon;

        return el;
    }

    private calloutEl(it: IsoItem, order: number): HTMLDivElement | null {
        if (it.label === undefined || it.label === '') {
            return null;
        }
        const k = this.proj.tileW / IsoIcons.W;
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
        el.style.zIndex = String(order + 1);
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

    private applyClasses(): void {
        const dim = (id: string): boolean => this.highlighted !== null && !this.highlighted.has(id);

        for (const el of this.root.querySelectorAll<HTMLElement | SVGElement>('[data-item]')) {
            const id = el.dataset.item!;
            el.classList.toggle('iso-selected', this.selected.has(id) && !el.classList.contains('iso-callout'));
            el.classList.toggle('iso-hover', this.hoverId === id);
            if (!el.classList.contains('iso-label')) {
                el.classList.toggle('iso-dim', dim(id));
            }
        }
    }

    /** World box of everything drawn (icons, labels, regions, texts). */
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
        for (const r of this.doc.regions ?? []) {
            b = IsoProjection.union(b, this.proj.rectBounds(r.from, r.to));
        }
        for (const t of this.doc.texts ?? []) {
            b = IsoProjection.union(b, this.proj.rectBounds(t.tile, t.tile));
        }

        return b ?? {minX: -200, minY: -100, maxX: 200, maxY: 100};
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

    // ---- input -------------------------------------------------------------------------------------------------

    private local(e: MouseEvent): {x: number; y: number} {
        const r = this.root.getBoundingClientRect();

        return {x: e.clientX - r.left, y: e.clientY - r.top};
    }

    private static targetId(target: EventTarget | null, attr: 'item' | 'region'): string | null {
        const el = target instanceof Element ? target.closest(`[data-${attr}]`) : null;

        return el instanceof HTMLElement || el instanceof SVGElement ? el.dataset[attr] ?? null : null;
    }

    private readonly onDown = (e: PointerEvent): void => {
        if (e.button !== 0 && e.button !== 1) {
            return;
        }
        const p = this.local(e);
        this.press = {x: p.x, y: p.y, target: e.target, moved: false, id: e.pointerId};
    };

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);
        const press = this.press;

        if (press !== null) {
            if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) > 3) {
                press.moved = true;
                this.root.setPointerCapture(press.id);
                this.root.classList.add('iso-panning');
                cancelAnimationFrame(this.raf);
                this.camera.cancelFlight();
            }
            if (press.moved) {
                this.camera.panBy(p.x - press.x, p.y - press.y);
                press.x = p.x;
                press.y = p.y;
                this.userMoved = true;
                this.applyCamera();
                return;
            }
        }
        const id = IsoEditor.targetId(e.target, 'item');
        if (id !== this.hoverId) {
            this.hoverId = id;
            this.applyClasses();
            this.events.emit('itemHover', id === null ? null : this.doc.items.find((i) => i.id === id) ?? null);
        }
    };

    private readonly onUp = (e: PointerEvent): void => {
        const press = this.press;
        this.press = null;
        this.root.classList.remove('iso-panning');
        if (this.root.hasPointerCapture(e.pointerId)) {
            this.root.releasePointerCapture(e.pointerId);
        }
        if (press === null || press.moved || e.type === 'pointercancel') {
            return;
        }
        const itemId = IsoEditor.targetId(press.target, 'item');
        const item = itemId !== null ? this.doc.items.find((i) => i.id === itemId) : undefined;

        if (item !== undefined) {
            const additive = e.shiftKey || e.ctrlKey || e.metaKey;
            if (additive) {
                if (this.selected.has(item.id)) {
                    this.selected.delete(item.id);
                } else {
                    this.selected.add(item.id);
                }
            } else {
                this.selected = new Set([item.id]);
            }
            this.applyClasses();
            this.events.emit('selectionChange', [...this.selected]);
            this.events.emit('itemClick', {item, originalEvent: e});
            return;
        }
        const regionId = IsoEditor.targetId(press.target, 'region');
        const region = regionId !== null ? this.doc.regions?.find((r) => r.id === regionId) : undefined;
        if (region !== undefined) {
            this.events.emit('regionClick', {region, originalEvent: e});
        }
        if (this.selected.size > 0) {
            this.selected.clear();
            this.applyClasses();
            this.events.emit('selectionChange', []);
        }
        if (region === undefined) {
            const w = this.camera.toWorld(this.local(e).x, this.local(e).y);
            this.events.emit('floorClick', {tile: this.proj.toTile(w.x, w.y), originalEvent: e});
        }
    };

    private readonly onLeave = (): void => {
        if (this.press === null && this.hoverId !== null) {
            this.hoverId = null;
            this.applyClasses();
            this.events.emit('itemHover', null);
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
        const itemId = IsoEditor.targetId(e.target, 'item');
        const item = itemId !== null ? this.doc.items.find((i) => i.id === itemId) : undefined;

        if (item !== undefined) {
            this.events.emit('itemDblClick', {item, originalEvent: e});
        } else {
            this.fit(true);
        }
    };

}
