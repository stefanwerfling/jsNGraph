import { IsoHost } from './IsoHost';
import { IsoProjection } from './IsoProjection';
import { IsoRoute } from './IsoRoute';
import { IsoScene } from './IsoScene';
import { IsoTile } from './IsoTypes';

/** A handle under the pointer: region corner, connector waypoint, segment midpoint or end. */
export interface IsoHandle {
    kind: 'corner' | 'via' | 'mid' | 'end';
    owner: string;
    index: number;
}

/**
 * Editing marks over the scene (internal to `IsoEditor`): the handles of the
 * one selected region or connector (their own SVG above every label), the
 * tile cursor and the draft of a connector or region being drawn.
 */
export class IsoOverlay {

    private readonly host: IsoHost;
    private readonly handleG: SVGGElement;
    private readonly draftG: SVGGElement;

    public constructor(host: IsoHost, scene: IsoScene) {
        this.host = host;
        this.handleG = scene.handleG;
        this.draftG = scene.draftG;
    }

    /** Parse a `data-handle` value written by `renderHandles`. */
    public static parseHandle(value: string): IsoHandle {
        const [kind, owner, index] = value.split('|');

        return {kind: kind as IsoHandle['kind'], owner: owner!, index: Number(index)};
    }

    /** Corner handles of one selected region; waypoint, midpoint and end handles of one selected connector. */
    public renderHandles(): void {
        const out: SVGElement[] = [];
        const selected = this.host.selected();

        if (!this.host.readOnly() && this.host.mode() === 'select' && selected.size === 1) {
            const doc = this.host.doc();
            const id = [...selected][0]!;
            const dot = (u: number, v: number, h: IsoHandle, cls = ''): void => {
                const c = document.createElementNS(IsoScene.SVG, 'circle');
                c.setAttribute('class', `iso-handle ${cls}`);
                c.setAttribute('cx', String(u));
                c.setAttribute('cy', String(v));
                c.setAttribute('r', cls === 'iso-handle-mid' ? '0.15' : '0.2');
                c.dataset.handle = `${h.kind}|${h.owner}|${h.index}`;
                out.push(c);
            };
            const region = doc.regions.find((r) => r.id === id);
            if (region !== undefined) {
                const {x0, y0, x1, y1} = IsoProjection.rect(region.from, region.to);
                [[x0, y0], [x1 + 1, y0], [x1 + 1, y1 + 1], [x0, y1 + 1]].forEach(([u, v], i) => dot(u!, v!, {kind: 'corner', owner: id, index: i}));
            }
            const conn = doc.connectors.find((c) => c.id === id);
            const r = conn !== undefined ? IsoScene.route(doc, conn) : null;
            if (conn !== undefined && r !== null) {
                for (let k = 0; k + 3 < r.line.length; k += 2) {
                    const len = Math.hypot(r.line[k + 2]! - r.line[k]!, r.line[k + 3]! - r.line[k + 1]!);
                    if (len >= 3) {
                        dot((r.line[k]! + r.line[k + 2]!) / 2, (r.line[k + 1]! + r.line[k + 3]!) / 2, {kind: 'mid', owner: id, index: k / 2}, 'iso-handle-mid');
                    }
                }
                (conn.via ?? []).forEach((t, i) => dot(t.x + 0.5, t.y + 0.5, {kind: 'via', owner: id, index: i}));
                const total = IsoRoute.measure(r.line);
                const a = IsoRoute.atDistance(r.line, IsoScene.endGap(conn.from));
                const b = IsoRoute.atDistance(r.line, total - IsoScene.endGap(conn.to));
                dot(a.u, a.v, {kind: 'end', owner: id, index: 0}, 'iso-handle-end');
                dot(b.u, b.v, {kind: 'end', owner: id, index: 1}, 'iso-handle-end');
            }
        }
        this.handleG.replaceChildren(...out);
    }

    public drawCursor(tile: IsoTile | null): void {
        this.draftG.querySelector('.iso-cursor')?.remove();
        if (tile === null) {
            return;
        }
        const rect = document.createElementNS(IsoScene.SVG, 'rect');
        rect.setAttribute('class', 'iso-cursor');
        rect.setAttribute('x', String(tile.x + 0.04));
        rect.setAttribute('y', String(tile.y + 0.04));
        rect.setAttribute('width', '0.92');
        rect.setAttribute('height', '0.92');
        rect.setAttribute('rx', '0.14');
        this.draftG.appendChild(rect);
    }

    /**
     * Draft of a region being dragged out (`region`), else of a connector
     * from tile `from` to tile `to` (nothing when either is missing).
     */
    public drawDraft(region: {start: IsoTile; end: IsoTile} | null, from: IsoTile | null, to: IsoTile | null): void {
        for (const el of [...this.draftG.querySelectorAll('.iso-draft')]) {
            el.remove();
        }
        if (region !== null) {
            const {x0, y0, x1, y1} = IsoProjection.rect(region.start, region.end);
            const rect = document.createElementNS(IsoScene.SVG, 'rect');
            rect.setAttribute('class', 'iso-draft iso-draft-region');
            rect.setAttribute('x', String(x0 + 0.05));
            rect.setAttribute('y', String(y0 + 0.05));
            rect.setAttribute('width', String(x1 - x0 + 0.9));
            rect.setAttribute('height', String(y1 - y0 + 0.9));
            rect.setAttribute('rx', '0.35');
            this.draftG.appendChild(rect);
            return;
        }
        if (from !== null && to !== null) {
            const blocked = IsoScene.blocked(this.host.doc());
            const line = IsoRoute.centres(IsoRoute.corners(IsoRoute.route(from, to, [], {blocked})));
            const path = document.createElementNS(IsoScene.SVG, 'path');
            path.setAttribute('class', 'iso-draft iso-draft-line');
            path.setAttribute('d', IsoRoute.pathData(line.length >= 4 ? line : [...line, ...line]));
            this.draftG.appendChild(path);
        }
    }

}
