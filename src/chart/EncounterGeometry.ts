/** One recorded position of an encounter: seconds since its start, metres east/north of where it started. */
export interface EncounterFix {
    t: number;
    x: number;
    y: number;
    /** The animals were under water on the way to this fix (no surface track). */
    dive?: boolean;
}

/** A fix in the drawn frame: aligned, in metres from the common origin. */
export interface AlignedFix extends EncounterFix {
    /** Heading of the segment ending here, radians, 0 = up, clockwise. */
    heading: number;
}

const TAU = Math.PI * 2;

/**
 * Pure part of `EncounterRose`: every encounter track moved to one origin and
 * turned into a common frame, the position at a shared clock, direction
 * roses, circular statistics and hit tests. Bearings are radians, 0 = up
 * (north / the reference direction), clockwise.
 */
export class EncounterGeometry {

    /** Bearing from a to b (0 = up, clockwise), 0 … 2π. */
    public static bearing(ax: number, ay: number, bx: number, by: number): number {
        return EncounterGeometry.wrap(Math.atan2(bx - ax, by - ay));
    }

    public static wrap(a: number): number {
        return ((a % TAU) + TAU) % TAU;
    }

    /** Signed smallest difference b − a, −π … π. */
    public static turn(a: number, b: number): number {
        let d = EncounterGeometry.wrap(b - a);

        if (d > Math.PI) {
            d -= TAU;
        }

        return d;
    }

    /** Rotate a point about the origin by `angle` (clockwise in the 0 = up frame). */
    public static rotate(x: number, y: number, angle: number): [number, number] {
        const c = Math.cos(angle), s = Math.sin(angle);

        return [x * c + y * s, -x * s + y * c];
    }

    /**
     * Move a track to start at the origin and turn it so that `reference`
     * (a bearing) points up. Fixes are sorted by time; headings are filled in.
     */
    public static align(fixes: ReadonlyArray<EncounterFix>, reference = 0): AlignedFix[] {
        const sorted = [...fixes].sort((a, b) => a.t - b.t);
        const o = sorted[0];

        if (o === undefined) {
            return [];
        }

        const out: AlignedFix[] = [];
        let heading = 0;

        for (const f of sorted) {
            const [x, y] = EncounterGeometry.rotate(f.x - o.x, f.y - o.y, -reference);
            const prev = out[out.length - 1];

            if (prev !== undefined && (x !== prev.x || y !== prev.y)) {
                heading = EncounterGeometry.bearing(prev.x, prev.y, x, y);
            }
            out.push({t: f.t - o.t, x, y, dive: f.dive, heading});
        }
        if (out.length > 1) {
            out[0]!.heading = out[1]!.heading;
        }

        return out;
    }

    /** Bearing of the first move that leaves `minDistance` of the start (the "first heading"), or 0. */
    public static firstHeading(fixes: ReadonlyArray<EncounterFix>, minDistance = 1): number {
        const o = fixes[0];

        if (o === undefined) {
            return 0;
        }
        for (const f of fixes) {
            if (Math.hypot(f.x - o.x, f.y - o.y) >= minDistance) {
                return EncounterGeometry.bearing(o.x, o.y, f.x, f.y);
            }
        }

        return 0;
    }

    /**
     * Index of the last fix at or before `t` and the interpolated position
     * (null before the start; the last fix after the end).
     */
    public static at(track: ReadonlyArray<AlignedFix>, t: number): {i: number; x: number; y: number; heading: number; dive: boolean} | null {
        const first = track[0];

        if (first === undefined || t < first.t) {
            return null;
        }

        let lo = 0, hi = track.length - 1;

        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (track[mid]!.t <= t) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }

        const a = track[lo]!, b = track[lo + 1];

        if (b === undefined || b.t === a.t) {
            return {i: lo, x: a.x, y: a.y, heading: a.heading, dive: false};
        }

        const u = (t - a.t) / (b.t - a.t);

        return {i: lo, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, heading: b.heading, dive: b.dive === true};
    }

    /** Path length (m), duration (s), mean speed (m/s), net displacement (m) and its bearing, straightness 0 … 1, mean |turn|. */
    public static stats(track: ReadonlyArray<AlignedFix>): {
        length: number; duration: number; speed: number; net: number; bearing: number; straightness: number; meanTurn: number;
    } {
        let length = 0, turns = 0, n = 0;

        for (let i = 1; i < track.length; i++) {
            const a = track[i - 1]!, b = track[i]!;
            length += Math.hypot(b.x - a.x, b.y - a.y);
            if (i > 1) {
                turns += Math.abs(EncounterGeometry.turn(a.heading, b.heading));
                n++;
            }
        }

        const first = track[0], last = track[track.length - 1];
        const duration = first !== undefined && last !== undefined ? last.t - first.t : 0;
        const net = last !== undefined ? Math.hypot(last.x, last.y) : 0;

        return {
            length, duration,
            speed: duration > 0 ? length / duration : 0,
            net,
            bearing: last !== undefined && net > 0 ? EncounterGeometry.bearing(0, 0, last.x, last.y) : 0,
            straightness: length > 0 ? Math.min(1, net / length) : 1,
            meanTurn: n > 0 ? turns / n : 0
        };
    }

    /** Bin of a bearing among `bins` equal sectors, the first centred on 0. */
    public static binOf(bearing: number, bins: number): number {
        return Math.floor(EncounterGeometry.wrap(bearing + Math.PI / bins) / TAU * bins) % bins;
    }

    /**
     * Direction rose: counts per sector and per category, from (bearing,
     * category, weight) items. Returns `bins` × `categories` counts.
     */
    public static rose(items: ReadonlyArray<{bearing: number; category: number; weight?: number}>, bins: number, categories: number): number[][] {
        const out = Array.from({length: bins}, () => new Array<number>(categories).fill(0));

        for (const it of items) {
            const row = out[EncounterGeometry.binOf(it.bearing, bins)];
            if (row !== undefined && it.category >= 0 && it.category < categories) {
                row[it.category]! += it.weight ?? 1;
            }
        }

        return out;
    }

    /** Circular mean bearing and resultant length 0 … 1 (1 = all the same way). */
    public static circularMean(bearings: ReadonlyArray<number>, weights?: ReadonlyArray<number>): {bearing: number; r: number} {
        let sx = 0, sy = 0, sw = 0;

        bearings.forEach((b, i) => {
            const w = weights?.[i] ?? 1;
            sx += Math.sin(b) * w;
            sy += Math.cos(b) * w;
            sw += w;
        });

        if (sw === 0) {
            return {bearing: 0, r: 0};
        }

        return {bearing: EncounterGeometry.wrap(Math.atan2(sx, sy)), r: Math.hypot(sx, sy) / sw};
    }

    /** A round ring step (1/2/5 × 10ⁿ) so that `max` gets about `count` rings. */
    public static ringStep(max: number, count = 4): number {
        if (!(max > 0)) {
            return 1;
        }

        const raw = max / count;
        const p = Math.pow(10, Math.floor(Math.log10(raw)));
        const m = raw / p;

        return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
    }

    /** Smallest distance from (px, py) to a polyline given as flat [x0, y0, x1, y1, …] screen coords. */
    public static distanceToPath(px: number, py: number, flat: ReadonlyArray<number>): number {
        let best = Infinity;

        if (flat.length === 2) {
            return Math.hypot(px - flat[0]!, py - flat[1]!);
        }
        for (let i = 2; i + 1 < flat.length; i += 2) {
            const ax = flat[i - 2]!, ay = flat[i - 1]!, bx = flat[i]!, by = flat[i + 1]!;
            const dx = bx - ax, dy = by - ay;
            const len2 = dx * dx + dy * dy;
            const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
            best = Math.min(best, Math.hypot(px - (ax + dx * u), py - (ay + dy * u)));
        }

        return best;
    }

}
