import { WORLD_LAND } from './WorldLand';

/** Longitude, latitude in degrees. */
export type LonLat = [number, number];

/**
 * Pure part of `WorldMap`: decodes the embedded land outlines (Natural Earth
 * 1:110m, simplified, Antarctica left out), projects them equirectangularly
 * (x = lon + 180, y = top latitude − lat; one unit per degree), builds the
 * fill path and a dot-matrix sampling of the land. No DOM.
 */
export class WorldMapGeometry {

    private static cache: LonLat[][] | null = null;

    /** One polyline-encoded ring (0.1° steps, delta coded) → lon/lat points. */
    public static decode(encoded: string): LonLat[] {
        const out: LonLat[] = [];
        let i = 0;
        let x = 0;
        let y = 0;

        const next = (): number => {
            let shift = 0;
            let result = 0;
            let b: number;

            do {
                b = encoded.charCodeAt(i++) - 63;
                result |= (b & 0x1f) << shift;
                shift += 5;
            } while (b >= 0x20 && i < encoded.length);

            return (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
        };

        while (i < encoded.length) {
            x += next();
            y += next();
            out.push([x / 10, y / 10]);
        }

        return out;
    }

    /** All land rings (decoded once). */
    public static land(): LonLat[][] {
        WorldMapGeometry.cache ??= WORLD_LAND.map((s) => WorldMapGeometry.decode(s));

        return WorldMapGeometry.cache;
    }

    /** Equirectangular projection with `top` (northmost latitude) at y = 0. */
    public static project(lon: number, lat: number, top: number): [number, number] {
        return [lon + 180, top - lat];
    }

    /** SVG path of all land rings. */
    public static path(top: number): string {
        const parts: string[] = [];

        for (const ring of WorldMapGeometry.land()) {
            ring.forEach(([lon, lat], i) => {
                const [x, y] = WorldMapGeometry.project(lon, lat, top);
                parts.push(`${i === 0 ? 'M' : 'L'}${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`);
            });
            parts.push('Z');
        }

        return parts.join('');
    }

    /** Is a point on land (even-odd over all rings)? */
    public static isLand(lon: number, lat: number): boolean {
        let inside = false;

        for (const ring of WorldMapGeometry.land()) {
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const [xi, yi] = ring[i]!;
                const [xj, yj] = ring[j]!;

                if ((yi > lat) !== (yj > lat) && lon < xi + (((lat - yi) * (xj - xi)) / (yj - yi))) {
                    inside = !inside;
                }
            }
        }

        return inside;
    }

    /**
     * Dot-matrix land: centres of a `spacing`° grid between latitudes `bottom`…`top`
     * that lie on land. One scanline per grid row (crossings of every ring edge),
     * so it costs rows × edges, not dots × edges.
     */
    public static dots(spacing: number, top: number, bottom: number): LonLat[] {
        const out: LonLat[] = [];
        const rings = WorldMapGeometry.land();
        const step = Math.max(0.25, spacing);

        for (let lat = top - (step / 2); lat > bottom; lat -= step) {
            const xs: number[] = [];

            for (const ring of rings) {
                for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                    const [xi, yi] = ring[i]!;
                    const [xj, yj] = ring[j]!;

                    if ((yi > lat) !== (yj > lat)) {
                        xs.push(xi + (((lat - yi) * (xj - xi)) / (yj - yi)));
                    }
                }
            }
            xs.sort((a, b) => a - b);

            for (let k = 0; k + 1 < xs.length; k += 2) {
                const a = xs[k]!;
                const b = xs[k + 1]!;
                const first = Math.ceil(((a + 180) / step) - 0.5);

                for (let n = first; ; n++) {
                    const lon = -180 + ((n + 0.5) * step);
                    if (lon > b) {
                        break;
                    }
                    out.push([lon, lat]);
                }
            }
        }

        return out;
    }

}
