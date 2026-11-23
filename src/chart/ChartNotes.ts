import { Color } from '../util/Color';
import { ChartThemeTokens } from './ChartTheme';

/** A note pinned to a data point, with an optional pointer line (newsroom style). */
export interface ChartNote {
    /** Data x of the anchor (for category charts: the category index or name). */
    x: number | string;
    /** Data y of the anchor (default: chosen by the chart, e.g. the top of the data at x). */
    y?: number;
    /** Panel index or id, for charts with several panels (default 0). */
    panel?: number | string;
    /** Text; `**bold**` is bold, `\n` breaks. */
    text: string;
    /** Text (and border) colour; default the theme's title colour. */
    color?: string;
    /** Box offset from the anchor in px (default 30, -30 → up-right). */
    dx?: number;
    dy?: number;
    /** Box width in px (default 140). */
    width?: number;
    /** Text alignment (default: towards the anchor side — left when the box is right of it). */
    align?: 'left' | 'center' | 'right';
    /** Pointer from the box to the anchor: 'curve' (default), 'straight' or false. */
    arrow?: 'curve' | 'straight' | false;
    /** Draw a framed box instead of plain text (default false). */
    box?: boolean;
}

/** A resolved anchor in chart pixels; null hides the note. */
export type NoteAnchor = {x: number; y: number} | null;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * DOM note layer for the canvas charts: text boxes over the canvas (crisp,
 * selectable) and their pointer lines in one SVG. The chart resolves each
 * note's anchor to pixels on every frame and calls `place`.
 */
export class ChartNotes {

    private readonly layer: HTMLDivElement;
    private readonly svg: SVGSVGElement;
    private notes: ChartNote[] = [];
    private theme: ChartThemeTokens;

    public constructor(root: HTMLElement, theme: ChartThemeTokens) {
        this.theme = theme;
        this.layer = document.createElement('div');
        this.layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;transition:opacity .15s';
        this.svg = document.createElementNS(SVG_NS, 'svg');
        this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible';
        this.layer.appendChild(this.svg);
        root.appendChild(this.layer);
    }

    public get list(): ReadonlyArray<ChartNote> {
        return this.notes;
    }

    public set(notes: ChartNote[]): void {
        this.notes = notes.slice();
        this.build();
    }

    public setTheme(theme: ChartThemeTokens): void {
        this.theme = theme;
        this.build();
    }

    /**
     * Position every note: `anchor(note, i)` gives its anchor in px, `bounds`
     * keeps the boxes inside (top/bottom limits of the plot area).
     */
    public place(anchor: (note: ChartNote, index: number) => NoteAnchor, bounds: {width: number; top: number; bottom: number}): void {
        const boxes = Array.from(this.layer.querySelectorAll<HTMLDivElement>(':scope > div'));
        const paths: string[] = [];
        const heads: string[] = [];

        this.notes.forEach((note, i) => {
            const el = boxes[i];
            const a = anchor(note, i);

            if (el === undefined) {
                return;
            }
            if (a === null) {
                el.style.display = 'none';
                return;
            }

            el.style.display = 'block';

            const w = el.offsetWidth;
            const h = el.offsetHeight;
            const dx = note.dx ?? 30;
            const dy = note.dy ?? -30;
            const left = Math.max(2, Math.min(bounds.width - w - 2, dx >= 0 ? a.x + dx : a.x + dx - w));
            const top = Math.max(bounds.top, Math.min(bounds.bottom - h, dy <= 0 ? a.y + dy - h : a.y + dy));

            el.style.left = `${left}px`;
            el.style.top = `${top}px`;

            if (note.arrow === false) {
                return;
            }

            const line = ChartNotes.pointer({x: left, y: top, w, h}, a, note.arrow ?? 'curve');

            if (line !== null) {
                paths.push(line.path);
                heads.push(line.head);
            }
        });

        const color = this.theme.text;

        this.svg.innerHTML = paths.map((d) =>
            `<path d="${d}" fill="none" stroke="${color}" stroke-width="1" stroke-linecap="round"/>`).join('')
            + heads.map((d) => `<path d="${d}" fill="${color}"/>`).join('');
    }

    /** Fade the notes back (e.g. while the chart shows a tooltip under them). */
    public setDimmed(dimmed: boolean): void {
        this.layer.style.opacity = dimmed ? '0.2' : '';
    }

    public destroy(): void {
        this.layer.remove();
    }

    /**
     * The pointer from a box to its anchor: starts on the box edge nearest the
     * anchor, ends a little short of it with a small arrowhead. null when the
     * anchor lies inside (or right next to) the box.
     */
    public static pointer(box: {x: number; y: number; w: number; h: number}, a: {x: number; y: number}, kind: 'curve' | 'straight'): {path: string; head: string} | null {
        const insideX = a.x >= box.x && a.x <= box.x + box.w;
        const insideY = a.y >= box.y && a.y <= box.y + box.h;

        if (insideX && insideY) {
            return null;
        }

        // above/below: leave from the facing edge right over the anchor; beside: from the
        // middle of the facing side
        const start = {
            x: insideX ? a.x : a.x < box.x ? box.x - 3 : box.x + box.w + 3,
            y: insideY || !insideX ? box.y + box.h / 2 : a.y < box.y ? box.y - 3 : box.y + box.h + 3
        };

        if (!insideX && !insideY) {
            // diagonal: from the corner side nearest the anchor
            start.y = a.y < box.y ? box.y + 4 : box.y + box.h - 4;
        }

        const len = Math.hypot(a.x - start.x, a.y - start.y);

        if (len < 10) {
            return null;
        }

        const ux = (a.x - start.x) / len;
        const uy = (a.y - start.y) / len;
        const end = {x: a.x - ux * 3, y: a.y - uy * 3};
        const f = (n: number): string => n.toFixed(1);
        let path: string;
        let tx = ux;
        let ty = uy;

        if (kind === 'curve') {
            // bend sideways by a quarter of the length; the end tangent sets the head
            const bend = len * 0.28;
            const c = {x: (start.x + end.x) / 2 - uy * bend, y: (start.y + end.y) / 2 + ux * bend};
            const tl = Math.hypot(end.x - c.x, end.y - c.y) || 1;

            tx = (end.x - c.x) / tl;
            ty = (end.y - c.y) / tl;
            path = `M${f(start.x)},${f(start.y)} Q${f(c.x)},${f(c.y)} ${f(end.x)},${f(end.y)}`;
        } else {
            path = `M${f(start.x)},${f(start.y)} L${f(end.x)},${f(end.y)}`;
        }

        const s = 5;
        const head = `M${f(end.x + tx)},${f(end.y + ty)}`
            + ` L${f(end.x - tx * s - ty * s * 0.55)},${f(end.y - ty * s + tx * s * 0.55)}`
            + ` L${f(end.x - tx * s + ty * s * 0.55)},${f(end.y - ty * s - tx * s * 0.55)}Z`;

        return {path, head};
    }

    private build(): void {
        for (const old of Array.from(this.layer.querySelectorAll(':scope > div'))) {
            old.remove();
        }

        for (const note of this.notes) {
            const el = document.createElement('div');
            const color = note.color ?? this.theme.title;
            const align = note.align ?? ((note.dx ?? 30) >= 0 ? 'left' : 'right');

            el.style.cssText = `position:absolute;display:none;width:${note.width ?? 140}px;color:${color};text-align:${align};`
                + 'font:11px/1.3 system-ui,-apple-system,sans-serif;white-space:pre-line;'
                + (note.box === true
                    ? `padding:5px 7px;border:1px solid ${color};border-radius:5px;background:${Color.withAlpha(this.theme.background, 0.9)}`
                    : `text-shadow:0 0 3px ${this.theme.background},0 0 3px ${this.theme.background}`);
            for (const [i, part] of note.text.split('**').entries()) {
                if (i % 2 === 1) {
                    const b = document.createElement('b');
                    b.textContent = part;
                    el.appendChild(b);
                } else if (part !== '') {
                    el.appendChild(document.createTextNode(part));
                }
            }
            this.layer.appendChild(el);
        }
    }

}
