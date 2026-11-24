import { Color } from '../util/Color';
import { IsoDoc, IsoHost } from './IsoHost';
import { IsoIcons } from './IsoIcons';
import { IsoBounds, IsoProjection } from './IsoProjection';
import { IsoRoute } from './IsoRoute';
import { IsoAnchor, IsoConnector, IsoIconType, IsoItem, IsoRegion, IsoText, IsoTile } from './IsoTypes';

/** A connector's route as drawn: the tiles walked, the corner tiles, and the corner centres as a flat u,v line. */
export interface IsoDrawnRoute {
    tiles: IsoTile[];
    corners: IsoTile[];
    line: number[];
}

/**
 * The editor's drawing of its document (internal to `IsoEditor`): builds the
 * stage with the floor SVG (grid, regions, texts, connectors, base tiles,
 * status rings, drafts — all under the isometric matrix, in tile units), the
 * handle SVG and the DOM layers for walls, items, actors and labels, and
 * redraws them from the document. Also the selection/hover/dim classes, the
 * visible-tiles grid and the content bounds. Connector routing lives here as
 * statics, so every part routes a document the same way.
 */
export class IsoScene {

    public static readonly SVG = 'http://www.w3.org/2000/svg';

    public readonly stage: HTMLDivElement;
    public readonly connG: SVGGElement;
    public readonly statusG: SVGGElement;
    public readonly handleG: SVGGElement;
    public readonly draftG: SVGGElement;
    public readonly labelLayer: HTMLDivElement;
    public readonly actorLayer: HTMLDivElement;
    private readonly host: IsoHost;
    private readonly proj: IsoProjection;
    private readonly floor: SVGSVGElement;
    private readonly floorG: SVGGElement;
    private readonly gridPath: SVGPathElement;
    private readonly regionG: SVGGElement;
    private readonly baseG: SVGGElement;
    private readonly textG: SVGGElement;
    private readonly wallLayer: HTMLDivElement;
    private readonly connLabelLayer: HTMLDivElement;
    private readonly itemLayer: HTMLDivElement;
    private showGrid: boolean;
    private gridKey = '';

    public constructor(host: IsoHost, grid: boolean) {
        this.host = host;
        this.proj = host.proj;
        this.showGrid = grid;
        this.stage = document.createElement('div');
        this.stage.className = 'iso-stage';

        this.floor = document.createElementNS(IsoScene.SVG, 'svg');
        this.floor.setAttribute('class', 'iso-floor');
        this.floorG = document.createElementNS(IsoScene.SVG, 'g');
        this.floorG.setAttribute('transform', `matrix(${this.proj.floorMatrix().join(' ')})`);
        this.gridPath = document.createElementNS(IsoScene.SVG, 'path');
        this.gridPath.setAttribute('class', 'iso-grid');
        this.regionG = document.createElementNS(IsoScene.SVG, 'g');
        this.baseG = document.createElementNS(IsoScene.SVG, 'g');
        this.textG = document.createElementNS(IsoScene.SVG, 'g');
        this.connG = document.createElementNS(IsoScene.SVG, 'g');
        this.handleG = document.createElementNS(IsoScene.SVG, 'g');
        this.draftG = document.createElementNS(IsoScene.SVG, 'g');
        this.statusG = document.createElementNS(IsoScene.SVG, 'g');
        // connectors lie under the base tiles, so a line meets an item at its tile edge
        this.floorG.append(this.gridPath, this.regionG, this.textG, this.connG, this.baseG, this.statusG, this.draftG);
        this.floor.appendChild(this.floorG);
        // handles get their own floor-plane SVG above every label, so nothing covers them
        const handleSvg = document.createElementNS(IsoScene.SVG, 'svg');
        handleSvg.setAttribute('class', 'iso-floor iso-handles');
        const handleMatrix = document.createElementNS(IsoScene.SVG, 'g');
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
        host.root.appendChild(this.stage);
    }

    // ---- routing (shared by every part) ---------------------------------------------------------------------

    public static anchorTile(doc: IsoDoc, a: IsoAnchor): IsoTile | null {
        if ('item' in a) {
            return doc.items.find((i) => i.id === a.item)?.tile ?? null;
        }

        return a.tile;
    }

    public static blocked(doc: IsoDoc): Set<string> {
        return new Set(doc.items.map((i) => IsoRoute.key(i.tile)));
    }

    /** Route of a connector: every other item's tile is avoided. Null when an end is missing. */
    public static route(doc: IsoDoc, c: IsoConnector): IsoDrawnRoute | null {
        const a = IsoScene.anchorTile(doc, c.from), b = IsoScene.anchorTile(doc, c.to);

        if (a === null || b === null) {
            return null;
        }
        const tiles = IsoRoute.route(a, b, c.via ?? [], {blocked: IsoScene.blocked(doc)});
        const corners = IsoRoute.corners(tiles);

        return {tiles, corners, line: IsoRoute.centres(corners)};
    }

    /** How far from an end the arrowhead / end handle sits: outside an item's base tile, close to a free end. */
    public static endGap(a: IsoAnchor): number {
        return 'item' in a ? 0.62 : 0.12;
    }

    // ---- drawing --------------------------------------------------------------------------------------------

    /** Redraw everything from the document (status, classes and handles are the editor's next steps). */
    public render(): void {
        const doc = this.host.doc();
        this.regionG.replaceChildren(...doc.regions.map((r) => this.regionEl(r)));
        this.textG.replaceChildren(...doc.texts.map((t) => this.textEl(t)));
        const conns = doc.connectors.map((c) => this.connectorEl(c)).filter((x): x is NonNullable<typeof x> => x !== null);
        this.connG.replaceChildren(...conns.map((c) => c.g));
        this.connLabelLayer.replaceChildren(...conns.map((c) => c.label).filter((l): l is HTMLDivElement => l !== null));

        const items = [...doc.items].sort((a, b) => IsoProjection.depth(a.tile) - IsoProjection.depth(b.tile));
        this.baseG.replaceChildren(...items.map((it) => this.baseEl(it)).filter((e): e is SVGRectElement => e !== null));
        this.itemLayer.replaceChildren(...items.map((it) => this.itemEl(it)));
        this.labelLayer.replaceChildren(...items.map((it) => this.calloutEl(it)).filter((e): e is HTMLDivElement => e !== null));
        this.wallLayer.replaceChildren(...doc.regions.flatMap((r) => this.wallEls(r)));
    }

    public setGrid(on: boolean): void {
        this.showGrid = on;
        this.gridKey = '';
        this.drawGrid();
    }

    private iconType(it: IsoItem): IsoIconType {
        return this.host.iconType(it.icon);
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
            const svg = document.createElementNS(IsoScene.SVG, 'svg');
            svg.setAttribute('class', 'iso-wall');
            const face = document.createElementNS(IsoScene.SVG, 'polygon');
            face.setAttribute('points', [pt(w.u0, w.v0, 0), pt(w.u1, w.v1, 0), pt(w.u1, w.v1, h), pt(w.u0, w.v0, h)].join(' '));
            face.setAttribute('fill', fill[w.face]);
            const top = document.createElementNS(IsoScene.SVG, 'polygon');
            top.setAttribute('points', [pt(w.u0, w.v0, h), pt(w.u1, w.v1, h), pt(w.u1 + du, w.v1 + dv, h), pt(w.u0 + du, w.v0 + dv, h)].join(' '));
            top.setAttribute('fill', cap);
            svg.append(face, top);
            svg.style.zIndex = String(IsoProjection.zOf((w.u0 + w.u1) / 2, (w.v0 + w.v1) / 2));
            return svg;
        });
    }

    private regionEl(r: IsoRegion): SVGGElement {
        const {x0, y0, x1, y1} = IsoProjection.rect(r.from, r.to);
        const color = r.color ?? '#8b7cf6';
        const g = document.createElementNS(IsoScene.SVG, 'g');
        const rect = document.createElementNS(IsoScene.SVG, 'rect');

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
        const g = document.createElementNS(IsoScene.SVG, 'g');
        const size = t.size ?? 0.4;
        // along y the text reads towards the upper right (−v), its top towards the upper left — never mirrored
        const rot = t.axis === 'y' ? ' rotate(-90)' : '';
        const x = t.axis === 'y' ? t.tile.x + dv : t.tile.x + du;
        const y = t.axis === 'y' ? t.tile.y + 1 - du : t.tile.y + dv;
        const text = document.createElementNS(IsoScene.SVG, 'text');

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
        const rect = document.createElementNS(IsoScene.SVG, 'rect');

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

    private connectorEl(c: IsoConnector): {g: SVGGElement; label: HTMLDivElement | null} | null {
        const r = IsoScene.route(this.host.doc(), c);

        if (r === null || r.line.length < 4) {
            return null;
        }
        const {line} = r;
        const d = IsoRoute.pathData(line);
        const color = c.color ?? 'var(--iso-line)';
        const width = c.width ?? 6;
        const g = document.createElementNS(IsoScene.SVG, 'g');
        const path = (cls: string, w: number): SVGPathElement => {
            const el = document.createElementNS(IsoScene.SVG, 'path');
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
            heads.push(IsoRoute.arrow(IsoRoute.atDistance(line, total - IsoScene.endGap(c.to)), 0.3, 0.26));
        }
        if (arrows === 'both' && total > 1) {
            const p = IsoRoute.atDistance(line, IsoScene.endGap(c.from));
            heads.push(IsoRoute.arrow({u: p.u, v: p.v, du: -p.du, dv: -p.dv}, 0.3, 0.26));
        }
        for (const h of heads) {
            const tri = document.createElementNS(IsoScene.SVG, 'polygon');
            tri.setAttribute('points', h.join(' '));
            tri.style.fill = color;
            g.appendChild(tri);
        }
        // a free end (on a tile, not an item) gets a small ring
        for (const [a, i] of [[c.from, 0], [c.to, line.length - 2]] as const) {
            if ('tile' in a) {
                const ring = document.createElementNS(IsoScene.SVG, 'circle');
                ring.setAttribute('class', 'iso-conn-end');
                ring.setAttribute('cx', String(line[i]));
                ring.setAttribute('cy', String(line[i + 1]));
                ring.setAttribute('r', '0.12');
                ring.style.stroke = color;
                g.appendChild(ring);
            }
        }
        if (c.animated === true && !IsoScene.reducedMotion()) {
            // dots on the floor travelling the route; three per connector, evenly spaced
            const dur = Math.max(0.8, total / 1.8);
            for (let k = 0; k < 3; k++) {
                const dot = document.createElementNS(IsoScene.SVG, 'circle');
                dot.setAttribute('r', '0.1');
                dot.style.fill = '#ffffff';
                dot.style.opacity = '0.9';
                dot.style.pointerEvents = 'none';
                const anim = document.createElementNS(IsoScene.SVG, 'animateMotion');
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

    public applyClasses(selected: ReadonlySet<string>, hoverId: string | null, highlighted: ReadonlySet<string> | null): void {
        const dim = (id: string): boolean => highlighted !== null && !highlighted.has(id);
        const ends = new Map(this.host.doc().connectors.map((c) => [c.id, [c.from, c.to]]));
        // a connector stays lit when it is highlighted itself or both of its items are
        const dimConn = (id: string): boolean => {
            if (highlighted === null || highlighted.has(id)) {
                return false;
            }
            const e = ends.get(id);
            return e === undefined || !e.every((a) => 'item' in a && highlighted!.has(a.item));
        };

        for (const el of this.host.root.querySelectorAll<HTMLElement | SVGElement>('.iso-conn, .iso-conn-label')) {
            const id = el.dataset.connector!;
            el.classList.toggle('iso-selected', selected.has(id));
            el.classList.toggle('iso-hover', hoverId === id);
            el.classList.toggle('iso-dim', dimConn(id));
        }
        for (const el of this.host.root.querySelectorAll<SVGElement>('.iso-region')) {
            el.classList.toggle('iso-selected', selected.has(el.dataset.region!));
        }
        for (const el of this.host.root.querySelectorAll<SVGElement>('.iso-text')) {
            el.classList.toggle('iso-selected', selected.has(el.dataset.text!));
        }
        for (const el of this.host.root.querySelectorAll<HTMLElement | SVGElement>('[data-item]')) {
            const id = el.dataset.item!;
            el.classList.toggle('iso-selected', selected.has(id) && !el.classList.contains('iso-callout'));
            el.classList.toggle('iso-hover', hoverId === id);
            if (!el.classList.contains('iso-label')) {
                el.classList.toggle('iso-dim', dim(id));
            }
        }
    }

    /** World box of everything drawn (icons, labels, regions, texts, routes). */
    public bounds(): IsoBounds {
        const k = this.proj.tileW / IsoIcons.W;
        let b: IsoBounds | null = null;

        for (const it of this.host.doc().items) {
            const c = this.proj.center(it.tile);
            const top = it.label !== undefined && it.label !== ''
                ? (this.iconType(it).height ?? 70) * k + (it.labelHeight ?? 1) * this.proj.tileH + 46
                : IsoIcons.CY * k;
            b = IsoProjection.union(b, {minX: c.x - 60 * k, maxX: c.x + 60 * k, minY: c.y - top, maxY: c.y + 30 * k});
        }
        for (const r of this.host.doc().regions) {
            const rb = this.proj.rectBounds(r.from, r.to);
            rb.minY -= (r.wall ?? 0) * this.proj.tileH;
            b = IsoProjection.union(b, rb);
        }
        for (const t of this.host.doc().texts) {
            b = IsoProjection.union(b, this.proj.rectBounds(t.tile, t.tile));
        }
        for (const c of this.host.doc().connectors) {
            for (const t of IsoScene.route(this.host.doc(), c)?.corners ?? []) {
                b = IsoProjection.union(b, this.proj.rectBounds(t, t));
            }
        }

        return b ?? {minX: -300, minY: -150, maxX: 300, maxY: 150};
    }

    /** Grid lines over the visible tiles only (redrawn when the visible range changes). */
    public drawGrid(): void {
        if (!this.showGrid) {
            this.gridPath.setAttribute('d', '');
            return;
        }
        const view = this.host.camera.viewBounds(this.host.root.clientWidth, this.host.root.clientHeight);
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

}
