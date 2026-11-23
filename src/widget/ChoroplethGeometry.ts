import { Color } from '../util/Color';

/** A ring of [x, y] (or [lon, lat]) points; first = last is allowed. */
export type MapRing = number[][];
/** An outer ring followed by its holes. */
export type MapPolygon = MapRing[];

/** One area of a choropleth (a district, a county …). */
export interface MapRegion {
    id: string;
    name?: string;
    polygons: MapPolygon[];
}

/**
 * How coordinates become the plane: 'mercator' / 'equirectangular' take
 * [lon, lat] in degrees, 'none' takes plane [x, y] with y pointing down.
 */
export type MapProjection = 'mercator' | 'equirectangular' | 'none';

export interface MapBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Plane → view box: x' = (x − minX)·scale, y' likewise. */
export interface MapFit {
    scale: number;
    minX: number;
    minY: number;
    width: number;
    height: number;
}

interface GeoGeometry {
    type: string;
    coordinates?: unknown;
    geometries?: GeoGeometry[];
}

interface GeoFeature {
    id?: string | number;
    properties?: Record<string, unknown> | null;
    geometry: GeoGeometry | null;
}

/**
 * Pure part of `ChoroplethMap`: GeoJSON → regions, projection, bounds,
 * fitting and SVG path text. No DOM.
 */
export class ChoroplethGeometry {

    /**
     * Regions from a GeoJSON FeatureCollection (Polygon / MultiPolygon /
     * GeometryCollection); the id comes from `idProperty`, else `feature.id`,
     * else the index.
     */
    public static fromGeoJSON(collection: {features: GeoFeature[]}, options: {idProperty?: string; nameProperty?: string} = {}): MapRegion[] {
        return collection.features.map((f, i) => {
            const props = f.properties ?? {};
            const rawId = options.idProperty !== undefined ? props[options.idProperty] : f.id;
            const rawName = options.nameProperty !== undefined ? props[options.nameProperty] : props['name'];

            return {
                id: rawId === undefined || rawId === null ? String(i) : String(rawId),
                name: typeof rawName === 'string' ? rawName : undefined,
                polygons: f.geometry === null ? [] : ChoroplethGeometry.polygonsOf(f.geometry)
            };
        });
    }

    private static polygonsOf(g: GeoGeometry): MapPolygon[] {
        if (g.type === 'Polygon') {
            return [g.coordinates as MapPolygon];
        }
        if (g.type === 'MultiPolygon') {
            return g.coordinates as MapPolygon[];
        }
        if (g.type === 'GeometryCollection') {
            return (g.geometries ?? []).flatMap((x) => ChoroplethGeometry.polygonsOf(x));
        }

        return [];
    }

    /** A point in the plane (y down). */
    public static project(p: readonly number[], projection: MapProjection): [number, number] {
        const x = p[0] ?? 0;
        const y = p[1] ?? 0;

        if (projection === 'none') {
            return [x, y];
        }
        if (projection === 'equirectangular') {
            return [x, -y];
        }

        const lat = Math.max(-85, Math.min(85, y)) * Math.PI / 180;

        // in degree units, so x stays the longitude
        return [x, -Math.log(Math.tan(Math.PI / 4 + lat / 2)) * 180 / Math.PI];
    }

    public static bounds(regions: readonly MapRegion[], projection: MapProjection): MapBounds {
        const b: MapBounds = {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity};

        for (const r of regions) {
            for (const poly of r.polygons) {
                for (const p of poly[0] ?? []) {
                    const [x, y] = ChoroplethGeometry.project(p, projection);
                    b.minX = Math.min(b.minX, x);
                    b.minY = Math.min(b.minY, y);
                    b.maxX = Math.max(b.maxX, x);
                    b.maxY = Math.max(b.maxY, y);
                }
            }
        }

        return Number.isFinite(b.minX) ? b : {minX: 0, minY: 0, maxX: 1, maxY: 1};
    }

    /** Scale the bounds to `width` view-box units (height follows). */
    public static fit(b: MapBounds, width = 1000): MapFit {
        const w = Math.max(1e-9, b.maxX - b.minX);
        const scale = width / w;

        return {scale, minX: b.minX, minY: b.minY, width, height: Math.max(1, (b.maxY - b.minY) * scale)};
    }

    /**
     * SVG path of polygons (even-odd holes), in view-box units rounded to 0.1;
     * points closer than 0.3 units to the previous one are dropped.
     */
    public static path(polygons: readonly MapPolygon[], projection: MapProjection, fit: MapFit): string {
        const parts: string[] = [];

        for (const poly of polygons) {
            for (const ring of poly) {
                let lx = NaN;
                let ly = NaN;
                let n = 0;
                let d = '';

                for (const p of ring) {
                    const [px, py] = ChoroplethGeometry.project(p, projection);
                    const x = Math.round((px - fit.minX) * fit.scale * 10) / 10;
                    const y = Math.round((py - fit.minY) * fit.scale * 10) / 10;

                    if (n > 0 && Math.abs(x - lx) < 0.3 && Math.abs(y - ly) < 0.3) {
                        continue;
                    }
                    d += `${n === 0 ? 'M' : 'L'}${x} ${y}`;
                    lx = x;
                    ly = y;
                    n++;
                }
                if (n >= 3) {
                    parts.push(`${d}Z`);
                }
            }
        }

        return parts.join('');
    }

}

/** Value → colour helpers for choropleths (any CSS colours that `Color` parses). */
export class ColorScale {

    /**
     * Steps: `colors[i]` for values below `breaks[i]`, the last colour above
     * the last break (colors.length = breaks.length + 1).
     */
    public static threshold(breaks: readonly number[], colors: readonly string[]): (value: number) => string {
        return (v) => {
            let i = 0;

            while (i < breaks.length && v >= breaks[i]!) {
                i++;
            }

            return colors[Math.min(i, colors.length - 1)] ?? '#999999';
        };
    }

    /** Smooth ramp over [min, max] through the colour stops (evenly spaced). */
    public static sequential(domain: readonly [number, number], stops: readonly string[]): (value: number) => string {
        const [a, b] = domain;

        return (v) => {
            if (stops.length === 0) {
                return '#999999';
            }

            const t = Math.max(0, Math.min(1, b === a ? 0 : (v - a) / (b - a))) * (stops.length - 1);
            const i = Math.min(stops.length - 2, Math.floor(t));

            return stops.length === 1 ? stops[0]! : Color.lerp(stops[i]!, stops[i + 1]!, t - i);
        };
    }

    /** Two ramps meeting at `mid`: [low … mid colour … high]. */
    public static diverging(domain: readonly [number, number, number], colors: readonly [string, string, string]): (value: number) => string {
        const low = ColorScale.sequential([domain[0], domain[1]], [colors[0], colors[1]]);
        const high = ColorScale.sequential([domain[1], domain[2]], [colors[1], colors[2]]);

        return (v) => v < domain[1] ? low(v) : high(v);
    }

}
