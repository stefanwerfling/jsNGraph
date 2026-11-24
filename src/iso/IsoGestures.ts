import { IsoDoc, IsoHost } from './IsoHost';
import { IsoIcons } from './IsoIcons';
import { IsoModel } from './IsoModel';
import { IsoHandle, IsoOverlay } from './IsoOverlay';
import { IsoProjection } from './IsoProjection';
import { IsoScene } from './IsoScene';
import { IsoAnchor, IsoConnector, IsoItem, IsoTile } from './IsoTypes';

type Gesture =
    | {kind: 'pan'}
    | {kind: 'band'; x0: number; y0: number; x1: number; y1: number; additive: boolean}
    | {kind: 'move'; ids: Set<string>; start: IsoTile; dx: number; dy: number; orig: IsoDoc}
    | {kind: 'region'; start: IsoTile; end: IsoTile}
    | {kind: 'connect'; from: IsoAnchor; to: IsoAnchor | null}
    | {kind: 'handle'; handle: IsoHandle; orig: IsoDoc; via: number};

/**
 * Pointer input of the editor (internal to `IsoEditor`): a press becomes a
 * click or, past 3 px, a gesture (pan, lasso band, tile-snapped move, region
 * drag, connector drag, handle drag) by mode and target; two-click connectors
 * in connect mode, wheel zoom, double-click (label editor, waypoint removal,
 * fit), hover events and the palette drag (`beginDrag`). Live drags swap the
 * document without an undo step; the release commits once.
 */
export class IsoGestures {

    private readonly host: IsoHost;
    private readonly overlay: IsoOverlay;
    private readonly proj: IsoProjection;
    private readonly band: HTMLDivElement;
    private press: {x: number; y: number; target: EventTarget | null; moved: boolean; id: number; button: number; shift: boolean} | null = null;
    private gesture: Gesture | null = null;
    /** First end of a two-click connection in connect mode. */
    private pending: IsoAnchor | null = null;
    private pointer: {x: number; y: number} | null = null;
    private hover: string | null = null;
    private dragCleanup: (() => void) | null = null;

    public constructor(host: IsoHost, overlay: IsoOverlay) {
        this.host = host;
        this.overlay = overlay;
        this.proj = host.proj;
        this.band = document.createElement('div');
        this.band.className = 'iso-band';
        this.band.hidden = true;
        host.root.appendChild(this.band);

        const root = host.root;
        root.addEventListener('pointerdown', this.onDown);
        root.addEventListener('pointermove', this.onMove);
        root.addEventListener('pointerup', this.onUp);
        root.addEventListener('pointercancel', this.onUp);
        root.addEventListener('pointerleave', this.onLeave);
        root.addEventListener('wheel', this.onWheel, {passive: false});
        root.addEventListener('dblclick', this.onDblClick);
    }

    /** Id of the hovered item or connector. */
    public get hoverId(): string | null {
        return this.hover;
    }

    /** True while a gesture runs or a connector's first end is pending. */
    public get busy(): boolean {
        return this.pending !== null || this.gesture !== null;
    }

    /** Forget the first end of a two-click connector. */
    public clearPending(): void {
        this.pending = null;
    }

    /** Stop a running palette drag. */
    public destroy(): void {
        this.dragCleanup?.();
    }

    /** Draft of a connector being drawn or a region being dragged out. */
    private drawDraft(): void {
        const g = this.gesture;
        const doc = this.host.doc();
        const fromPending = this.pending !== null && this.host.mode() === 'connect' ? this.pending : null;

        if (g?.kind === 'region') {
            this.overlay.drawDraft({start: g.start, end: g.end}, null, null);
            return;
        }
        const from = g?.kind === 'connect' ? g.from : fromPending;
        const toTile = g?.kind === 'connect' ? (g.to !== null ? IsoScene.anchorTile(doc, g.to) : null) : this.pointerTile();
        const a = from !== null ? IsoScene.anchorTile(doc, from) : null;
        this.overlay.drawDraft(null, a, toTile);
    }

    /**
     * Start dragging a new item from a host palette: call it from the palette
     * entry's `pointerdown`. A ghost follows the pointer; releasing over the
     * editor places the item (`dropAt`), Escape cancels.
     */
    public beginDrag(icon: string, event: PointerEvent, data: Partial<Omit<IsoItem, 'id' | 'tile' | 'icon'>> = {}): void {
        if (this.host.readOnly()) {
            return;
        }
        this.dragCleanup?.();
        event.preventDefault();
        const type = this.host.iconType(icon);
        const ghost = document.createElement('div');
        const size = (): number => this.proj.tileW * this.host.camera.scale;

        ghost.className = 'iso-ghost';
        ghost.innerHTML = IsoIcons.svg(type, data.color);
        document.body.appendChild(ghost);
        const place = (x: number, y: number): void => {
            const s = size();
            ghost.style.width = `${s}px`;
            ghost.style.height = `${s * 1.4}px`;
            ghost.style.transform = `translate(${x - s / 2}px, ${y - s * 1.15}px)`;
            const tile = this.inside(x, y) ? this.tileAtClient(x, y) : null;
            this.overlay.drawCursor(tile !== null ? IsoModel.freeTileNear(this.host.doc(), tile) : null);
        };
        const move = (e: PointerEvent): void => place(e.clientX, e.clientY);
        const up = (e: PointerEvent): void => {
            cleanup();
            if (this.inside(e.clientX, e.clientY)) {
                this.host.dropAt(icon, e.clientX, e.clientY, data);
            }
        };
        const key = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                cleanup();
            }
        };
        const cleanup = (): void => {
            ghost.remove();
            this.overlay.drawCursor(null);
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

    // ---- geometry helpers ---------------------------------------------------------------------------------

    private local(e: {clientX: number; clientY: number}): {x: number; y: number} {
        const r = this.host.root.getBoundingClientRect();

        return {x: e.clientX - r.left, y: e.clientY - r.top};
    }

    private inside(clientX: number, clientY: number): boolean {
        const r = this.host.root.getBoundingClientRect();

        return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    }

    private floorAt(x: number, y: number): {u: number; v: number} {
        const w = this.host.camera.toWorld(x, y);

        return this.proj.toFloor(w.x, w.y);
    }

    private tileAt(x: number, y: number): IsoTile {
        const f = this.floorAt(x, y);

        return {x: Math.floor(f.u), y: Math.floor(f.v)};
    }

    public tileAtClient(clientX: number, clientY: number): IsoTile {
        const p = this.local({clientX, clientY});

        return this.tileAt(p.x, p.y);
    }

    /** The tile under the last pointer position over the editor, if any. */
    public pointerTile(): IsoTile | null {
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
        const id = IsoGestures.targetId(target ?? this.hitAt(clientX, clientY), 'item');

        return id !== null ? {item: id} : {tile: this.tileAtClient(clientX, clientY)};
    }

    // ---- input -------------------------------------------------------------------------------------------------

    /** Drop a press / gesture in progress (a pending connector end stays). */
    public cancel(): void {
        this.gesture = null;
        this.press = null;
        this.band.hidden = true;
        this.drawDraft();
        this.host.root.classList.remove('iso-panning');
    }

    private readonly onDown = (e: PointerEvent): void => {
        if (e.target instanceof Element && e.target.closest('.iso-input') !== null) {
            return;
        }
        if (e.button !== 0 && e.button !== 1) {
            return;
        }
        this.host.root.focus({preventScroll: true});
        const p = this.local(e);
        this.press = {x: p.x, y: p.y, target: e.target, moved: false, id: e.pointerId, button: e.button, shift: e.shiftKey};
    };

    /** The gesture a press turns into once it moves. */
    private startGesture(press: NonNullable<IsoGestures['press']>): Gesture {
        const editable = !this.host.readOnly();
        const t = press.target;

        if (!editable || press.button === 1 || this.host.mode() === 'pan') {
            return {kind: 'pan'};
        }
        if (this.host.mode() === 'connect') {
            const fromItem = IsoGestures.targetId(t, 'item');
            return {kind: 'connect', from: fromItem !== null ? {item: fromItem} : {tile: this.tileAt(press.x, press.y)}, to: null};
        }
        if (this.host.mode() === 'region') {
            const s = this.tileAt(press.x, press.y);
            return {kind: 'region', start: s, end: s};
        }
        const handle = IsoGestures.targetId(t, 'handle');
        if (handle !== null) {
            return {kind: 'handle', handle: IsoOverlay.parseHandle(handle), orig: this.snapshot(), via: -1};
        }
        // a region is large: dragging on it pans unless it is already selected
        const regionId = IsoGestures.targetId(t, 'region');
        const hitId = IsoGestures.targetId(t, 'item') ?? IsoGestures.targetId(t, 'text')
            ?? (regionId !== null && this.host.selected().has(regionId) ? regionId : null);
        if (hitId !== null) {
            if (!this.host.selected().has(hitId)) {
                this.host.select(press.shift ? [...this.host.selected(), hitId] : [hitId]);
            }
            const ids = new Set([...this.host.selected()].filter((id) => IsoModel.kindOf(this.host.doc(), id) !== 'connector'));
            return {kind: 'move', ids, start: this.tileAt(press.x, press.y), dx: 0, dy: 0, orig: this.snapshot()};
        }
        if (press.shift) {
            return {kind: 'band', x0: press.x, y0: press.y, x1: press.x, y1: press.y, additive: true};
        }

        return {kind: 'pan'};
    }

    private snapshot(): IsoDoc {
        return JSON.parse(JSON.stringify(this.host.doc())) as IsoDoc;
    }

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);
        const press = this.press;
        this.pointer = p;

        if (press !== null) {
            if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) > 3) {
                press.moved = true;
                this.host.root.setPointerCapture(press.id);
                this.host.stopFlight();
                this.gesture = this.startGesture(press);
                if (this.gesture.kind === 'pan') {
                    this.host.root.classList.add('iso-panning');
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
        if (!this.host.readOnly() && (this.host.mode() === 'connect' || this.host.mode() === 'region' || this.host.mode() === 'text')) {
            this.overlay.drawCursor(this.tileAt(p.x, p.y));
            if (this.pending !== null) {
                this.drawDraft();
            }
        }
    };

    private dragGesture(g: Gesture, p: {x: number; y: number}, e: PointerEvent): void {
        const press = this.press!;

        switch (g.kind) {
            case 'pan':
                this.host.camera.panBy(p.x - press.x, p.y - press.y);
                this.host.markMoved();
                this.host.applyCamera();
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
                const trial = JSON.parse(JSON.stringify(g.orig)) as IsoDoc;
                // keep the last valid place while the target is taken
                if (!IsoModel.canMove(trial, g.ids, dx, dy)) {
                    return;
                }
                IsoModel.move(trial, g.ids, dx, dy);
                g.dx = dx;
                g.dy = dy;
                this.host.setDoc(trial);
                this.host.render();
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
                this.overlay.drawCursor(IsoScene.anchorTile(this.host.doc(), a));
                return;
            }
            case 'handle':
                this.dragHandle(g, p, e);
                return;
        }
    }

    private dragHandle(g: Extract<Gesture, {kind: 'handle'}>, p: {x: number; y: number}, e: PointerEvent): void {
        const trial = JSON.parse(JSON.stringify(g.orig)) as IsoDoc;
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
        this.host.setDoc(trial);
        this.host.render();
        this.overlay.drawCursor(h.kind === 'corner' ? null : this.tileAt(p.x, p.y));
    }

    /** Where a new waypoint for segment `seg` of the drawn route goes in `via`. */
    private insertIndex(doc: IsoDoc, c: IsoConnector, seg: number): number {
        const r = IsoScene.route(doc, c);
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
        this.host.root.classList.remove('iso-panning');
        if (this.host.root.hasPointerCapture(e.pointerId)) {
            this.host.root.releasePointerCapture(e.pointerId);
        }
        if (press === null || e.type === 'pointercancel') {
            this.cancel();
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
                    const s = this.host.camera.toScreen(wx, wy);
                    return s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1;
                };
                const ids = new Set(g.additive ? this.host.selected() : []);
                for (const it of this.host.doc().items) {
                    const c = this.proj.center(it.tile);
                    if (inBox(c.x, c.y)) {
                        ids.add(it.id);
                    }
                }
                for (const r of this.host.doc().regions) {
                    const b = this.proj.rectBounds(r.from, r.to);
                    if (inBox(b.minX, b.minY) && inBox(b.maxX, b.maxY)) {
                        ids.add(r.id);
                    }
                }
                for (const t of this.host.doc().texts) {
                    const c = this.proj.center(t.tile);
                    if (inBox(c.x, c.y)) {
                        ids.add(t.id);
                    }
                }
                for (const c of this.host.doc().connectors) {
                    if ([c.from, c.to].every((a) => 'item' in a && ids.has(a.item))) {
                        ids.add(c.id);
                    }
                }
                this.host.select([...ids]);
                return;
            }
            case 'move':
                if (g.dx !== 0 || g.dy !== 0) {
                    this.host.commit('move', [...g.ids]);
                }
                return;
            case 'region': {
                this.drawDraft();
                const id = this.host.addRegion(g.start, g.end);
                this.host.select([id]);
                return;
            }
            case 'connect': {
                this.drawDraft();
                this.overlay.drawCursor(null);
                if (g.to !== null && !IsoGestures.sameAnchor(g.from, g.to)) {
                    const id = this.host.addConnector(g.from, g.to);
                    this.host.select([id]);
                }
                return;
            }
            case 'handle': {
                this.overlay.drawCursor(null);
                const kind = g.handle.kind === 'corner' ? 'resize' : 'reroute';
                if (JSON.stringify(g.orig) !== JSON.stringify(this.host.doc())) {
                    this.host.commit(kind, [g.handle.owner]);
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

    private click(press: NonNullable<IsoGestures['press']>, e: PointerEvent): void {
        const t = press.target;

        if (!this.host.readOnly() && this.host.mode() === 'connect') {
            const a = this.anchorAt(e.clientX, e.clientY, t);
            if (this.pending === null) {
                this.pending = a;
            } else {
                const from = this.pending;
                this.pending = null;
                this.drawDraft();
                if (!IsoGestures.sameAnchor(from, a)) {
                    this.host.select([this.host.addConnector(from, a)]);
                }
            }
            this.drawDraft();
            return;
        }
        if (!this.host.readOnly() && this.host.mode() === 'text') {
            const id = this.host.addText(this.tileAt(press.x, press.y), 'Text');
            this.host.select([id]);
            this.host.editLabel(id);
            return;
        }
        if (!this.host.readOnly() && this.host.mode() === 'region') {
            return;
        }

        const pick = (id: string): void => {
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                const next = new Set(this.host.selected());
                if (next.has(id)) {
                    next.delete(id);
                } else {
                    next.add(id);
                }
                this.host.select([...next]);
            } else {
                this.host.select([id]);
            }
        };
        const itemId = IsoGestures.targetId(t, 'item');
        const item = itemId !== null ? this.host.doc().items.find((i) => i.id === itemId) : undefined;
        if (item !== undefined) {
            pick(item.id);
            this.host.events.emit('itemClick', {item, originalEvent: e});
            return;
        }
        const connId = IsoGestures.targetId(t, 'connector');
        const connector = connId !== null ? this.host.doc().connectors.find((c) => c.id === connId) : undefined;
        if (connector !== undefined) {
            pick(connector.id);
            this.host.events.emit('connectorClick', {connector, originalEvent: e});
            return;
        }
        const textId = IsoGestures.targetId(t, 'text');
        if (textId !== null) {
            pick(textId);
            return;
        }
        const regionId = IsoGestures.targetId(t, 'region');
        const region = regionId !== null ? this.host.doc().regions.find((r) => r.id === regionId) : undefined;
        if (region !== undefined) {
            // regions are selectable while editing; in the viewer a click passes through to the floor
            if (!this.host.readOnly()) {
                pick(region.id);
            }
            this.host.events.emit('regionClick', {region, originalEvent: e});
            if (!this.host.readOnly()) {
                return;
            }
        }
        if (this.host.selected().size > 0 && !(e.shiftKey || e.ctrlKey || e.metaKey)) {
            this.host.select([]);
        }
        this.host.events.emit('floorClick', {tile: this.tileAt(press.x, press.y), originalEvent: e});
    }

    private updateHover(target: EventTarget | null): void {
        const itemId = IsoGestures.targetId(target, 'item');
        const connId = itemId === null ? IsoGestures.targetId(target, 'connector') : null;
        const id = itemId ?? connId;

        if (id === this.hover) {
            return;
        }
        const wasConn = this.hover !== null && this.host.doc().connectors.some((c) => c.id === this.hover);
        const wasItem = this.hover !== null && !wasConn;
        this.hover = id;
        this.host.applyClasses();
        if (itemId !== null || wasItem) {
            this.host.events.emit('itemHover', itemId === null ? null : this.host.doc().items.find((i) => i.id === itemId) ?? null);
        }
        if (connId !== null || wasConn) {
            this.host.events.emit('connectorHover', connId === null ? null : this.host.doc().connectors.find((c) => c.id === connId) ?? null);
        }
    }

    private readonly onLeave = (): void => {
        this.pointer = null;
        if (this.press === null) {
            this.overlay.drawCursor(null);
            if (this.hover !== null) {
                const wasConn = this.host.doc().connectors.some((c) => c.id === this.hover);
                this.hover = null;
                this.host.applyClasses();
                this.host.events.emit(wasConn ? 'connectorHover' : 'itemHover', null);
            }
        }
    };

    private readonly onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        const p = this.local(e);
        this.host.stopFlight();
        this.host.camera.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
        this.host.markMoved();
        this.host.applyCamera();
    };

    private readonly onDblClick = (e: MouseEvent): void => {
        if (e.target instanceof Element && e.target.closest('.iso-input') !== null) {
            return;
        }
        if (!this.host.readOnly() && this.host.mode() !== 'select') {
            return;
        }
        const itemId = IsoGestures.targetId(e.target, 'item');
        const item = itemId !== null ? this.host.doc().items.find((i) => i.id === itemId) : undefined;

        if (item !== undefined) {
            this.host.events.emit('itemDblClick', {item, originalEvent: e});
            this.host.editLabel(item.id);
            return;
        }
        const other = IsoGestures.targetId(e.target, 'connector') ?? IsoGestures.targetId(e.target, 'text') ?? IsoGestures.targetId(e.target, 'region');
        if (other !== null && !this.host.readOnly()) {
            this.host.editLabel(other);
            return;
        }
        if (IsoGestures.targetId(e.target, 'handle') !== null) {
            // double-click a waypoint removes it
            const h = IsoOverlay.parseHandle(IsoGestures.targetId(e.target, 'handle')!);
            const c = this.host.doc().connectors.find((x) => x.id === h.owner);
            if (h.kind === 'via' && c?.via !== undefined) {
                c.via.splice(h.index, 1);
                this.host.commit('reroute', [c.id]);
            }
            return;
        }
        this.host.fit(true);
    };

}
