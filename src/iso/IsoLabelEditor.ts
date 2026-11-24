import { IsoHost } from './IsoHost';
import { IsoIcons } from './IsoIcons';
import { IsoModel } from './IsoModel';
import { IsoProjection } from './IsoProjection';
import { IsoRoute } from './IsoRoute';
import { IsoScene } from './IsoScene';

/**
 * Inline label editor (internal to `IsoEditor`): an input over the label of
 * an item, connector or region, or over a floor text. Enter / blur commit
 * (an empty text is removed, an empty label cleared), Escape cancels.
 */
export class IsoLabelEditor {

    private readonly host: IsoHost;
    private readonly proj: IsoProjection;
    private session: {el: HTMLInputElement; done: (commit: boolean) => void} | null = null;

    public constructor(host: IsoHost) {
        this.host = host;
        this.proj = host.proj;
    }

    /** True while an input is open. */
    public get active(): boolean {
        return this.session !== null;
    }

    /** Close an open input, committing or discarding its value. */
    public close(commit: boolean): void {
        this.session?.done(commit);
    }

    /** Open the editor over the label of an item, connector or region, or over a text (no-op read-only). */
    public open(id: string): void {
        const kind = IsoModel.kindOf(this.host.doc(), id);

        if (kind === null || this.host.readOnly()) {
            return;
        }
        const el = this.host.root.querySelector<HTMLElement>(
            kind === 'item' ? `.iso-label[data-item="${CSS.escape(id)}"]` : kind === 'connector' ? `.iso-conn-label[data-connector="${CSS.escape(id)}"]` : '.none');
        const r = this.host.root.getBoundingClientRect();
        let x: number, y: number;

        if (el !== null) {
            const b = el.getBoundingClientRect();
            x = b.left + b.width / 2 - r.left;
            y = b.top + b.height / 2 - r.top;
        } else {
            const w = this.labelWorld(id);
            const s = this.host.camera.toScreen(w.x, w.y);
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
        this.host.root.appendChild(input);
        input.focus();
        input.select();
        const done = (commit: boolean): void => {
            if (this.session?.el !== input) {
                return;
            }
            this.session = null;
            input.remove();
            this.host.root.focus({preventScroll: true});
            if (commit && input.value !== current) {
                this.setLabel(id, input.value);
            }
        };
        this.session = {el: input, done};
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

    private labelOf(id: string): string {
        const doc = this.host.doc();
        const all: Array<{id: string; label?: string; text?: unknown}> = [...doc.items, ...doc.connectors, ...doc.regions, ...doc.texts];
        const x = all.find((e) => e.id === id);

        return x === undefined ? '' : typeof x.text === 'string' ? x.text : x.label ?? '';
    }

    private setLabel(id: string, value: string): void {
        const kind = IsoModel.kindOf(this.host.doc(), id);
        const v = value.trim();

        if (kind === 'text') {
            if (v === '') {
                this.host.remove([id]);
            } else {
                this.host.updateText(id, {text: v});
            }
            return;
        }
        const target = kind === 'item' ? this.host.doc().items.find((i) => i.id === id)
            : kind === 'connector' ? this.host.doc().connectors.find((c) => c.id === id) : this.host.doc().regions.find((r) => r.id === id);
        if (target === undefined) {
            return;
        }
        if (v === '') {
            delete target.label;
        } else {
            target.label = v;
        }
        this.host.commit('update', [id]);
    }

    /** World point where an element's label sits (for the inline editor when no label is drawn yet). */
    private labelWorld(id: string): {x: number; y: number} {
        const it = this.host.doc().items.find((i) => i.id === id);
        if (it !== undefined) {
            const c = this.proj.center(it.tile);
            return {x: c.x, y: c.y - (this.host.iconType(it.icon).height ?? 70) * this.proj.tileW / IsoIcons.W - this.proj.tileH};
        }
        const c = this.host.doc().connectors.find((x) => x.id === id);
        if (c !== undefined) {
            const r = IsoScene.route(this.host.doc(), c);
            const p = r !== null ? IsoRoute.at(r.line, c.labelAt ?? 0.5) : {u: 0, v: 0};
            return this.proj.toWorld(p.u, p.v);
        }
        const g = this.host.doc().regions.find((x) => x.id === id);
        if (g !== undefined) {
            const r = IsoProjection.rect(g.from, g.to);
            return this.proj.toWorld(r.x0 + 1, r.y1 + 0.6);
        }
        const t = this.host.doc().texts.find((x) => x.id === id);

        return t !== undefined ? this.proj.toWorld(t.tile.x + 1, t.tile.y + 0.5) : {x: 0, y: 0};
    }

}
