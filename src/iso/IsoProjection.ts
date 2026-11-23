import { IsoTile } from './IsoTypes';

/** An axis-aligned box in world (unprojected screen) px. */
export interface IsoBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * Pure 2:1 dimetric projection of the floor grid. Floor coordinates (u, v)
 * are in tiles — tile {x, y} covers [x, x+1] × [y, y+1], its centre is
 * (x + ½, y + ½) — and map to world px as
 *
 *     X = (u − v) · w/2,   Y = (u + v) · w/4
 *
 * with w = tile width (the tile height on screen is w/2). Height above the
 * floor simply subtracts from Y. Everything else (camera pan/zoom) happens on
 * top of these world px.
 */
export class IsoProjection {

    public constructor(public readonly tileW = 100) {
    }

    public get tileH(): number {
        return this.tileW / 2;
    }

    /** World px of a floor point (u, v in tiles), lifted by `h` px. */
    public toWorld(u: number, v: number, h = 0): {x: number; y: number} {
        return {x: (u - v) * this.tileW / 2, y: (u + v) * this.tileW / 4 - h};
    }

    /** World px of a tile's centre. */
    public center(t: IsoTile): {x: number; y: number} {
        return this.toWorld(t.x + 0.5, t.y + 0.5);
    }

    /** Floor point (tiles, fractional) under a world point. */
    public toFloor(x: number, y: number): {u: number; v: number} {
        const a = x / (this.tileW / 2), b = y / (this.tileW / 4);

        return {u: (a + b) / 2, v: (b - a) / 2};
    }

    /** The tile under a world point. */
    public toTile(x: number, y: number): IsoTile {
        const {u, v} = this.toFloor(x, y);

        return {x: Math.floor(u), y: Math.floor(v)};
    }

    /** SVG/CSS matrix(a, b, c, d, e, f) that draws floor units (tiles) in world px. */
    public floorMatrix(): [number, number, number, number, number, number] {
        const w = this.tileW;

        return [w / 2, w / 4, -w / 2, w / 4, 0, 0];
    }

    /** Draw order: farther tiles (smaller x + y) first; ties left to right. */
    public static depth(t: IsoTile): number {
        return (t.x + t.y) * 1000 + (t.x - t.y);
    }

    /** World bounds of a floor rectangle (tiles, inclusive) — its four corners. */
    public rectBounds(from: IsoTile, to: IsoTile): IsoBounds {
        const x0 = Math.min(from.x, to.x), x1 = Math.max(from.x, to.x) + 1;
        const y0 = Math.min(from.y, to.y), y1 = Math.max(from.y, to.y) + 1;
        const pts = [this.toWorld(x0, y0), this.toWorld(x1, y0), this.toWorld(x1, y1), this.toWorld(x0, y1)];

        return {
            minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
            minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y))
        };
    }

    /** The tile range (inclusive) whose diamonds can show inside a world box — for drawing the visible grid. */
    public tilesIn(b: IsoBounds): {x0: number; x1: number; y0: number; y1: number} {
        const corners = [this.toFloor(b.minX, b.minY), this.toFloor(b.maxX, b.minY), this.toFloor(b.maxX, b.maxY), this.toFloor(b.minX, b.maxY)];

        return {
            x0: Math.floor(Math.min(...corners.map((c) => c.u))), x1: Math.ceil(Math.max(...corners.map((c) => c.u))),
            y0: Math.floor(Math.min(...corners.map((c) => c.v))), y1: Math.ceil(Math.max(...corners.map((c) => c.v)))
        };
    }

    /** Normalised inclusive tile rectangle. */
    public static rect(from: IsoTile, to: IsoTile): {x0: number; y0: number; x1: number; y1: number} {
        return {x0: Math.min(from.x, to.x), y0: Math.min(from.y, to.y), x1: Math.max(from.x, to.x), y1: Math.max(from.y, to.y)};
    }

    public static union(a: IsoBounds | null, b: IsoBounds): IsoBounds {
        return a === null ? {...b} : {
            minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
            maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY)
        };
    }

}
