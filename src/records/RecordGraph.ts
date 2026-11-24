import { Color } from '../util/Color';
import { EventEmitter } from '../util/EventEmitter';
import { Point } from '../util/Geometry';
import { Camera } from '../view/Camera';
import { RenderLoop } from '../view/RenderLoop';
import { RecordIcons } from './RecordIcons';
import { PlacedGroup, PlacedLink, PlacedRecord, RecordLayout, RecordLayoutOptions, RecordLayoutResult } from './RecordLayout';
import { RecordLineage, RecordQuery } from './RecordQuery';
import { RecordTheme, RecordThemeTokens } from './RecordTheme';
import { RecordGraphData, RecordNode, RecordPort } from './RecordTypes';

export interface RecordGraphOptions {
    data?: RecordGraphData;
    theme?: 'light' | 'dark' | Partial<RecordThemeTokens>;
    layout?: RecordLayoutOptions;
    /** A "+" on the hovered row produces one unit (`RecordQuery.produce`). Default false. */
    produce?: boolean;
    /** Wheel zoom, drag pan, double-click fit. Default true. */
    panZoom?: boolean;
    /** Font family of all text. Default Inter with system fallbacks (not bundled). */
    font?: string;
}

export interface RecordGraphEvents extends Record<string, unknown> {
    rowClick: RecordPort;
    linkClick: {ids: string[]; from: RecordPort; to: RecordPort};
    hover: {row: RecordPort | null; link: string[] | null};
    /** After a "+" click: `ok` false when an input ran out (nothing changed). */
    produce: RecordPort & {ok: boolean};
    groupToggle: {group: string; collapsed: boolean};
    /** Highlighted flow changed; empty arrays = cleared. */
    highlightChange: {rows: RecordPort[]; links: string[]};
}

type Hit =
    | {kind: 'row'; port: RecordPort; plus: boolean}
    | {kind: 'link'; link: PlacedLink}
    | {kind: 'group'; group: string}
    | {kind: 'card'; node: string}
    | null;

const CORNER = 4;

/**
 * A record graph on canvas: cards with a header (icon, title, subtitle)
 * and a table of rows; links run row → row, grouped cards sit in
 * collapsible frames. Click a row or a link to light its whole flow (up-
 * and downstream), "+" produces one unit from the inputs, values ≤ 0 turn
 * into alerts. Supply chains, data lineage, schema diagrams. Zero deps.
 */
export class RecordGraph {

    private readonly root: HTMLDivElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly events = new EventEmitter<RecordGraphEvents>();
    private readonly camera = new Camera(0.08, 4);
    private readonly loop: RenderLoop;
    private readonly resizeObserver: ResizeObserver;
    private readonly engine: RecordLayout;
    private readonly produceOn: boolean;
    private readonly panZoom: boolean;
    private readonly font: string;
    private theme: RecordThemeTokens;
    private data: RecordGraphData = {nodes: [], links: [], groups: []};
    private nodeById = new Map<string, RecordNode>();
    private colorOf = new Map<string, string>();
    private result: RecordLayoutResult | null = null;
    private samples = new Map<PlacedLink, Point[]>();
    private lineage: RecordLineage | null = null;
    /** What the current highlight was started from (clicking it again clears). */
    private lineageStart: string | null = null;
    private hovered: Hit = null;
    private width = 0;
    private height = 0;
    private userView = false;
    private press: {x: number; y: number; moved: boolean} | null = null;

    public constructor(container: HTMLElement, options: RecordGraphOptions = {}) {
        this.theme = RecordTheme.resolve(options.theme);
        this.engine = new RecordLayout(options.layout);
        this.produceOn = options.produce ?? false;
        this.panZoom = options.panZoom ?? true;
        this.font = options.font ?? 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

        this.root = document.createElement('div');
        this.root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;touch-action:none;user-select:none';
        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block';
        this.root.appendChild(this.canvas);
        container.appendChild(this.root);

        const ctx = this.canvas.getContext('2d');

        if (ctx === null) {
            throw new Error('RecordGraph: 2d context unavailable');
        }

        this.ctx = ctx;
        this.loop = new RenderLoop((t) => this.frame(t));
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.root);

        this.root.addEventListener('pointerdown', this.onDown);
        this.root.addEventListener('pointermove', this.onMove);
        this.root.addEventListener('pointerup', this.onUp);
        this.root.addEventListener('pointercancel', this.onUp);
        this.root.addEventListener('pointerleave', this.onLeave);
        this.root.addEventListener('wheel', this.onWheel, {passive: false});
        this.root.addEventListener('dblclick', this.onDblClick);

        this.resize();
        this.setData(options.data ?? this.data);
    }

    public get element(): HTMLDivElement {
        return this.root;
    }

    public on<K extends keyof RecordGraphEvents>(event: K, listener: (payload: RecordGraphEvents[K]) => void): void {
        this.events.on(event, listener);
    }

    public off<K extends keyof RecordGraphEvents>(event: K, listener: (payload: RecordGraphEvents[K]) => void): void {
        this.events.off(event, listener);
    }

    // ---- data ------------------------------------------------------------

    public setData(data: RecordGraphData): void {
        this.data = structuredClone({nodes: data.nodes.map((n) => ({...n, icon: typeof n.icon === 'function' ? undefined : n.icon})), links: data.links, groups: data.groups ?? []});
        // Drawer functions cannot be cloned: put them back.
        data.nodes.forEach((n, i) => {
            if (typeof n.icon === 'function') {
                this.data.nodes[i]!.icon = n.icon;
            }
        });
        this.nodeById = new Map(this.data.nodes.map((n) => [n.id, n]));
        this.colorOf = new Map(this.data.nodes.map((n, i) => [n.id, n.color ?? this.theme.palette[i % this.theme.palette.length]!]));
        this.lineage = null;
        this.lineageStart = null;     // else the next click on that row would only "clear"
        this.hovered = null;
        this.userView = false;
        this.relayout();
    }

    /** A copy of the current document (values after `produce`, collapse state). */
    public getData(): RecordGraphData {
        return structuredClone({...this.data, nodes: this.data.nodes.map((n) => ({...n, icon: typeof n.icon === 'function' ? undefined : n.icon}))});
    }

    public getLayout(): RecordLayoutResult | null {
        return this.result;
    }

    /** Change one row's value (no relayout). */
    public setValue(node: string, row: string, value: number | string | undefined): void {
        const r = this.nodeById.get(node)?.rows.find((x) => x.id === row);

        if (r !== undefined) {
            r.value = value;
            this.redraw();
        }
    }

    /** Produce one unit of a row from its inputs; false (nothing changes) when an input ran out. */
    public produce(node: string, row: string): boolean {
        const ok = RecordQuery.produce(this.data, {node, row});

        this.redraw();
        this.events.emit('produce', {node, row, ok});

        return ok;
    }

    // ---- highlight -------------------------------------------------------

    /** Light the flow through a row (null clears). */
    public highlightRow(port: RecordPort | null): void {
        this.lineage = port === null ? null : RecordQuery.lineage(port, this.data.links);
        this.lineageStart = port === null ? null : RecordQuery.key(port);
        this.highlightChanged();
    }

    /** Light the flow through a link (by id). */
    public highlightLink(id: string): void {
        const index = this.data.links.findIndex((l, i) => RecordQuery.linkId(l, i) === id);

        this.lineage = index < 0 ? null : RecordQuery.linkLineage(index, this.data.links);
        this.lineageStart = index < 0 ? null : `link:${id}`;
        this.highlightChanged();
    }

    public clearHighlight(): void {
        this.lineageStart = null;

        if (this.lineage !== null) {
            this.lineage = null;
            this.highlightChanged();
        }
    }

    // ---- groups ----------------------------------------------------------

    public setGroupCollapsed(id: string, collapsed: boolean): void {
        const g = this.data.groups?.find((x) => x.id === id);

        if (g === undefined || (g.collapsed ?? false) === collapsed) {
            return;
        }

        g.collapsed = collapsed;
        this.relayout();
        this.events.emit('groupToggle', {group: id, collapsed});
    }

    public toggleGroup(id: string): void {
        const g = this.data.groups?.find((x) => x.id === id);

        if (g !== undefined) {
            this.setGroupCollapsed(id, !(g.collapsed ?? false));
        }
    }

    // ---- view ------------------------------------------------------------

    public fit(animate = true): void {
        const r = this.result;

        if (r === null || this.width <= 0) {
            return;
        }

        const target = this.camera.fitState(r.bounds, this.width, this.height, 28, 28);

        this.userView = false;
        if (animate) {
            this.camera.flyTo(target, 350);
        } else {
            this.camera.setState(target);
        }
        this.redraw();
    }

    public zoomIn(): void {
        this.zoomBy(1.25);
    }

    public zoomOut(): void {
        this.zoomBy(0.8);
    }

    public setTheme(theme: 'light' | 'dark' | Partial<RecordThemeTokens>): void {
        this.theme = RecordTheme.resolve(theme);
        this.colorOf = new Map(this.data.nodes.map((n, i) => [n.id, n.color ?? this.theme.palette[i % this.theme.palette.length]!]));
        this.redraw();
    }

    public redraw(): void {
        this.loop.request();
    }

    public destroy(): void {
        this.root.removeEventListener('pointerdown', this.onDown);
        this.root.removeEventListener('pointermove', this.onMove);
        this.root.removeEventListener('pointerup', this.onUp);
        this.root.removeEventListener('pointercancel', this.onUp);
        this.root.removeEventListener('pointerleave', this.onLeave);
        this.root.removeEventListener('wheel', this.onWheel);
        this.root.removeEventListener('dblclick', this.onDblClick);
        this.resizeObserver.disconnect();
        this.loop.destroy();
        this.events.clear();
        this.root.remove();
    }

    private zoomBy(f: number): void {
        const s = this.camera.getState();
        const cx = this.width / 2;
        const cy = this.height / 2;
        const scale = s.scale * f;

        this.camera.flyTo({scale, offsetX: cx - (cx - s.offsetX) * f, offsetY: cy - (cy - s.offsetY) * f}, 200);
        this.userView = true;
        this.redraw();
    }

    private highlightChanged(): void {
        const l = this.lineage;
        const rows = l === null ? [] : [...l.rows].map((k) => {
            const [node, row] = k.split('\u0000') as [string, string];
            return {node, row};
        });

        this.events.emit('highlightChange', {rows, links: l === null ? [] : [...l.links]});
        this.redraw();
    }

    private relayout(): void {
        this.result = this.engine.layout(this.data);
        this.samples = new Map(this.result.links.map((l) => [l, RecordGraph.sample(l)]));
        this.hovered = null;
        if (!this.userView) {
            this.fit(false);
        }
        this.redraw();
    }

    private resize(): void {
        const r = this.root.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.width = r.width;
        this.height = r.height;
        this.canvas.width = Math.max(1, Math.round(r.width * dpr));
        this.canvas.height = Math.max(1, Math.round(r.height * dpr));
        if (!this.userView) {
            this.fit(false);
        }
        this.redraw();
    }

    // ---- drawing ---------------------------------------------------------

    private frame(timeMs: number): boolean {
        if (this.width <= 0 || this.height <= 0) {
            return false;
        }

        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;
        const flying = this.camera.step(timeMs);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = this.theme.background;
        ctx.fillRect(0, 0, this.width, this.height);

        const r = this.result;

        if (r === null) {
            return flying;
        }

        ctx.save();
        this.camera.apply(ctx);

        for (const g of r.groups.values()) {
            if (!g.collapsed) {
                this.drawFrame(ctx, g);
            }
        }
        this.drawLinks(ctx, r);
        for (const rec of r.records.values()) {
            this.drawCard(ctx, rec);
        }
        for (const g of r.groups.values()) {
            if (g.collapsed) {
                this.drawCollapsed(ctx, g);
            }
        }
        ctx.restore();

        return flying;
    }

    private fontOf(weight: number, size: number): string {
        return `${weight} ${size}px ${this.font}`;
    }

    /** Text legible at the current zoom? */
    private readable(size: number): boolean {
        return size * this.camera.scale >= 3.5;
    }

    private drawFrame(ctx: CanvasRenderingContext2D, g: PlacedGroup): void {
        const t = this.theme;
        const head = this.engine.options.groupHeader;

        ctx.beginPath();
        ctx.roundRect(g.x, g.y, g.w, g.h, 3);
        ctx.fillStyle = t.frameFill;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = t.frame;
        ctx.stroke();

        ctx.beginPath();
        ctx.roundRect(g.x, g.y, g.w, head, [3, 3, 0, 0]);
        ctx.fillStyle = t.frame;
        ctx.fill();

        if (this.readable(11)) {
            ctx.font = this.fontOf(600, 11);
            ctx.fillStyle = t.frameText;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(this.fit1(ctx, g.label, g.w - 34), g.x + 8, g.y + head / 2 + 0.5);
        }
        this.drawToggle(ctx, g.x + g.w - 18, g.y + (head - 13) / 2, '−', this.hovered?.kind === 'group' && this.hovered.group === g.id);
    }

    private drawToggle(ctx: CanvasRenderingContext2D, x: number, y: number, sign: string, hot: boolean): void {
        const t = this.theme;

        ctx.beginPath();
        ctx.roundRect(x, y, 13, 13, 2);
        ctx.fillStyle = hot ? t.highlight : t.frameText;
        ctx.fill();
        ctx.strokeStyle = t.frame;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x + 3.5, y + 6.5);
        ctx.lineTo(x + 9.5, y + 6.5);
        if (sign === '+') {
            ctx.moveTo(x + 6.5, y + 3.5);
            ctx.lineTo(x + 6.5, y + 9.5);
        }
        ctx.stroke();
    }

    private drawCollapsed(ctx: CanvasRenderingContext2D, g: PlacedGroup): void {
        const t = this.theme;
        const lit = this.lineage !== null && g.members.some((m) => this.nodeById.get(m)?.rows.some((r) => this.lineage!.rows.has(RecordQuery.key({node: m, row: r.id}))));
        const hot = this.hovered?.kind === 'group' && this.hovered.group === g.id;

        this.shadow(ctx, true);
        ctx.beginPath();
        ctx.roundRect(g.x, g.y, g.w, g.h, CORNER);
        ctx.fillStyle = t.frame;
        ctx.fill();
        this.shadow(ctx, false);
        if (lit) {
            ctx.lineWidth = 3;
            ctx.strokeStyle = t.highlight;
            ctx.stroke();
        }

        if (this.readable(11)) {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = t.frameText;
            ctx.font = this.fontOf(600, 12);
            ctx.fillText(this.fit1(ctx, g.label, g.w - 40), g.x + 10, g.y + g.h / 2 - 7);
            ctx.font = this.fontOf(400, 10);
            ctx.globalAlpha = 0.75;
            ctx.fillText(`${g.members.length} records`, g.x + 10, g.y + g.h / 2 + 9);
            ctx.globalAlpha = 1;
        }
        this.drawToggle(ctx, g.x + g.w - 21, g.y + (g.h - 13) / 2, '+', hot);
    }

    private shadow(ctx: CanvasRenderingContext2D, on: boolean): void {
        const k = this.camera.scale;

        ctx.shadowColor = on ? this.theme.shadow : 'transparent';
        ctx.shadowBlur = on ? 8 * k : 0;
        ctx.shadowOffsetY = on ? 2 * k : 0;
    }

    private drawLinks(ctx: CanvasRenderingContext2D, r: RecordLayoutResult): void {
        const t = this.theme;
        const lit = (l: PlacedLink): boolean => this.lineage !== null && l.ids.some((id) => this.lineage!.links.has(id));
        const hot = this.hovered?.kind === 'link' ? this.hovered.link : null;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = t.link;
        ctx.beginPath();
        for (const l of r.links) {
            if (!lit(l) && l !== hot) {
                this.tracePath(ctx, l);
            }
        }
        ctx.stroke();

        if (this.lineage !== null) {
            ctx.lineWidth = 2.8;
            ctx.strokeStyle = t.highlight;
            ctx.beginPath();
            for (const l of r.links) {
                if (lit(l)) {
                    this.tracePath(ctx, l);
                }
            }
            ctx.stroke();
        }

        if (hot !== null) {
            ctx.lineWidth = lit(hot) ? 3.6 : 2.4;
            ctx.strokeStyle = lit(hot) ? t.highlight : t.linkHover;
            ctx.beginPath();
            this.tracePath(ctx, hot);
            ctx.stroke();
        }
    }

    private tracePath(ctx: CanvasRenderingContext2D, l: PlacedLink): void {
        const p = l.points;
        const a = p[0]!;

        ctx.moveTo(a.x, a.y);
        if (l.kind === 'forward') {
            const b = p[1]!;
            const dx = Math.max(30, (b.x - a.x) * 0.5);

            ctx.bezierCurveTo(a.x + dx, a.y, b.x - dx, b.y, b.x, b.y);
            return;
        }
        for (let i = 1; i < p.length - 1; i++) {
            ctx.arcTo(p[i]!.x, p[i]!.y, p[i + 1]!.x, p[i + 1]!.y, 8);
        }
        ctx.lineTo(p[p.length - 1]!.x, p[p.length - 1]!.y);
    }

    private drawCard(ctx: CanvasRenderingContext2D, rec: PlacedRecord): void {
        const node = this.nodeById.get(rec.id);

        if (node === undefined) {
            return;
        }

        const t = this.theme;
        const o = this.engine.options;
        const accent = this.colorOf.get(rec.id)!;
        const head = o.headerHeight;
        const {x, y, w, h} = rec;

        // body
        this.shadow(ctx, true);
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, CORNER);
        ctx.fillStyle = t.card;
        ctx.fill();
        this.shadow(ctx, false);

        // header
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, CORNER);
        ctx.clip();
        ctx.fillStyle = Color.lerp(t.card, accent, 0.22);
        ctx.fillRect(x, y, w, head);
        ctx.fillStyle = accent;
        ctx.fillRect(x, y, w, 3);

        const box = head - 12;

        ctx.fillRect(x + 6, y + 7, box, box);
        if (typeof node.icon === 'function') {
            node.icon(ctx, x + 6 + box / 2, y + 7 + box / 2, box * 0.62, '#ffffff');
        } else if (node.icon !== undefined) {
            RecordIcons.draw(ctx, node.icon, x + 6 + box / 2, y + 7 + box / 2, box * 0.62, '#ffffff');
        }

        if (this.readable(12)) {
            const tx = x + box + 13;
            const tw = w - box - 19;

            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = t.text;
            ctx.font = this.fontOf(700, 11.5);

            const title = this.wrap(ctx, node.title, tw, 2);
            let ty = y + 19;

            for (const line of title) {
                ctx.fillText(line, tx, ty);
                ty += 12.5;
            }
            if (node.subtitle !== undefined && title.length < 2) {
                ctx.font = this.fontOf(400, 9);
                ctx.fillStyle = t.muted;
                for (const line of this.wrap(ctx, node.subtitle, tw, 2)) {
                    ctx.fillText(line, tx, ty + 1);
                    ty += 10.5;
                }
            }
        }

        // rows
        const lin = this.lineage;
        const hoverRow = this.hovered?.kind === 'row' && this.hovered.port.node === rec.id ? this.hovered : null;

        node.rows.forEach((row, i) => {
            const top = y + head + i * o.rowHeight;
            const lit = lin?.rows.has(RecordQuery.key({node: rec.id, row: row.id})) ?? false;
            const alert = typeof row.value === 'number' && row.value <= 0;
            const hovered = hoverRow !== null && hoverRow.port.row === row.id;
            let ink = t.text;

            if (lit || alert) {
                ctx.fillStyle = alert ? t.alert : t.highlight;
                ctx.fillRect(x, top, w, o.rowHeight);
                ink = alert ? t.alertText : t.highlightText;
            } else if (hovered) {
                ctx.fillStyle = t.rowHover;
                ctx.fillRect(x, top, w, o.rowHeight);
            }

            if (this.readable(10.5)) {
                const cy = top + o.rowHeight / 2 + 0.5;
                const value = row.value === undefined ? '' : String(row.value);

                ctx.textBaseline = 'middle';
                ctx.font = this.fontOf(700, 10.5);

                const vw = value === '' ? 0 : ctx.measureText(value).width;

                ctx.textAlign = 'right';
                ctx.fillStyle = alert || lit ? ink : t.value;
                ctx.fillText(value, x + w - 8, cy);

                const plus = this.produceOn && hovered && typeof row.value === 'number';
                const reserve = vw + 14 + (plus ? 18 : 0);

                ctx.textAlign = 'left';
                ctx.font = this.fontOf(400, 10.5);
                ctx.fillStyle = ink;
                ctx.fillText(this.fit1(ctx, row.label, w - 8 - reserve), x + 8, cy);

                if (plus) {
                    const px = x + w - 8 - vw - 13;
                    const hotPlus = hoverRow?.plus === true;

                    ctx.beginPath();
                    ctx.arc(px, cy - 0.5, 6, 0, Math.PI * 2);
                    ctx.fillStyle = hotPlus ? t.highlight : t.card;
                    ctx.fill();
                    ctx.lineWidth = 1;
                    ctx.strokeStyle = ink;
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(px - 3, cy - 0.5);
                    ctx.lineTo(px + 3, cy - 0.5);
                    ctx.moveTo(px, cy - 3.5);
                    ctx.lineTo(px, cy + 2.5);
                    ctx.stroke();
                }
            }
        });
        ctx.restore();

        // header / rows separator and border
        ctx.beginPath();
        ctx.moveTo(x, y + head + 0.5);
        ctx.lineTo(x + w, y + head + 0.5);
        ctx.strokeStyle = Color.withAlpha(t.cardBorder, 0.7);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, CORNER);
        ctx.strokeStyle = t.cardBorder;
        ctx.stroke();
    }

    /** One line, ellipsised to `max` px. */
    private fit1(ctx: CanvasRenderingContext2D, text: string, max: number): string {
        if (ctx.measureText(text).width <= max) {
            return text;
        }

        let s = text;

        while (s.length > 1 && ctx.measureText(s + '…').width > max) {
            s = s.slice(0, -1);
        }

        return s + '…';
    }

    /** Word wrap into at most `lines` lines (the last one ellipsised). */
    private wrap(ctx: CanvasRenderingContext2D, text: string, max: number, lines: number): string[] {
        const words = text.split(/\s+/);
        const out: string[] = [];
        let line = '';

        for (let i = 0; i < words.length; i++) {
            const next = line === '' ? words[i]! : `${line} ${words[i]}`;

            if (ctx.measureText(next).width <= max || line === '') {
                line = next;
                continue;
            }
            if (out.length === lines - 1) {
                out.push(this.fit1(ctx, `${line} ${words.slice(i).join(' ')}`, max));
                return out;
            }
            out.push(line);
            line = words[i]!;
        }
        if (line !== '') {
            out.push(this.fit1(ctx, line, max));
        }

        return out;
    }

    // ---- hit testing -----------------------------------------------------

    /** Polyline of a route (bezier sampled), world coords. */
    private static sample(l: PlacedLink): Point[] {
        const p = l.points;

        if (l.kind !== 'forward') {
            return p.slice();
        }

        const a = p[0]!;
        const b = p[1]!;
        const dx = Math.max(30, (b.x - a.x) * 0.5);
        const out: Point[] = [];

        for (let i = 0; i <= 20; i++) {
            const t = i / 20;
            const u = 1 - t;
            const x = u * u * u * a.x + 3 * u * u * t * (a.x + dx) + 3 * u * t * t * (b.x - dx) + t * t * t * b.x;
            const y = u * u * u * a.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t * t * t * b.y;

            out.push({x, y});
        }

        return out;
    }

    private hit(sx: number, sy: number): Hit {
        const r = this.result;

        if (r === null) {
            return null;
        }

        const {x, y} = this.camera.toWorld(sx, sy);
        const o = this.engine.options;

        for (const g of r.groups.values()) {
            if (g.collapsed) {
                if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) {
                    return {kind: 'group', group: g.id};
                }
            } else if (x >= g.x + g.w - 22 && x <= g.x + g.w && y >= g.y && y <= g.y + o.groupHeader) {
                return {kind: 'group', group: g.id};
            }
        }

        for (const rec of r.records.values()) {
            if (x < rec.x || x > rec.x + rec.w || y < rec.y || y > rec.y + rec.h) {
                continue;
            }

            const i = Math.floor((y - rec.y - o.headerHeight) / o.rowHeight);
            const row = this.nodeById.get(rec.id)?.rows[i];

            if (row === undefined) {
                return {kind: 'card', node: rec.id};
            }

            let plus = false;

            if (this.produceOn && typeof row.value === 'number') {
                this.ctx.font = this.fontOf(700, 10.5);

                const vw = this.ctx.measureText(String(row.value)).width;
                const px = rec.x + rec.w - 8 - vw - 13;
                const cy = rec.y + o.headerHeight + (i + 0.5) * o.rowHeight;

                plus = Math.hypot(x - px, y - cy) <= Math.max(8, 9 / this.camera.scale);
            }

            return {kind: 'row', port: {node: rec.id, row: row.id}, plus};
        }

        const tol = 5 / this.camera.scale;
        let best: PlacedLink | null = null;
        let bestD = tol;

        for (const l of r.links) {
            const pts = this.samples.get(l)!;

            for (let i = 1; i < pts.length; i++) {
                const d = RecordGraph.segDist(x, y, pts[i - 1]!, pts[i]!);

                if (d < bestD) {
                    bestD = d;
                    best = l;
                }
            }
        }

        return best === null ? null : {kind: 'link', link: best};
    }

    private static segDist(px: number, py: number, a: Point, b: Point): number {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = dx * dx + dy * dy;
        const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len));

        return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
    }

    private static same(a: Hit, b: Hit): boolean {
        if (a === null || b === null) {
            return a === b;
        }
        if (a.kind === 'row' && b.kind === 'row') {
            return a.port.node === b.port.node && a.port.row === b.port.row && a.plus === b.plus;
        }
        if (a.kind === 'link' && b.kind === 'link') {
            return a.link === b.link;
        }
        if (a.kind === 'group' && b.kind === 'group') {
            return a.group === b.group;
        }
        if (a.kind === 'card' && b.kind === 'card') {
            return a.node === b.node;
        }

        return false;
    }

    // ---- input -----------------------------------------------------------

    private local(e: MouseEvent): {x: number; y: number} {
        const r = this.root.getBoundingClientRect();

        return {x: e.clientX - r.left, y: e.clientY - r.top};
    }

    private readonly onDown = (e: PointerEvent): void => {
        if (e.button !== 0) {
            return;
        }

        const p = this.local(e);

        this.press = {x: p.x, y: p.y, moved: false};
        this.root.setPointerCapture(e.pointerId);
    };

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);
        const press = this.press;

        if (press !== null) {
            if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) > 3) {
                press.moved = true;
            }
            if (press.moved && this.panZoom) {
                this.camera.panBy(e.movementX, e.movementY);
                this.userView = true;
                this.root.style.cursor = 'grabbing';
                this.redraw();
            }
            return;
        }

        const hit = this.hit(p.x, p.y);

        this.root.style.cursor = hit === null || hit.kind === 'card' ? (this.panZoom ? 'grab' : '') : 'pointer';
        if (!RecordGraph.same(hit, this.hovered)) {
            this.hovered = hit;
            this.events.emit('hover', {
                row: hit?.kind === 'row' ? hit.port : null,
                link: hit?.kind === 'link' ? hit.link.ids.slice() : null
            });
            this.redraw();
        }
    };

    private readonly onUp = (e: PointerEvent): void => {
        const press = this.press;

        this.press = null;
        if (this.root.hasPointerCapture(e.pointerId)) {
            this.root.releasePointerCapture(e.pointerId);
        }
        this.root.style.cursor = '';
        if (press === null || press.moved || e.type !== 'pointerup') {
            return;
        }

        const p = this.local(e);
        const hit = this.hit(p.x, p.y);

        if (hit === null) {
            this.clearHighlight();
            return;
        }

        switch (hit.kind) {
            case 'group':
                this.toggleGroup(hit.group);
                break;
            case 'row':
                if (hit.plus) {
                    this.produce(hit.port.node, hit.port.row);
                    break;
                }
                this.events.emit('rowClick', hit.port);
                if (this.lineageStart === RecordQuery.key(hit.port)) {
                    this.clearHighlight();
                } else {
                    this.highlightRow(hit.port);
                }
                break;
            case 'link': {
                const id = hit.link.ids[0]!;

                this.events.emit('linkClick', {ids: hit.link.ids.slice(), from: hit.link.from, to: hit.link.to});
                if (this.lineageStart === `link:${id}`) {
                    this.clearHighlight();
                } else {
                    this.highlightLink(id);
                }
                break;
            }
            default:
                break;
        }
    };

    private readonly onLeave = (): void => {
        if (this.press === null && this.hovered !== null) {
            this.hovered = null;
            this.events.emit('hover', {row: null, link: null});
            this.redraw();
        }
    };

    private readonly onWheel = (e: WheelEvent): void => {
        if (!this.panZoom) {
            return;
        }

        e.preventDefault();

        const p = this.local(e);

        this.camera.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
        this.userView = true;
        this.redraw();
    };

    private readonly onDblClick = (e: MouseEvent): void => {
        if (!this.panZoom) {
            return;
        }

        const p = this.local(e);

        if (this.hit(p.x, p.y) === null) {
            this.fit();
        }
    };

}
