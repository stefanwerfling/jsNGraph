import { IsoTile } from './IsoTypes';

export interface IsoRouteOptions {
    /** Tiles to avoid ("x,y" keys, e.g. occupied by items); passing through costs `blockedCost` extra. */
    blocked?: ReadonlySet<string>;
    /** Extra cost per change of direction (default 0.6): fewer, longer straight runs. */
    turnCost?: number;
    /** Extra cost per blocked tile crossed (default 12). */
    blockedCost?: number;
    /** How far (tiles) the search may wander outside the box around the ends (default 8). */
    margin?: number;
}

/** A point on a route in floor units, with the unit direction of travel there. */
export interface IsoRoutePoint {
    u: number;
    v: number;
    du: number;
    dv: number;
}

/**
 * Pure connector routing on the tile grid: A* with 4 neighbours, a cost for
 * every turn and for crossing occupied tiles (the ends themselves are free),
 * waypoints as a chain of legs, then the corners only. Routes run through
 * tile centres, so on screen they follow the isometric axes.
 */
export class IsoRoute {

    private static readonly DIRS: ReadonlyArray<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];

    public static key(t: IsoTile): string {
        return `${t.x},${t.y}`;
    }

    /** Tiles from `from` to `to` (both included) through every waypoint in order. */
    public static route(from: IsoTile, to: IsoTile, via: ReadonlyArray<IsoTile> = [], options: IsoRouteOptions = {}): IsoTile[] {
        const stops = [from, ...via, to];
        const out: IsoTile[] = [];

        for (let i = 0; i + 1 < stops.length; i++) {
            const leg = IsoRoute.leg(stops[i]!, stops[i + 1]!, options, out.length >= 2 ? IsoRoute.dirOf(out[out.length - 2]!, out[out.length - 1]!) : -1);
            out.push(...(out.length > 0 ? leg.slice(1) : leg));
        }

        return out;
    }

    /** One A* leg. `startDir` (0…3 or −1) carries the direction in from the previous leg, so a waypoint is no free turn. */
    public static leg(from: IsoTile, to: IsoTile, options: IsoRouteOptions = {}, startDir = -1): IsoTile[] {
        if (from.x === to.x && from.y === to.y) {
            return [{...from}];
        }
        const turn = options.turnCost ?? 0.6;
        const blockedCost = options.blockedCost ?? 12;
        const margin = options.margin ?? 8;
        const blocked = options.blocked ?? new Set<string>();
        const x0 = Math.min(from.x, to.x) - margin, x1 = Math.max(from.x, to.x) + margin;
        const y0 = Math.min(from.y, to.y) - margin, y1 = Math.max(from.y, to.y) + margin;
        const W = x1 - x0 + 1, H = y1 - y0 + 1;
        // state = (tile, direction it was entered with); dir 4 = the start
        const idx = (x: number, y: number, d: number): number => ((y - y0) * W + (x - x0)) * 5 + d;
        const g = new Float64Array(W * H * 5).fill(Infinity);
        const prev = new Int32Array(W * H * 5).fill(-1);
        const h = (x: number, y: number): number => Math.abs(x - to.x) + Math.abs(y - to.y);
        const heap = new IsoHeap();
        const s = idx(from.x, from.y, startDir >= 0 ? startDir : 4);

        g[s] = 0;
        heap.push(s, h(from.x, from.y));

        let goal = -1;
        while (heap.size > 0) {
            const cur = heap.pop();
            const d = cur % 5, cell = (cur - d) / 5;
            const cx = cell % W + x0, cy = Math.floor(cell / W) + y0;

            if (cx === to.x && cy === to.y) {
                goal = cur;
                break;
            }
            for (let nd = 0; nd < 4; nd++) {
                const nx = cx + IsoRoute.DIRS[nd]![0], ny = cy + IsoRoute.DIRS[nd]![1];
                if (nx < x0 || nx > x1 || ny < y0 || ny > y1) {
                    continue;
                }
                // no going straight back
                if (d < 4 && (nd + 2) % 4 === d) {
                    continue;
                }
                const isEnd = nx === to.x && ny === to.y;
                const cost = 1 + (d < 4 && d !== nd ? turn : 0) + (!isEnd && blocked.has(`${nx},${ny}`) ? blockedCost : 0);
                const n = idx(nx, ny, nd);
                const ng = g[cur]! + cost;
                if (ng < g[n]!) {
                    g[n] = ng;
                    prev[n] = cur;
                    heap.push(n, ng + h(nx, ny));
                }
            }
        }

        if (goal < 0) {
            return IsoRoute.elbow(from, to);
        }
        const path: IsoTile[] = [];
        for (let cur = goal; cur >= 0; cur = prev[cur]!) {
            const cell = (cur - cur % 5) / 5;
            path.push({x: cell % W + x0, y: Math.floor(cell / W) + y0});
        }

        return path.reverse();
    }

    /** Fallback L route: along x, then along y. */
    public static elbow(from: IsoTile, to: IsoTile): IsoTile[] {
        const out: IsoTile[] = [];
        const sx = Math.sign(to.x - from.x), sy = Math.sign(to.y - from.y);

        for (let x = from.x; x !== to.x; x += sx) {
            out.push({x, y: from.y});
        }
        for (let y = from.y; y !== to.y; y += sy) {
            out.push({x: to.x, y});
        }
        out.push({...to});

        return out;
    }

    /** Only the ends and the tiles where the direction changes. */
    public static corners(path: ReadonlyArray<IsoTile>): IsoTile[] {
        if (path.length <= 2) {
            return path.map((t) => ({...t}));
        }
        const out: IsoTile[] = [{...path[0]!}];

        for (let i = 1; i + 1 < path.length; i++) {
            if (IsoRoute.dirOf(path[i - 1]!, path[i]!) !== IsoRoute.dirOf(path[i]!, path[i + 1]!)) {
                out.push({...path[i]!});
            }
        }
        out.push({...path[path.length - 1]!});

        return out;
    }

    /** Floor polyline through the tile centres (flat [u, v, …]). */
    public static centres(tiles: ReadonlyArray<IsoTile>): number[] {
        return tiles.flatMap((t) => [t.x + 0.5, t.y + 0.5]);
    }

    public static measure(line: ReadonlyArray<number>): number {
        let l = 0;

        for (let i = 0; i + 3 < line.length; i += 2) {
            l += Math.hypot(line[i + 2]! - line[i]!, line[i + 3]! - line[i + 1]!);
        }

        return l;
    }

    /** Point and direction at a distance (floor units) along a polyline, clamped to its ends. */
    public static atDistance(line: ReadonlyArray<number>, dist: number): IsoRoutePoint {
        let left = Math.max(0, dist);
        let last: IsoRoutePoint = {u: line[0] ?? 0, v: line[1] ?? 0, du: 1, dv: 0};

        for (let i = 0; i + 3 < line.length; i += 2) {
            const du = line[i + 2]! - line[i]!, dv = line[i + 3]! - line[i + 1]!;
            const l = Math.hypot(du, dv);
            if (l === 0) {
                continue;
            }
            last = {u: line[i + 2]!, v: line[i + 3]!, du: du / l, dv: dv / l};
            if (left <= l) {
                return {u: line[i]! + du / l * left, v: line[i + 1]! + dv / l * left, du: du / l, dv: dv / l};
            }
            left -= l;
        }

        return last;
    }

    /** Point at a fraction 0…1 of the length. */
    public static at(line: ReadonlyArray<number>, t: number): IsoRoutePoint {
        return IsoRoute.atDistance(line, IsoRoute.measure(line) * Math.max(0, Math.min(1, t)));
    }

    /** SVG path data of a floor polyline. */
    public static pathData(line: ReadonlyArray<number>): string {
        let d = '';

        for (let i = 0; i + 1 < line.length; i += 2) {
            d += `${i === 0 ? 'M' : 'L'}${line[i]} ${line[i + 1]}`;
        }

        return d;
    }

    /** Arrowhead triangle (floor units) with its tip at p, pointing along p's direction. */
    public static arrow(p: IsoRoutePoint, length = 0.26, width = 0.22): number[] {
        const bu = p.u - p.du * length, bv = p.v - p.dv * length;
        const nu = -p.dv * width / 2, nv = p.du * width / 2;

        return [p.u, p.v, bu + nu, bv + nv, bu - nu, bv - nv];
    }

    private static dirOf(a: IsoTile, b: IsoTile): number {
        const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);

        return IsoRoute.DIRS.findIndex(([x, y]) => x === dx && y === dy);
    }

}

/** Minimal binary min-heap of (id, priority). */
class IsoHeap {

    private ids: number[] = [];
    private pr: number[] = [];

    public get size(): number {
        return this.ids.length;
    }

    public push(id: number, p: number): void {
        this.ids.push(id);
        this.pr.push(p);
        let i = this.ids.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.pr[parent]! <= this.pr[i]!) {
                break;
            }
            this.swap(i, parent);
            i = parent;
        }
    }

    public pop(): number {
        const top = this.ids[0]!;
        const lastId = this.ids.pop()!, lastP = this.pr.pop()!;

        if (this.ids.length > 0) {
            this.ids[0] = lastId;
            this.pr[0] = lastP;
            let i = 0;
            for (;;) {
                const l = i * 2 + 1, r = l + 1;
                let m = i;
                if (l < this.ids.length && this.pr[l]! < this.pr[m]!) {
                    m = l;
                }
                if (r < this.ids.length && this.pr[r]! < this.pr[m]!) {
                    m = r;
                }
                if (m === i) {
                    break;
                }
                this.swap(i, m);
                i = m;
            }
        }

        return top;
    }

    private swap(a: number, b: number): void {
        [this.ids[a], this.ids[b]] = [this.ids[b]!, this.ids[a]!];
        [this.pr[a], this.pr[b]] = [this.pr[b]!, this.pr[a]!];
    }

}
