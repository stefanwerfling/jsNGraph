import { paletteColor, svgEl, Widget, WidgetOptions } from './WidgetBase';
import { WorldMapGeometry } from './WorldMapGeometry';

/** A place on the map. */
export interface MapMarker {
    lon: number;
    lat: number;
    id?: string;
    label?: string;
    /** Any CSS colour (default the first palette colour). */
    color?: string;
    /** Radius in degrees of the map (default 2.2). */
    size?: number;
    /** A ring expanding from the marker, repeating (default false). */
    pulse?: boolean;
}

export interface MapLegendItem {
    label: string;
    color: string;
}

export interface WorldMapOptions extends WidgetOptions {
    /** 'fill' (default): land as one silhouette; 'dots': a dot matrix. */
    mode?: 'fill' | 'dots';
    /** Grid step of the dot matrix in degrees (default 2.5). */
    dotSpacing?: number;
    /** Shown latitudes [south, north] (default [-58, 84] — no Antarctica). */
    latRange?: [number, number];
    markers?: MapMarker[];
    legend?: MapLegendItem[];
    /** Where the legend sits (default 'right'). */
    legendPosition?: 'right' | 'bottom';
}

export interface WorldMapEvents extends Record<string, unknown> {
    markerClick: {marker: MapMarker; index: number; originalEvent: MouseEvent};
    /** Pointer entered a marker (null when it left). */
    markerHover: {marker: MapMarker; index: number} | null;
}

/**
 * A small world map for dashboards: land as a silhouette or a dot matrix,
 * markers (optionally pulsing) at lon/lat and a legend. The outlines are
 * embedded (Natural Earth 1:110m, public domain, ~7 KB) — no tiles, no fetch,
 * zero dependencies. SVG, equirectangular.
 */
export class WorldMap extends Widget<WorldMapEvents> {

    private mode: 'fill' | 'dots';
    private readonly spacing: number;
    private readonly south: number;
    private readonly north: number;
    private markers: MapMarker[];
    private legend: MapLegendItem[];
    private readonly svg: SVGSVGElement;
    private readonly landLayer: SVGGElement;
    private readonly markerLayer: SVGGElement;
    private readonly legendBox: HTMLDivElement;

    public constructor(container: HTMLElement, options: WorldMapOptions = {}) {
        super(container, `wg-map${options.legendPosition === 'bottom' ? ' wg-map-legend-bottom' : ''}`, options);
        this.mode = options.mode ?? 'fill';
        this.spacing = options.dotSpacing ?? 2.5;
        [this.south, this.north] = options.latRange ?? [-58, 84];
        this.markers = options.markers ?? [];
        this.legend = options.legend ?? [];

        this.svg = svgEl('svg', {viewBox: `0 0 360 ${this.north - this.south}`, class: 'wg-svg', role: 'img'});
        this.landLayer = svgEl('g');
        this.markerLayer = svgEl('g');
        this.svg.append(this.landLayer, this.markerLayer);
        this.legendBox = document.createElement('div');
        this.legendBox.className = 'wg-legend';
        this.root.append(this.svg, this.legendBox);

        this.root.addEventListener('click', this.onClick);
        this.root.addEventListener('pointerover', this.onOver);
        this.root.addEventListener('pointerout', this.onOut);

        this.drawLand();
        this.drawMarkers();
        this.drawLegend();
    }

    public setMode(mode: 'fill' | 'dots'): void {
        this.mode = mode;
        this.drawLand();
    }

    public getMode(): 'fill' | 'dots' {
        return this.mode;
    }

    public setMarkers(markers: readonly MapMarker[]): void {
        this.markers = [...markers];
        this.drawMarkers();
    }

    public getMarkers(): ReadonlyArray<MapMarker> {
        return this.markers;
    }

    public setLegend(legend: readonly MapLegendItem[]): void {
        this.legend = [...legend];
        this.drawLegend();
    }

    /** Map coordinates (view units) of a lon/lat — for hosts drawing their own overlay into `element`. */
    public project(lon: number, lat: number): [number, number] {
        return WorldMapGeometry.project(lon, lat, this.north);
    }

    public override destroy(): void {
        this.root.removeEventListener('click', this.onClick);
        this.root.removeEventListener('pointerover', this.onOver);
        this.root.removeEventListener('pointerout', this.onOut);
        super.destroy();
    }

    private drawLand(): void {
        this.landLayer.replaceChildren();

        if (this.mode === 'fill') {
            this.landLayer.appendChild(svgEl('path', {d: WorldMapGeometry.path(this.north), class: 'wg-land'}));
            return;
        }

        const r = this.spacing * 0.36;
        const parts: string[] = [];

        // one path of tiny circles — thousands of dots stay one element
        for (const [lon, lat] of WorldMapGeometry.dots(this.spacing, this.north, this.south)) {
            const [x, y] = this.project(lon, lat);
            parts.push(`M${round(x - r)} ${round(y)}a${round(r)} ${round(r)} 0 1 0 ${round(2 * r)} 0a${round(r)} ${round(r)} 0 1 0 ${round(-2 * r)} 0`);
        }
        this.landLayer.appendChild(svgEl('path', {d: parts.join(''), class: 'wg-land-dot'}));
    }

    private drawMarkers(): void {
        this.markerLayer.replaceChildren();

        this.markers.forEach((m, i) => {
            const [x, y] = this.project(m.lon, m.lat);
            const r = m.size ?? 2.2;
            const color = m.color ?? paletteColor(0);
            const g = svgEl('g', {class: 'wg-marker', 'data-wg-marker': i});

            if (m.label !== undefined) {
                const title = svgEl('title');
                title.textContent = m.label;
                g.appendChild(title);
            }
            if (m.pulse === true) {
                const ring = svgEl('circle', {cx: x, cy: y, r, class: 'wg-marker-pulse'});
                ring.style.stroke = color;
                g.appendChild(ring);
            }

            const dot = svgEl('circle', {cx: x, cy: y, r, class: 'wg-marker-dot'});
            dot.style.fill = color;
            g.appendChild(dot);
            this.markerLayer.appendChild(g);
        });
    }

    private drawLegend(): void {
        this.legendBox.replaceChildren();
        this.legendBox.hidden = this.legend.length === 0;

        for (const item of this.legend) {
            const row = document.createElement('div');
            const dot = document.createElement('span');
            const label = document.createElement('span');

            row.className = 'wg-legend-item';
            dot.className = 'wg-legend-dot';
            dot.style.background = item.color;
            label.textContent = item.label;
            row.append(dot, label);
            this.legendBox.appendChild(row);
        }
    }

    private markerAt(target: EventTarget | null): number {
        const g = target instanceof Element ? target.closest('[data-wg-marker]') : null;

        return g === null ? -1 : Number(g.getAttribute('data-wg-marker'));
    }

    private readonly onClick = (e: MouseEvent): void => {
        const index = this.markerAt(e.target);
        const marker = this.markers[index];

        if (marker !== undefined) {
            this.events.emit('markerClick', {marker, index, originalEvent: e});
        }
    };

    private readonly onOver = (e: PointerEvent): void => {
        const index = this.markerAt(e.target);
        const marker = this.markers[index];

        if (marker !== undefined) {
            this.events.emit('markerHover', {marker, index});
        }
    };

    private readonly onOut = (e: PointerEvent): void => {
        const from = this.markerAt(e.target);

        if (from >= 0 && from !== this.markerAt(e.relatedTarget)) {
            this.events.emit('markerHover', null);
        }
    };

}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}
