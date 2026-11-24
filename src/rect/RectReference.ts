import { RectColor } from './RectColor';
import { RectGlossaryOptions, RectSymbolsOptions } from './RectKitTypes';

/** Shared panel shell of the reference panels (internal). */
class RectPanel {

    /** A titled, rounded dark container. */
    public static shell(title: string | undefined, subtitle: string | undefined): HTMLDivElement {
        const el = document.createElement('div');
        el.style.cssText = `
            display: inline-flex; flex-direction: column; gap: 10px;
            padding: 16px 18px; border-radius: 12px;
            background: rgba(15, 20, 32, 0.72); border: 1px solid #2b3550;
            color: #e8eefc; font-family: system-ui, sans-serif;
        `;

        if (title !== undefined) {
            const h = document.createElement('div');
            h.textContent = title;
            h.style.cssText = 'font-size:18px; font-weight:800; color:#fff;';
            el.appendChild(h);
        }
        if (subtitle !== undefined) {
            const s = document.createElement('div');
            s.textContent = subtitle;
            s.style.cssText = 'font-size:12px; color:#8595b5; line-height:1.4; margin-top:-6px;';
            el.appendChild(s);
        }

        return el;
    }

}

/**
 * A symbols reference table: each row pairs a coloured glyph with a name, an
 * optional shape/type and a dim note — the "Σ Symbols" key of an explainer.
 */
export class RectSymbols {

    public constructor(private readonly options: RectSymbolsOptions) {}

    public render(): HTMLDivElement {
        const o = this.options;
        const el = RectPanel.shell(o.title, o.subtitle);

        const hasType = o.items.some((i) => i.type !== undefined);
        const hasNote = o.items.some((i) => i.note !== undefined);
        const cols = ['38px', 'auto', hasType ? 'auto' : '', hasNote ? 'minmax(120px, 1fr)' : '']
            .filter((c) => c !== '').join(' ');

        const grid = document.createElement('div');
        grid.style.cssText = `display:grid; grid-template-columns:${cols}; row-gap:7px; column-gap:18px; align-items:baseline; margin-top:4px;`;

        const header = (text: string): HTMLSpanElement => {
            const s = document.createElement('span');
            s.textContent = text;
            s.style.cssText = 'font-size:9px; font-weight:700; letter-spacing:0.1em; color:#5f6f93;';
            return s;
        };
        grid.appendChild(header('SYMBOL'));
        grid.appendChild(header('NAME'));
        if (hasType) grid.appendChild(header('TYPE'));
        if (hasNote) grid.appendChild(header('NOTE'));

        for (const item of o.items) {
            const sym = document.createElement('span');
            sym.textContent = item.symbol;
            sym.style.cssText = `font-size:14px; font-weight:700; font-style:italic; font-family:Georgia,serif; color:${RectColor.resolve(item.color, 'cyan')};`;
            grid.appendChild(sym);

            const name = document.createElement('span');
            name.textContent = item.name;
            name.style.cssText = 'font-size:12px; font-weight:700;';
            grid.appendChild(name);

            if (hasType) {
                const type = document.createElement('span');
                type.textContent = item.type ?? '';
                type.style.cssText = 'font-size:11.5px; color:#9aa8c6;';
                grid.appendChild(type);
            }
            if (hasNote) {
                const note = document.createElement('span');
                note.textContent = item.note ?? '';
                note.style.cssText = 'font-size:11.5px; color:#6f7fa0;';
                grid.appendChild(note);
            }
        }

        el.appendChild(grid);

        return el;
    }

}

/**
 * A glossary / vocabulary panel: term headwords with their definitions, flowed
 * into one or more columns.
 */
export class RectGlossary {

    public constructor(private readonly options: RectGlossaryOptions) {}

    public render(): HTMLDivElement {
        const o = this.options;
        const el = RectPanel.shell(o.title, o.subtitle);
        const accent = RectColor.resolve(o.accent, 'cyan');

        const list = document.createElement('div');
        const columns = Math.max(1, o.columns ?? 1);
        list.style.cssText = `display:grid; grid-template-columns:repeat(${columns}, minmax(0, 1fr)); gap:12px 26px; margin-top:4px;`;

        for (const t of o.terms) {
            const entry = document.createElement('div');
            entry.style.cssText = 'display:flex; flex-direction:column; gap:2px;';

            const term = document.createElement('span');
            term.textContent = t.term;
            term.style.cssText = `font-size:12.5px; font-weight:700; color:${accent};`;
            entry.appendChild(term);

            const def = document.createElement('span');
            def.textContent = t.def;
            def.style.cssText = 'font-size:11.5px; color:#8595b5; line-height:1.4;';
            entry.appendChild(def);

            list.appendChild(entry);
        }

        el.appendChild(list);

        return el;
    }

}
