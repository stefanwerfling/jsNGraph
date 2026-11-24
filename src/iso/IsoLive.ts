import { IsoHost } from './IsoHost';
import { IsoIcons } from './IsoIcons';
import { IsoProjection } from './IsoProjection';
import { IsoScene } from './IsoScene';
import { IsoActor, IsoConnectorStatus, IsoItemStatus } from './IsoTypes';

/**
 * Live display state over the scene (internal to `IsoEditor`, not document
 * data): item status (floor ring, status line and progress bar in the label),
 * connector status (active / colour) and the moving actors, whose elements are
 * kept per id. Status survives redraws via `reapply`.
 */
export class IsoLive {

    private readonly host: IsoHost;
    private readonly proj: IsoProjection;
    private readonly statusG: SVGGElement;
    private readonly connG: SVGGElement;
    private readonly labelLayer: HTMLDivElement;
    private readonly actorLayer: HTMLDivElement;
    private readonly itemStatus = new Map<string, IsoItemStatus>();
    private readonly connStatus = new Map<string, IsoConnectorStatus>();
    private readonly actorEls = new Map<string, HTMLDivElement>();

    public constructor(host: IsoHost, scene: IsoScene) {
        this.host = host;
        this.proj = host.proj;
        this.statusG = scene.statusG;
        this.connG = scene.connG;
        this.labelLayer = scene.labelLayer;
        this.actorLayer = scene.actorLayer;
    }

    /** Draw every known status again after the scene was redrawn. */
    public reapply(): void {
        this.statusG.replaceChildren();
        for (const id of this.itemStatus.keys()) {
            this.applyItemStatus(id);
        }
        for (const id of this.connStatus.keys()) {
            this.applyConnectorStatus(id);
        }
    }

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
                el.innerHTML = IsoIcons.svg(this.host.iconType(a.icon), a.color);
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

    private applyItemStatus(id: string): void {
        const st = this.itemStatus.get(id);
        const it = this.host.doc().items.find((i) => i.id === id);

        this.statusG.querySelector(`[data-status="${CSS.escape(id)}"]`)?.remove();
        const label = this.labelLayer.querySelector<HTMLElement>(`.iso-label[data-item="${CSS.escape(id)}"]`);
        label?.querySelector('.iso-st')?.remove();
        label?.querySelector('.iso-progress')?.remove();
        if (st === undefined || it === undefined) {
            return;
        }
        const ring = document.createElementNS(IsoScene.SVG, 'rect');
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
        const c = this.host.doc().connectors.find((x) => x.id === id);
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

}
