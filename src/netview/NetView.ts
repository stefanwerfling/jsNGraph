import { Theme, ThemeTokens } from '../render/Theme';
import { Tooltip } from '../ui/Tooltip';
import { EventEmitter } from '../util/EventEmitter';
import { Camera } from '../view/Camera';
import { RenderLoop } from '../view/RenderLoop';
import { NetCompress } from './NetCompress';
import { NetHit, NetLayout, NetRect } from './NetLayout';
import { NetMeasurements, NetModel, NetToken, NetTrace, NetTraceBlock } from './NetTypes';

export interface NetViewOptions {
    theme?: 'dark' | 'light' | ThemeTokens;
    /** Residual bins per block (the compression). Default 48. */
    bins?: number;
    /** Strongest bins per block that form the active path. Default 6. */
    pathWidth?: number;
    /** Horizontal distance between block columns. Default 58. */
    spacing?: number;
    /** Sweep the path in block by block on `setTrace`, and run flow dots. Default true. */
    animate?: boolean;
    /** Prompt + prediction + measurement chips over the canvas. Default true. */
    summary?: boolean;
    /** Click a block for its detail panel. Default true. */
    detailPanel?: boolean;
}

export interface NetViewEvents extends Record<string, unknown> {
    /** A block column was clicked (null: background). */
    blockClick: {block: number; data: NetTraceBlock | null} | null;
    /** Pointer over a part of the view (null: nothing). */
    hover: NetHit | null;
}

interface Colors {
    pos: string;
    neg: string;
    accent: string;
    settled: string;
    text: string;
    dim: string;
    cell: string;
    line: string;
    kinds: string[];
}

interface BlockState {
    data: NetTraceBlock;
    /** Bins normalized to -1..1 (null: the block carries no residual data). */
    bins: Float32Array | null;
    strongest: number[];
    picked: Map<number, number>;
    load: Map<number, number>;
    focus: Map<number, number>;
}

/**
 * NetView — a transformer at a glance, compressed so the browser can draw it
 * whole: every block a column of residual bins (thousands of dimensions
 * folded into a few dozen), its attention heads and MoE experts below. A
 * trace of one prompt lays the active path over it — the strongest bins per
 * block linked block to block — with the logit lens, residual growth and
 * where the answer settles measured along the way.
 *
 * A pure renderer: the host passes the model sizes (`setModel`) and a trace
 * (`setTrace`); `NetHugin` builds both from Hugin's forward tools.
 */
export class NetView {

    private readonly root: HTMLDivElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly camera = new Camera(0.05, 8);
    private readonly loop: RenderLoop;
    private readonly tooltip: Tooltip;
    private readonly summaryEl: HTMLDivElement;
    private readonly panelEl: HTMLDivElement;
    private readonly events = new EventEmitter<NetViewEvents>();
    private readonly resizeObserver: ResizeObserver;

    private theme: ThemeTokens;
    private colors: Colors;
    private model: NetModel | null = null;
    private layout: NetLayout | null = null;
    private trace: NetTrace | null = null;
    private blocks = new Map<number, BlockState>();
    private measurements: NetMeasurements | null = null;
    private outputs: NetToken[] = [];
    private reveal = 0;
    private lastTime = 0;
    private phase = 0;
    private hovered: NetHit | null = null;
    private selected: number | null = null;
    private width = 0;
    private height = 0;
    private userAdjusted = false;
    private animate: boolean;
    private readonly pathWidth: number;
    private readonly binCount: number;
    private readonly spacing: number | undefined;
    private readonly showSummary: boolean;
    private readonly detailPanel: boolean;
    private drag: {x: number; y: number; moved: boolean} | null = null;

    public constructor(container: HTMLElement, options: NetViewOptions = {}) {
        this.theme = NetView.resolveTheme(options.theme ?? 'dark');
        this.colors = NetView.colorsFor(this.theme);
        this.animate = options.animate ?? !NetView.prefersReducedMotion();
        this.pathWidth = Math.max(1, Math.floor(options.pathWidth ?? 6));
        this.binCount = options.bins ?? 48;
        this.spacing = options.spacing;
        this.showSummary = options.summary ?? true;
        this.detailPanel = options.detailPanel ?? true;

        this.root = document.createElement('div');
        this.root.style.cssText = 'position:relative; width:100%; height:100%; overflow:hidden;';
        container.appendChild(this.root);

        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'display:block; width:100%; height:100%; cursor:grab; touch-action:none;';
        this.root.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d')!;

        this.summaryEl = document.createElement('div');
        this.panelEl = document.createElement('div');
        this.root.append(this.summaryEl, this.panelEl);
        this.tooltip = new Tooltip(this.root, this.theme);
        this.styleOverlays();

        this.loop = new RenderLoop((t) => this.frame(t));
        this.canvas.addEventListener('pointerdown', this.onDown);
        this.canvas.addEventListener('pointermove', this.onMove);
        this.canvas.addEventListener('pointerup', this.onUp);
        this.canvas.addEventListener('pointerleave', this.onLeave);
        this.canvas.addEventListener('wheel', this.onWheel, {passive: false});

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.root);
        this.resize();
    }

    /** The model's sizes. Clears a trace drawn for a different shape. */
    public setModel(model: NetModel): void {
        if (model.blocks <= 0 || model.hidden <= 0) {
            throw new Error('NetView: model needs blocks > 0 and hidden > 0');
        }

        this.model = {...model};
        this.trace = null;
        this.blocks.clear();
        this.measurements = null;
        this.outputs = [];
        this.selected = null;
        this.hidePanel();
        this.relayout();
        this.renderSummary();
        this.userAdjusted = false;
        this.fit();
    }

    /** Lay one prompt's trace over the model (null: structure only). */
    public setTrace(trace: NetTrace | null): void {
        if (this.model === null) {
            throw new Error('NetView: setModel before setTrace');
        }

        this.trace = trace;
        this.blocks.clear();
        this.measurements = null;
        this.outputs = [];

        if (trace !== null) {
            const context = Math.max(2, (trace.position ?? (trace.tokens?.length ?? 2) - 1) + 1);

            for (const data of trace.blocks) {
                if (data.block < 0 || data.block >= this.model.blocks) {
                    continue;
                }

                const raw = NetCompress.blockBins(data, this.model.hidden, this.binCount);
                const bins = raw === null ? null : NetCompress.normalize(raw);

                this.blocks.set(data.block, {
                    data,
                    bins,
                    strongest: bins === null ? [] : NetCompress.strongest(bins, this.pathWidth),
                    picked: new Map((data.experts ?? []).map((e) => [e.expert, e.weight ?? 1])),
                    load: new Map((data.expertLoad ?? []).map((e) => [e.expert, e.tokens])),
                    focus: new Map((data.heads ?? []).map((h) => [h.head, NetCompress.focus(h, context)]))
                });
            }

            this.measurements = NetCompress.measure(trace);
            this.outputs = trace.top ?? (trace.prediction === undefined ? [] : [trace.prediction]);
        }

        this.relayout();
        this.reveal = this.animate && trace !== null ? 0 : this.model.blocks + 1;
        this.renderSummary();

        if (this.selected !== null) {
            this.showPanel(this.selected);
        }
        this.loop.request();
    }

    public getModel(): NetModel | null {
        return this.model === null ? null : {...this.model};
    }

    public getTrace(): NetTrace | null {
        return this.trace;
    }

    /** Summary numbers of the current trace (null: no trace). */
    public getMeasurements(): NetMeasurements | null {
        return this.measurements === null ? null : {...this.measurements};
    }

    /** Select a block (opens its panel) or clear the selection. */
    public selectBlock(block: number | null): void {
        this.selected = block;

        if (block === null) {
            this.hidePanel();
        } else {
            this.showPanel(block);
        }
        this.loop.request();
    }

    /** Fly the camera to one block column. */
    public focusBlock(block: number): void {
        if (this.layout === null) {
            return;
        }

        const r = this.layout.columnRect(block);
        const scale = Math.max(this.camera.scale, Math.min(3, this.height / (r.h + 120)));

        this.camera.flyTo(this.camera.centerState(r.x + r.w / 2, r.y + r.h / 2, this.width, this.height, scale), 450);
        this.userAdjusted = true;
        this.loop.request();
    }

    public fit(): void {
        if (this.layout === null || this.width === 0 || this.height === 0) {
            return;
        }

        const top = this.showSummary ? 96 : 32;

        this.camera.fit(this.layout.bounds(), this.width, this.height, 24, top);
        this.userAdjusted = false;
        this.loop.request();
    }

    public zoomIn(): void {
        this.camera.zoomAt(this.width / 2, this.height / 2, 1.25);
        this.userAdjusted = true;
        this.loop.request();
    }

    public zoomOut(): void {
        this.camera.zoomAt(this.width / 2, this.height / 2, 1 / 1.25);
        this.userAdjusted = true;
        this.loop.request();
    }

    /** Replay the sweep of the current trace. */
    public replay(): void {
        this.reveal = 0;
        this.loop.request();
    }

    public setAnimate(animate: boolean): void {
        this.animate = animate;

        if (!animate && this.model !== null) {
            this.reveal = this.model.blocks + 1;
        }
        this.loop.request();
    }

    public setTheme(theme: 'dark' | 'light' | ThemeTokens): void {
        this.theme = NetView.resolveTheme(theme);
        this.colors = NetView.colorsFor(this.theme);
        this.tooltip.setTheme(this.theme);
        this.styleOverlays();
        this.renderSummary();

        if (this.selected !== null) {
            this.showPanel(this.selected);
        }
        this.loop.request();
    }

    public on<K extends keyof NetViewEvents>(event: K, listener: (payload: NetViewEvents[K]) => void): void {
        this.events.on(event, listener);
    }

    public off<K extends keyof NetViewEvents>(event: K, listener: (payload: NetViewEvents[K]) => void): void {
        this.events.off(event, listener);
    }

    public destroy(): void {
        this.loop.destroy();
        this.resizeObserver.disconnect();
        this.canvas.removeEventListener('pointerdown', this.onDown);
        this.canvas.removeEventListener('pointermove', this.onMove);
        this.canvas.removeEventListener('pointerup', this.onUp);
        this.canvas.removeEventListener('pointerleave', this.onLeave);
        this.canvas.removeEventListener('wheel', this.onWheel);
        this.tooltip.destroy();
        this.events.clear();
        this.root.remove();
    }

    // ---- frame ------------------------------------------------------------

    private relayout(): void {
        if (this.model === null) {
            this.layout = null;
            return;
        }

        this.layout = new NetLayout(this.model, {bins: this.binCount, spacing: this.spacing}, this.trace?.tokens?.length ?? 0);
    }

    private resize(): void {
        const rect = this.root.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.width = rect.width;
        this.height = rect.height;
        this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
        this.canvas.height = Math.max(1, Math.round(rect.height * dpr));

        if (!this.userAdjusted) {
            this.fit();
        }
        this.loop.request();
    }

    private frame(time: number): boolean {
        const dt = this.lastTime === 0 ? 16 : Math.min(64, time - this.lastTime);
        const flying = this.camera.step(time);
        const model = this.model;

        this.lastTime = time;

        if (model !== null && this.reveal < model.blocks + 1) {
            this.reveal = Math.min(model.blocks + 1, this.reveal + (dt / 1400) * (model.blocks + 1));
        }
        this.phase = (this.phase + dt / 1600) % 1;
        this.draw();

        const sweeping = model !== null && this.reveal < model.blocks + 1;
        const flowing = this.animate && this.trace !== null && this.blocks.size > 0;

        if (!sweeping && !flowing && !flying) {
            this.lastTime = 0;
        }

        return sweeping || flowing || flying;
    }

    private draw(): void {
        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = this.theme.background;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        const layout = this.layout;
        const model = this.model;

        if (layout === null || model === null) {
            return;
        }

        ctx.setTransform(dpr * this.camera.scale, 0, 0, dpr * this.camera.scale, dpr * this.camera.offsetX, dpr * this.camera.offsetY);

        const view = this.camera.viewBounds(this.width, this.height);
        const first = Math.max(0, Math.floor((view.minX - layout.firstX) / layout.spacing) - 1);
        const last = Math.min(model.blocks - 1, Math.ceil((view.maxX - layout.firstX) / layout.spacing) + 1);
        const detail = this.camera.scale * 9 >= 4;

        this.drawStream(layout, first, last);
        this.drawPath(layout, first, last);

        this.drawColumns(layout, model, first, last);
        for (let b = first; b <= last; b++) {
            this.drawColumnText(layout, b, detail);
        }

        this.drawIo(layout, detail);
        this.drawChart(layout, model);
        this.drawMarks(layout, model);
    }

    /** The residual stream: every bin linked to itself in the next block, faint. */
    private drawStream(layout: NetLayout, first: number, last: number): void {
        const ctx = this.ctx;

        ctx.beginPath();
        for (let b = first; b < last; b++) {
            for (let i = 0; i < layout.bins; i++) {
                const a = layout.binPort(b, i, 'out');
                const c = layout.binPort(b + 1, i, 'in');

                ctx.moveTo(a.x, a.y);
                ctx.lineTo(c.x, c.y);
            }
        }
        ctx.strokeStyle = this.colors.line;
        ctx.lineWidth = 0.6;
        ctx.stroke();
    }

    /** The active path: strongest bins of each block linked to the strongest of the next. */
    private drawPath(layout: NetLayout, first: number, last: number): void {
        const ctx = this.ctx;
        const pairs = this.pathPairs(layout, Math.max(0, first - 1), last);

        ctx.lineCap = 'round';

        // One stroke per (sign, weight step): ~1 500 curves, a handful of state changes.
        const buckets = new Map<number, typeof pairs>();

        for (const p of pairs) {
            if (p.gap + 1 > this.reveal) {
                continue;
            }

            const key = (p.sign >= 0 ? 100 : 0) + Math.round(p.weight * 8);
            const list = buckets.get(key);

            if (list === undefined) {
                buckets.set(key, [p]);
            } else {
                list.push(p);
            }
        }
        for (const [key, list] of buckets) {
            const w = (key % 100) / 8;

            ctx.globalAlpha = 0.1 + 0.6 * w;
            ctx.strokeStyle = key >= 100 ? this.colors.pos : this.colors.neg;
            ctx.lineWidth = 0.4 + 1.8 * w;
            ctx.beginPath();
            for (const p of list) {
                const mid = (p.a.x + p.c.x) / 2;

                ctx.moveTo(p.a.x, p.a.y);
                ctx.bezierCurveTo(mid, p.a.y, mid, p.c.y, p.c.x, p.c.y);
            }
            ctx.stroke();
        }

        // Flow dots on the strongest link of every gap.
        if (this.animate && this.blocks.size > 0) {
            ctx.globalAlpha = 0.95;
            ctx.fillStyle = this.colors.accent;
            for (const p of pairs) {
                if (!p.lead || p.gap + 1 > this.reveal) {
                    continue;
                }

                const t = (this.phase + p.gap * 0.13) % 1;
                const mid = (p.a.x + p.c.x) / 2;
                const x = NetView.bezier(p.a.x, mid, mid, p.c.x, t);
                const y = NetView.bezier(p.a.y, p.a.y, p.c.y, p.c.y, t);

                ctx.beginPath();
                ctx.arc(x, y, 1.8, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }

    private pathPairs(layout: NetLayout, first: number, last: number): {gap: number; a: {x: number; y: number}; c: {x: number; y: number}; weight: number; sign: number; lead: boolean}[] {
        const out: {gap: number; a: {x: number; y: number}; c: {x: number; y: number}; weight: number; sign: number; lead: boolean}[] = [];
        const model = this.model;

        if (model === null || this.trace === null) {
            return out;
        }

        // Prompt token -> first block.
        const b0 = this.blocks.get(0);
        const pos = this.trace.position ?? (this.trace.tokens?.length ?? 0) - 1;

        if (first === 0 && b0?.bins && this.trace.tokens !== undefined && pos >= 0) {
            const r = layout.inputRect(pos);

            b0.strongest.forEach((i, n) => {
                const v = b0.bins![i]!;

                out.push({gap: -1, a: {x: r.x + r.w + 6, y: r.y + r.h / 2}, c: layout.binPort(0, i, 'in'), weight: Math.abs(v), sign: v, lead: n === 0});
            });
        }

        for (let b = first; b < Math.min(last, model.blocks - 1); b++) {
            const from = this.blocks.get(b);
            const to = this.blocks.get(b + 1);

            if (!from?.bins || !to?.bins) {
                continue;
            }
            for (const i of from.strongest) {
                for (const j of to.strongest) {
                    const w = Math.sqrt(Math.abs(from.bins[i]!) * Math.abs(to.bins[j]!));

                    out.push({gap: b, a: layout.binPort(b, i, 'out'), c: layout.binPort(b + 1, j, 'in'), weight: w, sign: to.bins[j]!, lead: i === from.strongest[0] && j === to.strongest[0]});
                }
            }
        }

        // Last block -> prediction.
        const lastBlock = this.blocks.get(model.blocks - 1);

        if (last >= model.blocks - 1 && lastBlock?.bins && this.outputs.length > 0) {
            const r = layout.outputRect(0, this.outputs.length);

            lastBlock.strongest.forEach((i, n) => {
                const v = lastBlock.bins![i]!;

                out.push({gap: model.blocks - 1, a: layout.binPort(model.blocks - 1, i, 'out'), c: {x: r.x - 6, y: r.y + r.h / 2}, weight: Math.abs(v), sign: v, lead: n === 0});
            });
        }

        return out;
    }

    /**
     * Every cell of the visible columns, collected into buckets (colour ×
     * quantised alpha) and filled as one path per bucket. A 40-block MoE has
     * ~13 000 cells; a state change per cell costs more than the drawing.
     */
    private drawColumns(layout: NetLayout, model: NetModel, first: number, last: number): void {
        const ctx = this.ctx;
        const base: NetRect[] = [];
        const buckets = new Map<string, {color: string; alpha: number; rects: NetRect[]}>();
        const put = (color: string, alpha: number, r: NetRect): void => {
            const q = Math.round(Math.max(0, Math.min(1, alpha)) * 12) / 12;
            const key = `${color}|${q}`;
            let bucket = buckets.get(key);

            if (bucket === undefined) {
                bucket = {color, alpha: q, rects: []};
                buckets.set(key, bucket);
            }
            bucket.rects.push(r);
        };
        const experts = model.experts ?? 0;
        const kinds = model.blockKinds === undefined ? [] : [...new Set(model.blockKinds)];

        for (let b = first; b <= last; b++) {
            const state = b < this.reveal ? this.blocks.get(b) : undefined;
            const kind = model.blockKinds?.[b];

            if (kind !== undefined) {
                put(this.colors.kinds[kinds.indexOf(kind) % this.colors.kinds.length]!, 1, {x: layout.columnX(b), y: -7, w: NetLayout.COL_W, h: 3});
            }
            for (let i = 0; i < layout.bins; i++) {
                const r = layout.binRect(b, i);
                const v = state?.bins?.[i] ?? 0;

                base.push(r);
                if (v !== 0) {
                    put(v > 0 ? this.colors.pos : this.colors.neg, 0.12 + Math.abs(v) * 0.88, r);
                }
            }
            for (let h = 0; h < model.heads; h++) {
                const r = layout.headRect(b, h);
                const f = state?.focus.get(h);

                base.push(r);
                if (f !== undefined) {
                    put(this.colors.accent, 0.15 + f * 0.85, r);
                }
            }
            for (let e = 0; e < experts; e++) {
                base.push(layout.expertRect(b, e));
            }
            if (experts > 0 && state !== undefined) {
                const maxLoad = Math.max(0, ...state.load.values());

                for (const [e, tokens] of state.load) {
                    put(this.colors.accent, 0.15 + 0.35 * (maxLoad > 0 ? tokens / maxLoad : 0), layout.expertRect(b, e));
                }
                for (const e of state.picked.keys()) {
                    const r = layout.expertRect(b, e);

                    put(this.colors.pos, 1, {x: r.x - 0.5, y: r.y - 0.5, w: r.w + 1, h: r.h + 1});
                }
            }
        }

        const fill = (color: string, alpha: number, rects: NetRect[]): void => {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;
            ctx.beginPath();
            for (const r of rects) {
                ctx.rect(r.x, r.y, r.w, r.h);
            }
            ctx.fill();
        };

        fill(this.colors.cell, 1, base);
        for (const bucket of buckets.values()) {
            if (bucket.alpha > 0) {
                fill(bucket.color, bucket.alpha, bucket.rects);
            }
        }
        ctx.globalAlpha = 1;
    }

    /** Block number, lens label and the hover / selection outline of one column. */
    private drawColumnText(layout: NetLayout, b: number, detail: boolean): void {
        const ctx = this.ctx;
        const state = b < this.reveal ? this.blocks.get(b) : undefined;
        const x = layout.columnX(b);

        if (detail || b % 4 === 0) {
            ctx.fillStyle = this.colors.dim;
            ctx.font = '9px Inter, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(String(b), x + NetLayout.COL_W / 2, -11);
        }

        // Logit lens: top-1 at this block.
        const lens = state?.data.lens?.top[0];

        if (lens !== undefined && detail) {
            const final = this.finalPiece();

            ctx.fillStyle = lens.piece === final ? this.colors.settled : this.colors.text;
            ctx.font = '10px Inter, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(NetView.fit(ctx, NetView.show(lens.piece), NetLayout.COL_W + 12), x + NetLayout.COL_W / 2, layout.lensTop);
            ctx.fillStyle = this.colors.dim;
            ctx.font = '8px Inter, system-ui, sans-serif';
            ctx.fillText(`${Math.round(lens.prob * 100)}%`, x + NetLayout.COL_W / 2, layout.lensTop + 13);
        }

        // Hover / selection outline.
        if (this.selected === b || (this.hovered !== null && 'block' in this.hovered && this.hovered.block === b)) {
            const r = layout.columnRect(b);

            ctx.strokeStyle = this.selected === b ? this.colors.accent : this.colors.dim;
            ctx.lineWidth = this.selected === b ? 1.5 : 1;
            ctx.strokeRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
        }
    }

    private drawIo(layout: NetLayout, detail: boolean): void {
        const ctx = this.ctx;
        const tokens = this.trace?.tokens ?? [];
        const pos = this.trace?.position ?? tokens.length - 1;

        ctx.font = '11px Inter, system-ui, sans-serif';
        ctx.textBaseline = 'middle';

        tokens.forEach((t, i) => {
            const r = layout.inputRect(i);

            if (i === pos) {
                ctx.fillStyle = this.colors.accent;
                ctx.globalAlpha = 0.18;
                NetView.roundRect(ctx, r, 4);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
            if (detail || i === pos) {
                ctx.fillStyle = i === pos ? this.colors.text : this.colors.dim;
                ctx.textAlign = 'right';
                ctx.fillText(NetView.fit(ctx, NetView.show(t), r.w - 8), r.x + r.w - 4, r.y + r.h / 2);
            }
        });

        if (this.model !== null && this.reveal >= this.model.blocks) {
            const final = this.finalPiece();

            this.outputs.forEach((t, i) => {
                const r = layout.outputRect(i, this.outputs.length);

                ctx.fillStyle = this.colors.cell;
                NetView.roundRect(ctx, r, 4);
                ctx.fill();
                ctx.fillStyle = t.piece === final ? this.colors.settled : this.colors.accent;
                ctx.globalAlpha = 0.35;
                NetView.roundRect(ctx, {x: r.x, y: r.y, w: Math.max(4, r.w * t.prob), h: r.h}, 4);
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.fillStyle = this.colors.text;
                ctx.textAlign = 'left';
                ctx.fillText(NetView.fit(ctx, NetView.show(t.piece), r.w - 44), r.x + 6, r.y + r.h / 2);
                ctx.fillStyle = this.colors.dim;
                ctx.textAlign = 'right';
                ctx.fillText(`${(t.prob * 100).toFixed(1)}%`, r.x + r.w - 4, r.y + r.h / 2);
            });
        }
    }

    /** Measurement strip: residual update as bars, the final token's lens probability as a line. */
    private drawChart(layout: NetLayout, model: NetModel): void {
        const ctx = this.ctx;
        const x0 = layout.columnX(0);
        const x1 = layout.columnX(model.blocks - 1) + NetLayout.COL_W;
        const top = layout.chartTop;
        const h = layout.chartHeight;

        ctx.strokeStyle = this.colors.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, top + h + 0.5);
        ctx.lineTo(x1, top + h + 0.5);
        ctx.stroke();
        ctx.fillStyle = this.colors.dim;
        ctx.font = '9px Inter, system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('p(answer)', x0 - 8, top + 6);
        ctx.fillText('Δ residual', x0 - 8, top + h - 6);

        if (this.blocks.size === 0) {
            return;
        }

        const states = [...this.blocks.values()].filter((s) => s.data.block < this.reveal).sort((a, b) => a.data.block - b.data.block);
        const maxUpdate = Math.max(0, ...states.map((s) => s.data.update ?? 0));

        ctx.fillStyle = this.colors.dim;
        ctx.globalAlpha = 0.45;
        for (const s of states) {
            if (s.data.update === undefined) {
                continue;
            }

            const y = layout.chartY(s.data.update, maxUpdate);
            const x = layout.columnX(s.data.block) + NetLayout.COL_W / 2 - 4;

            ctx.fillRect(x, y, 8, top + h - y);
        }
        ctx.globalAlpha = 1;

        const prob = states.filter((s) => s.data.lens !== undefined).map((s) => ({
            x: layout.columnX(s.data.block) + NetLayout.COL_W / 2,
            y: layout.chartY(this.finalProb(s.data), 1)
        }));

        if (prob.length > 0) {
            ctx.strokeStyle = this.colors.settled;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            prob.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.stroke();
            ctx.fillStyle = this.colors.settled;
            for (const p of prob) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    /** "settles here" and "peak update" marks over the columns. */
    private drawMarks(layout: NetLayout, model: NetModel): void {
        const m = this.measurements;

        if (m === null || this.reveal < model.blocks) {
            return;
        }

        const ctx = this.ctx;
        const mark = (block: number | null, label: string, color: string): void => {
            if (block === null) {
                return;
            }

            const x = layout.columnX(block) - (layout.spacing - NetLayout.COL_W) / 2;

            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(x, -22);
            ctx.lineTo(x, layout.chartTop + layout.chartHeight);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = color;
            ctx.font = '9px Inter, system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(label, x + 3, -20);
        };

        mark(m.firstSeenBlock !== m.settleBlock ? m.firstSeenBlock : null, 'answer appears', this.colors.dim);
        mark(m.settleBlock, 'answer settles', this.colors.settled);
    }

    // ---- data helpers -----------------------------------------------------

    private finalPiece(): string | undefined {
        return this.trace?.prediction?.piece ?? this.outputs[0]?.piece;
    }

    /** Lens probability of the final answer at one block. */
    private finalProb(data: NetTraceBlock): number {
        if (data.lens?.finalProb !== undefined) {
            return data.lens.finalProb;
        }

        const final = this.finalPiece();

        return data.lens?.top.find((t) => t.piece === final)?.prob ?? 0;
    }

    // ---- overlays ---------------------------------------------------------

    private styleOverlays(): void {
        const t = this.theme;

        this.summaryEl.style.cssText = `position:absolute; left:12px; right:12px; top:10px; pointer-events:none;
            font:12px Inter, system-ui, sans-serif; color:${t.panelText}; display:${this.showSummary ? 'block' : 'none'};`;
        this.panelEl.style.cssText = `position:absolute; right:12px; top:96px; width:260px; max-height:calc(100% - 110px);
            overflow:auto; display:none; padding:12px 14px; border-radius:10px; font:12px Inter, system-ui, sans-serif;
            background:${t.panelBackground}; color:${t.panelText}; border:1px solid ${t.panelBorder};
            box-shadow:0 8px 24px rgba(0,0,0,.3); z-index:5;`;
    }

    private renderSummary(): void {
        const el = this.summaryEl;
        const t = this.theme;
        const c = this.colors;

        el.replaceChildren();
        if (!this.showSummary || this.model === null) {
            return;
        }

        const line = (): HTMLDivElement => {
            const d = document.createElement('div');

            d.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px 6px; align-items:center; margin-bottom:6px;';
            el.appendChild(d);
            return d;
        };
        const chip = (parent: HTMLElement, text: string, css = ''): HTMLSpanElement => {
            const s = document.createElement('span');

            s.textContent = text;
            s.style.cssText = `padding:1px 7px; border-radius:6px; border:1px solid ${t.panelBorder};
                background:${t.panelBackground}; white-space:pre; ${css}`;
            parent.appendChild(s);
            return s;
        };

        const m = this.model;
        const head = line();
        const name = document.createElement('strong');

        name.textContent = m.name ?? 'model';
        head.appendChild(name);
        chip(head, `${m.blocks} blocks · d ${m.hidden} · ${m.heads} heads${m.experts ? ` · ${m.experts} experts top-${m.expertsPerToken ?? '?'}` : ''}`, `color:${t.panelSubtext}`);

        const trace = this.trace;

        if (trace === null) {
            return;
        }

        const tokens = trace.tokens ?? (trace.prompt === undefined ? [] : [trace.prompt]);
        const pos = trace.position ?? tokens.length - 1;
        const prompt = line();

        tokens.slice(-24).forEach((tok, i, arr) => {
            const idx = tokens.length - arr.length + i;

            chip(prompt, NetView.show(tok), idx === pos ? `border-color:${c.accent}; color:${c.accent}` : `color:${t.panelSubtext}`);
        });
        if (trace.prediction !== undefined) {
            chip(prompt, `→ ${NetView.show(trace.prediction.piece)}  ${(trace.prediction.prob * 100).toFixed(1)}%`,
                `border-color:${c.settled}; color:${c.settled}; font-weight:600`);
        }

        const ms = this.measurements;

        if (ms !== null) {
            const row = line();
            const fmt = (v: number | null, digits = 2): string => (v === null ? '–' : v.toFixed(digits));

            chip(row, `settles at block ${ms.settleBlock ?? '–'}`);
            chip(row, `first seen ${ms.firstSeenBlock ?? '–'}`);
            chip(row, `peak update ${ms.peakUpdateBlock ?? '–'}`);
            chip(row, `entropy ${fmt(ms.entropyStart)} → ${fmt(ms.entropyEnd)}`);
            chip(row, `‖x‖ ×${fmt(ms.normGrowth, 1)}`);
            if (ms.meanFocus !== null) {
                chip(row, `attn focus ${fmt(ms.meanFocus)}`);
            }
            if (ms.distinctExperts !== null) {
                chip(row, `${ms.distinctExperts} experts used`);
            }
        }
    }

    private showPanel(block: number): void {
        if (!this.detailPanel || this.model === null) {
            return;
        }

        const el = this.panelEl;
        const t = this.theme;
        const state = this.blocks.get(block);
        const add = (tag: string, text: string, css = ''): HTMLElement => {
            const e = document.createElement(tag);

            e.textContent = text;
            e.style.cssText = css;
            el.appendChild(e);
            return e;
        };
        const section = (text: string): void => {
            add('div', text, `margin:10px 0 4px; font-size:10px; letter-spacing:.06em; text-transform:uppercase; color:${t.panelSubtext}`);
        };
        const bar = (label: string, value: number, right: string, color: string): void => {
            const row = document.createElement('div');
            const fill = document.createElement('div');
            const l = document.createElement('span');
            const r = document.createElement('span');

            row.style.cssText = `position:relative; display:flex; justify-content:space-between; padding:2px 6px; margin:2px 0;
                border-radius:4px; background:${t.panelBorder}40; overflow:hidden;`;
            fill.style.cssText = `position:absolute; inset:0 auto 0 0; width:${Math.round(Math.max(0, Math.min(1, value)) * 100)}%;
                background:${color}; opacity:.3;`;
            l.textContent = label;
            l.style.cssText = 'position:relative; white-space:pre; overflow:hidden; text-overflow:ellipsis;';
            r.textContent = right;
            r.style.cssText = `position:relative; color:${t.panelSubtext}; margin-left:8px;`;
            row.append(fill, l, r);
            el.appendChild(row);
        };

        el.replaceChildren();
        el.style.display = 'block';

        const close = add('button', '×', `position:absolute; right:8px; top:6px; border:0; background:none; cursor:pointer;
            font-size:16px; color:${t.panelSubtext};`);

        close.onclick = () => this.selectBlock(null);
        add('div', `Block ${block}${this.model.blockKinds?.[block] ? ` · ${this.model.blockKinds[block]}` : ''}`, 'font-weight:600; font-size:13px;');

        if (state === undefined) {
            add('div', 'No trace data for this block.', `margin-top:8px; color:${t.panelSubtext}`);
            return;
        }

        const d = state.data;
        const num = (v: number | undefined, digits = 2): string => (v === undefined ? '–' : v.toFixed(digits));

        add('div', `‖x‖ ${num(d.l2, 1)} · Δ ${num(d.update, 1)} · cos ${num(d.cosine, 3)}`, `margin-top:4px; color:${t.panelSubtext}`);

        if (d.lens !== undefined) {
            section(`Logit lens${d.lens.entropy !== undefined ? ` · H ${d.lens.entropy.toFixed(2)}` : ''}`);
            const final = this.finalPiece();

            for (const tok of d.lens.top) {
                bar(NetView.show(tok.piece), tok.prob, `${(tok.prob * 100).toFixed(1)}%`, tok.piece === final ? this.colors.settled : this.colors.accent);
            }
            if (d.lens.finalRank !== undefined && final !== undefined) {
                add('div', `answer “${NetView.show(final)}”: rank ${d.lens.finalRank + 1}, p ${num(d.lens.finalProb, 3)}`,
                    `margin-top:4px; color:${t.panelSubtext}`);
            }
        }

        if (state.bins !== null && this.layout !== null) {
            section('Strongest residual bins');
            for (const i of state.strongest) {
                const [from, to] = this.layout.binDims(i);
                const v = state.bins[i]!;

                bar(`dims ${from}–${to - 1}`, Math.abs(v), v >= 0 ? '+' : '−', v >= 0 ? this.colors.pos : this.colors.neg);
            }
        }

        if (d.heads !== undefined && d.heads.length > 0) {
            section('Most focused heads');
            const heads = [...d.heads].sort((a, b) => (state.focus.get(b.head) ?? 0) - (state.focus.get(a.head) ?? 0)).slice(0, 5);

            for (const h of heads) {
                const top = h.top?.[0];

                bar(`h${h.head}${top ? ` → ${NetView.show(top.token)}` : ''}`, state.focus.get(h.head) ?? 0,
                    top ? `${Math.round(top.weight * 100)}%` : '', this.colors.accent);
            }
        }

        if (d.experts !== undefined && d.experts.length > 0) {
            section('Experts picked');
            const max = Math.max(...d.experts.map((e) => e.weight ?? 1));

            for (const e of d.experts) {
                bar(`expert ${e.expert}`, (e.weight ?? 1) / (max || 1), e.weight === undefined ? '' : e.weight.toFixed(3), this.colors.pos);
            }
        }
    }

    private hidePanel(): void {
        this.panelEl.style.display = 'none';
    }

    private tooltipText(hit: NetHit): string | null {
        const layout = this.layout;

        if (layout === null) {
            return null;
        }

        switch (hit.kind) {
            case 'bin': {
                const [from, to] = layout.binDims(hit.index);
                const v = this.blocks.get(hit.block)?.bins?.[hit.index];

                return `Block ${hit.block} · dims ${from}–${to - 1}${v === undefined ? '' : ` · ${v >= 0 ? '+' : ''}${v.toFixed(2)}`}`;
            }
            case 'head': {
                const s = this.blocks.get(hit.block);
                const h = s?.data.heads?.find((x) => x.head === hit.index);
                const top = h?.top?.[0];

                return `Block ${hit.block} · head ${hit.index}${s?.focus.has(hit.index) ? ` · focus ${s.focus.get(hit.index)!.toFixed(2)}` : ''}${top ? ` → ${NetView.show(top.token)} ${Math.round(top.weight * 100)}%` : ''}`;
            }
            case 'expert': {
                const s = this.blocks.get(hit.block);
                const w = s?.picked.get(hit.index);
                const load = s?.load.get(hit.index);

                return `Block ${hit.block} · expert ${hit.index}${w !== undefined ? ` · picked ${w.toFixed(3)}` : ''}${load !== undefined ? ` · ${load} tokens` : ''}`;
            }
            case 'block': {
                const d = this.blocks.get(hit.block)?.data;
                const lens = d?.lens?.top[0];

                return `Block ${hit.block}${lens ? ` · lens ${NetView.show(lens.piece)} ${Math.round(lens.prob * 100)}%` : ''}${d?.update !== undefined ? ` · Δ ${d.update.toFixed(1)}` : ''}`;
            }
            case 'input': {
                const tok = this.trace?.tokens?.[hit.index];

                return tok === undefined ? null : `token ${hit.index}: ${NetView.show(tok)}`;
            }
            case 'output': {
                const tok = this.outputs[hit.index];

                return tok === undefined ? null : `${NetView.show(tok.piece)} · ${(tok.prob * 100).toFixed(2)}%`;
            }
        }
    }

    // ---- input ------------------------------------------------------------

    private local(e: PointerEvent | WheelEvent): {x: number; y: number} {
        const r = this.canvas.getBoundingClientRect();

        return {x: e.clientX - r.left, y: e.clientY - r.top};
    }

    private readonly onDown = (e: PointerEvent): void => {
        const p = this.local(e);

        this.drag = {x: p.x, y: p.y, moved: false};
        this.canvas.setPointerCapture(e.pointerId);
        this.camera.cancelFlight();
    };

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);

        if (this.drag !== null) {
            const dx = p.x - this.drag.x;
            const dy = p.y - this.drag.y;

            if (this.drag.moved || Math.abs(dx) + Math.abs(dy) > 3) {
                this.drag.moved = true;
                this.camera.panBy(dx, dy);
                this.drag.x = p.x;
                this.drag.y = p.y;
                this.userAdjusted = true;
                this.canvas.style.cursor = 'grabbing';
                this.tooltip.hide();
                this.loop.request();
            }
            return;
        }

        const w = this.camera.toWorld(p.x, p.y);
        const hit = this.layout?.hit(w.x, w.y, this.outputs.length) ?? null;
        const same = JSON.stringify(hit) === JSON.stringify(this.hovered);

        if (!same) {
            this.hovered = hit;
            this.events.emit('hover', hit);
            this.loop.request();
        }

        const text = hit === null ? null : this.tooltipText(hit);

        if (text === null) {
            this.tooltip.hide();
        } else {
            this.tooltip.show(text, p.x, p.y);
        }
        this.canvas.style.cursor = hit !== null && 'block' in hit ? 'pointer' : 'grab';
    };

    private readonly onUp = (e: PointerEvent): void => {
        const drag = this.drag;

        this.drag = null;
        this.canvas.style.cursor = 'grab';
        if (this.canvas.hasPointerCapture(e.pointerId)) {
            this.canvas.releasePointerCapture(e.pointerId);
        }
        if (drag === null || drag.moved) {
            return;
        }

        const p = this.local(e);
        const w = this.camera.toWorld(p.x, p.y);
        const hit = this.layout?.hit(w.x, w.y, this.outputs.length) ?? null;

        if (hit !== null && 'block' in hit) {
            this.selectBlock(this.selected === hit.block ? null : hit.block);
            this.events.emit('blockClick', this.selected === null ? null : {block: hit.block, data: this.blocks.get(hit.block)?.data ?? null});
        } else {
            this.selectBlock(null);
            this.events.emit('blockClick', null);
        }
    };

    private readonly onLeave = (): void => {
        this.tooltip.hide();
        if (this.hovered !== null) {
            this.hovered = null;
            this.events.emit('hover', null);
            this.loop.request();
        }
    };

    private readonly onWheel = (e: WheelEvent): void => {
        e.preventDefault();

        const p = this.local(e);

        this.camera.cancelFlight();
        this.camera.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
        this.userAdjusted = true;
        this.tooltip.hide();
        this.loop.request();
    };

    // ---- static helpers ---------------------------------------------------

    private static resolveTheme(theme: 'dark' | 'light' | ThemeTokens): ThemeTokens {
        return theme === 'dark' ? Theme.dark : theme === 'light' ? Theme.light : theme;
    }

    private static colorsFor(theme: ThemeTokens): Colors {
        const light = NetView.isLight(theme.background);

        return light
            ? {pos: '#d9761f', neg: '#2f6fe0', accent: '#5a54d6', settled: '#14935f', text: '#1b2230', dim: '#7a8597',
                cell: '#e9edf3', line: 'rgba(40,60,90,0.07)', kinds: ['#9aa5b8', '#d9761f', '#2f6fe0', '#14935f']}
            : {pos: '#f2a14a', neg: '#4f8ff7', accent: '#9d8cff', settled: '#3ed598', text: '#dfe6f2', dim: '#7d889c',
                cell: '#161d2c', line: 'rgba(140,170,220,0.06)', kinds: ['#56627a', '#f2a14a', '#4f8ff7', '#3ed598']};
    }

    private static isLight(color: string): boolean {
        const m = /^#([0-9a-f]{6})$/i.exec(color.trim());

        if (m === null) {
            return false;
        }

        const n = parseInt(m[1]!, 16);

        return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 150;
    }

    private static prefersReducedMotion(): boolean {
        return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    }

    private static bezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
        const u = 1 - t;

        return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
    }

    /** Token pieces made visible: leading space as ·, newline as ⏎. */
    public static show(piece: string): string {
        return piece.replace(/\n/g, '⏎').replace(/^ /, '·').replace(/^▁/, '·').replace(/^Ġ/, '·') || '∅';
    }

    private static fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
        if (ctx.measureText(text).width <= width) {
            return text;
        }

        let s = text;

        while (s.length > 1 && ctx.measureText(`${s}…`).width > width) {
            s = s.slice(0, -1);
        }
        return `${s}…`;
    }

    private static roundRect(ctx: CanvasRenderingContext2D, r: NetRect, radius: number): void {
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, radius);
    }

}
