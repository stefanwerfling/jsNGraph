import { ChoroplethGeometry, ColorScale, MapFit, MapProjection, MapRegion } from './ChoroplethGeometry';
import { svgEl, Widget, WidgetOptions } from './WidgetBase';

/** One legend row: a label and its colour steps (e.g. "Dem" light → dark). */
export interface ChoroplethLegendRow {
    label: string;
    colors: string[];
}

export interface ChoroplethLegend {
    title?: string;
    rows: ChoroplethLegendRow[];
    /** Texts under the steps (e.g. ['60', '70', '100']). */
    ticks?: string[];
}

export interface ChoroplethMapOptions extends WidgetOptions {
    /** Regions with their polygons … */
    regions?: MapRegion[];
    /** … or a GeoJSON FeatureCollection. */
    geojson?: {features: {id?: string | number; properties?: Record<string, unknown> | null; geometry: {type: string; coordinates?: unknown} | null}[]};
    idProperty?: string;
    nameProperty?: string;
    /** Default 'mercator' for GeoJSON, 'none' (plane, y down) for `regions`. */
    projection?: MapProjection;
    /** Value per region id. */
    values?: Record<string, number>;
    /** Value → colour (default: a ramp from the track colour to the first palette colour over the values). */
    color?: (value: number, region: MapRegion) => string;
    /** Fixed colours per region id (win over `color`). */
    colors?: Record<string, string>;
    /** Regions without a value (default the track colour). */
    missing?: string;
    /** Extra outlines drawn over the regions, not interactive (e.g. state borders around districts). */
    outlines?: MapRegion[];
    legend?: ChoroplethLegend;
    /** Legend under the map, right-aligned (default), or laid over its bottom-right corner. */
    legendPosition?: 'below' | 'overlay';
    /** Tooltip value text (default: the number). */
    format?: (value: number, region: MapRegion) => string;
    /** Wheel zoom, drag pan, double-click reset (default true). */
    zoom?: boolean;
}

export interface ChoroplethMapEvents extends Record<string, unknown> {
    regionHover: {region: MapRegion; value: number | undefined} | null;
    regionClick: {region: MapRegion; value: number | undefined; originalEvent: MouseEvent};
}

/**
 * Choropleth map: regions from GeoJSON (or plain polygons) filled by value
 * through a colour scale (`ColorScale.threshold` / `sequential` /
 * `diverging`), optional outlines over them, a step legend, hover tooltip and
 * pan/zoom. The geometry comes from the host — no tiles, no fetch, zero
 * dependencies. SVG.
 */
export class ChoroplethMap extends Widget<ChoroplethMapEvents> {

    private regions: MapRegion[] = [];
    private outlines: MapRegion[];
    private readonly projection: MapProjection;
    private values: Record<string, number>;
    private colorFn: ((value: number, region: MapRegion) => string) | undefined;
    private colors: Record<string, string>;
    private readonly missing: string;
    private readonly format: (value: number, region: MapRegion) => string;
    private readonly zoomOn: boolean;
    private readonly svg: SVGSVGElement;
    private readonly regionLayer: SVGGElement;
    private readonly outlineLayer: SVGGElement;
    private readonly tip: HTMLDivElement;
    private readonly legendBox: HTMLDivElement;
    private paths = new Map<string, SVGPathElement>();
    private fit: MapFit = {scale: 1, minX: 0, minY: 0, width: 1000, height: 1};
    private view = {x: 0, y: 0, w: 1000, h: 1};
    private hovered: string | null = null;
    private drag: {x: number; y: number; view: {x: number; y: number; w: number; h: number}; moved: boolean} | null = null;

    public constructor(container: HTMLElement, options: ChoroplethMapOptions = {}) {
        super(container, `wg-choro${options.legendPosition === 'overlay' ? ' wg-choro-overlay' : ''}`, options);
        this.projection = options.projection ?? (options.geojson !== undefined ? 'mercator' : 'none');
        this.values = options.values ?? {};
        this.colorFn = options.color;
        this.colors = options.colors ?? {};
        this.missing = options.missing ?? 'var(--wg-track)';
        this.format = options.format ?? ((v) => v.toLocaleString('en-US', {maximumFractionDigits: 2}));
        this.zoomOn = options.zoom ?? true;
        this.outlines = options.outlines ?? [];

        this.svg = svgEl('svg', {class: 'wg-svg wg-choro-svg', role: 'img'});
        this.regionLayer = svgEl('g');
        this.outlineLayer = svgEl('g', {class: 'wg-choro-outlines'});
        this.svg.append(this.regionLayer, this.outlineLayer);
        this.tip = document.createElement('div');
        this.tip.className = 'wg-choro-tip';
        this.legendBox = document.createElement('div');
        this.legendBox.className = 'wg-choro-legend';
        this.root.append(this.svg, this.legendBox, this.tip);

        this.svg.addEventListener('pointermove', this.onMove);
        this.svg.addEventListener('pointerleave', this.onLeave);
        this.svg.addEventListener('click', this.onClick);
        if (this.zoomOn) {
            this.svg.addEventListener('wheel', this.onWheel, {passive: false});
            this.svg.addEventListener('pointerdown', this.onDown);
            this.svg.addEventListener('pointerup', this.onUp);
            this.svg.addEventListener('dblclick', this.resetZoom);
        }

        this.setLegend(options.legend ?? null);
        this.setRegions(options.geojson !== undefined
            ? ChoroplethGeometry.fromGeoJSON(options.geojson, {idProperty: options.idProperty, nameProperty: options.nameProperty})
            : options.regions ?? []);
    }

    public setRegions(regions: MapRegion[], outlines = this.outlines): void {
        this.regions = regions;
        this.outlines = outlines;
        this.fit = ChoroplethGeometry.fit(ChoroplethGeometry.bounds(regions, this.projection));
        this.view = {x: 0, y: 0, w: this.fit.width, h: this.fit.height};
        this.applyView();
        this.regionLayer.replaceChildren();
        this.paths.clear();
        for (const r of regions) {
            const p = svgEl('path', {class: 'wg-choro-region', d: ChoroplethGeometry.path(r.polygons, this.projection, this.fit)});

            p.dataset['region'] = r.id;
            this.regionLayer.appendChild(p);
            this.paths.set(r.id, p);
        }
        this.outlineLayer.replaceChildren(...outlines.map((r) =>
            svgEl('path', {class: 'wg-choro-outline', d: ChoroplethGeometry.path(r.polygons, this.projection, this.fit)})));
        this.paint();
    }

    public getRegions(): ReadonlyArray<MapRegion> {
        return this.regions;
    }

    /** New values (and optionally a new scale); fills fade over. */
    public setValues(values: Record<string, number>, color = this.colorFn): void {
        this.values = values;
        this.colorFn = color;
        this.paint();
    }

    public setColors(colors: Record<string, string>): void {
        this.colors = colors;
        this.paint();
    }

    public setLegend(legend: ChoroplethLegend | null): void {
        const box = this.legendBox;

        box.replaceChildren();
        box.style.display = legend === null ? 'none' : '';
        if (legend === null) {
            return;
        }

        const steps = Math.max(0, ...legend.rows.map((r) => r.colors.length));
        const grid = document.createElement('div');

        grid.className = 'wg-choro-legend-grid';
        grid.style.gridTemplateColumns = `auto repeat(${steps}, 18px)`;
        if (legend.title !== undefined) {
            const t = document.createElement('div');
            t.className = 'wg-choro-legend-title';
            t.textContent = legend.title;
            box.appendChild(t);
        }
        for (const row of legend.rows) {
            const label = document.createElement('span');
            label.textContent = row.label;
            grid.appendChild(label);
            for (let i = 0; i < steps; i++) {
                const sw = document.createElement('span');
                sw.className = 'wg-choro-step';
                sw.style.background = row.colors[i] ?? 'transparent';
                grid.appendChild(sw);
            }
        }
        if (legend.ticks !== undefined) {
            grid.appendChild(document.createElement('span'));
            for (let i = 0; i < steps; i++) {
                const t = document.createElement('span');
                t.className = 'wg-choro-tick';
                t.textContent = legend.ticks[i] ?? '';
                grid.appendChild(t);
            }
        }
        box.appendChild(grid);
    }

    public resetZoom = (): void => {
        this.view = {x: 0, y: 0, w: this.fit.width, h: this.fit.height};
        this.applyView();
    };

    public override destroy(): void {
        this.svg.removeEventListener('pointermove', this.onMove);
        this.svg.removeEventListener('pointerleave', this.onLeave);
        this.svg.removeEventListener('click', this.onClick);
        this.svg.removeEventListener('wheel', this.onWheel);
        this.svg.removeEventListener('pointerdown', this.onDown);
        this.svg.removeEventListener('pointerup', this.onUp);
        this.svg.removeEventListener('dblclick', this.resetZoom);
        super.destroy();
    }

    private defaultScale(): (value: number) => string {
        const vals = Object.values(this.values).filter((v) => Number.isFinite(v));
        const min = vals.length > 0 ? Math.min(...vals) : 0;
        const max = vals.length > 0 ? Math.max(...vals) : 1;
        const ramp = ColorScale.sequential([min, max], ['#dbe9f2', '#1380a1']);

        return ramp;
    }

    private paint(): void {
        const fallback = this.colorFn === undefined ? this.defaultScale() : null;

        for (const r of this.regions) {
            const p = this.paths.get(r.id);
            const v = this.values[r.id];

            if (p === undefined) {
                continue;
            }

            const fixed = this.colors[r.id];

            p.style.fill = fixed ?? (v === undefined || !Number.isFinite(v)
                ? this.missing
                : this.colorFn !== undefined ? this.colorFn(v, r) : fallback!(v));
        }
    }

    private applyView(): void {
        const v = this.view;

        this.svg.setAttribute('viewBox', `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`);
    }

    /** Pointer → view-box coordinates. */
    private toView(e: MouseEvent): {x: number; y: number} {
        const r = this.svg.getBoundingClientRect();
        const s = Math.max(this.view.w / Math.max(1, r.width), this.view.h / Math.max(1, r.height));
        // the view box is centred (xMidYMid meet)
        const ox = (r.width - this.view.w / s) / 2;
        const oy = (r.height - this.view.h / s) / 2;

        return {x: this.view.x + (e.clientX - r.left - ox) * s, y: this.view.y + (e.clientY - r.top - oy) * s};
    }

    private regionAt(target: EventTarget | null): MapRegion | null {
        const el = target instanceof Element ? target.closest<SVGPathElement>('.wg-choro-region') : null;
        const id = el?.dataset['region'];

        return id === undefined ? null : this.regions.find((r) => r.id === id) ?? null;
    }

    private setHover(region: MapRegion | null): void {
        const id = region?.id ?? null;

        if (id === this.hovered) {
            return;
        }
        if (this.hovered !== null) {
            this.paths.get(this.hovered)?.classList.remove('wg-choro-hover');
        }
        this.hovered = id;
        if (id !== null) {
            const p = this.paths.get(id);

            if (p !== undefined) {
                p.classList.add('wg-choro-hover');
                // on top, so the outline is not covered by neighbours
                this.regionLayer.appendChild(p);
            }
        }
        this.events.emit('regionHover', region === null ? null : {region, value: this.values[region.id]});
    }

    private readonly onMove = (e: PointerEvent): void => {
        if (this.drag !== null) {
            const r = this.svg.getBoundingClientRect();
            const s = Math.max(this.view.w / Math.max(1, r.width), this.view.h / Math.max(1, r.height));
            const dx = (e.clientX - this.drag.x) * s;
            const dy = (e.clientY - this.drag.y) * s;

            if (!this.drag.moved && Math.abs(e.clientX - this.drag.x) + Math.abs(e.clientY - this.drag.y) > 3) {
                // capture only once it is a drag, so a plain click still reaches the region
                this.drag.moved = true;
                this.svg.setPointerCapture(e.pointerId);
            }
            if (!this.drag.moved) {
                return;
            }
            this.view = {...this.drag.view, x: this.drag.view.x - dx, y: this.drag.view.y - dy};
            this.applyView();
            this.tip.style.display = 'none';
            return;
        }

        const region = this.regionAt(e.target);

        this.setHover(region);
        if (region === null) {
            this.tip.style.display = 'none';
            return;
        }

        const v = this.values[region.id];
        const box = this.root.getBoundingClientRect();
        const name = region.name ?? region.id;

        this.tip.replaceChildren();

        const b = document.createElement('b');

        b.textContent = name;
        this.tip.appendChild(b);
        if (v !== undefined) {
            this.tip.appendChild(document.createTextNode(` · ${this.format(v, region)}`));
        }
        this.tip.style.display = 'block';

        const x = e.clientX - box.left + 12;
        const w = this.tip.offsetWidth;

        this.tip.style.left = `${Math.min(box.width - w - 4, x)}px`;
        this.tip.style.top = `${Math.max(0, e.clientY - box.top - 34)}px`;
    };

    private readonly onLeave = (): void => {
        this.setHover(null);
        this.tip.style.display = 'none';
    };

    private readonly onClick = (e: MouseEvent): void => {
        const region = this.regionAt(e.target);

        if (region !== null) {
            this.events.emit('regionClick', {region, value: this.values[region.id], originalEvent: e});
        }
    };

    private readonly onWheel = (e: WheelEvent): void => {
        e.preventDefault();

        const at = this.toView(e);
        const factor = Math.exp(e.deltaY * 0.0015);
        const w = Math.max(this.fit.width / 40, Math.min(this.fit.width, this.view.w * factor));
        const k = w / this.view.w;

        this.view = {x: at.x - (at.x - this.view.x) * k, y: at.y - (at.y - this.view.y) * k, w, h: this.view.h * k};
        if (w >= this.fit.width) {
            this.view = {x: 0, y: 0, w: this.fit.width, h: this.fit.height};
        }
        this.applyView();
    };

    private readonly onDown = (e: PointerEvent): void => {
        if (e.button !== 0 || this.view.w >= this.fit.width) {
            return;
        }
        this.drag = {x: e.clientX, y: e.clientY, view: {...this.view}, moved: false};
    };

    private readonly onUp = (e: PointerEvent): void => {
        if (this.drag !== null) {
            if (this.svg.hasPointerCapture(e.pointerId)) {
                this.svg.releasePointerCapture(e.pointerId);
            }
            this.drag = null;
        }
    };

}
