/** Camera orbiting a point on the table plane (z = 0). Angles in degrees. */
export interface HoloCamera {
    /** Turn around the vertical axis; 0 = looking along +y (the far edge at the top). */
    yaw: number;
    /** Elevation above the table, 5 … 90. */
    pitch: number;
    distance: number;
    /** The point looked at, on the table. */
    tx: number;
    ty: number;
}

/** The camera's frame plus the screen it projects onto. */
export interface HoloFrame {
    eye: [number, number, number];
    right: [number, number, number];
    up: [number, number, number];
    forward: [number, number, number];
    /** Focal length in px. */
    focal: number;
    cx: number;
    cy: number;
}

/** A projected point: screen x/y, px per world unit there (`k`) and view depth. */
export interface HoloPoint {
    x: number;
    y: number;
    k: number;
    depth: number;
}

type V3 = [number, number, number];

const D2R = Math.PI / 180;

/**
 * Pure maths of `HoloTable`: perspective camera over a table plane, project,
 * unproject onto the table, fitting, easing between cameras, visible box faces
 * and 2D hit tests. No DOM.
 */
export class HoloGeometry {

    public static frame(cam: HoloCamera, width: number, height: number, fov = 40): HoloFrame {
        const yaw = cam.yaw * D2R;
        const pitch = Math.max(1, Math.min(89.9, cam.pitch)) * D2R;
        const e: V3 = [Math.cos(pitch) * Math.sin(yaw), -Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch)];
        const eye: V3 = [cam.tx + e[0] * cam.distance, cam.ty + e[1] * cam.distance, e[2] * cam.distance];
        const forward: V3 = [-e[0], -e[1], -e[2]];
        const right: V3 = [Math.cos(yaw), Math.sin(yaw), 0];
        const up = HoloGeometry.cross(right, forward);
        const focal = height / 2 / Math.tan(fov * D2R / 2);

        return {eye, right, up, forward, focal, cx: width / 2, cy: height / 2};
    }

    /** World point → screen; `depth` ≤ 0 means behind the camera. */
    public static project(f: HoloFrame, x: number, y: number, z = 0): HoloPoint {
        const v: V3 = [x - f.eye[0], y - f.eye[1], z - f.eye[2]];
        const depth = HoloGeometry.dot(v, f.forward);
        const k = f.focal / Math.max(1e-6, depth);

        return {x: f.cx + HoloGeometry.dot(v, f.right) * k, y: f.cy - HoloGeometry.dot(v, f.up) * k, k, depth};
    }

    /** Screen point → the point on the table (z = 0) under it, or null when the ray misses the table plane. */
    public static unproject(f: HoloFrame, sx: number, sy: number): {x: number; y: number} | null {
        const a = (sx - f.cx) / f.focal;
        const b = (f.cy - sy) / f.focal;
        const d: V3 = [
            f.forward[0] + f.right[0] * a + f.up[0] * b,
            f.forward[1] + f.right[1] * a + f.up[1] * b,
            f.forward[2] + f.right[2] * a + f.up[2] * b
        ];

        if (d[2] >= -1e-9) {
            return null;
        }

        const t = -f.eye[2] / d[2];

        return {x: f.eye[0] + d[0] * t, y: f.eye[1] + d[1] * t};
    }

    /** Distance at which a w × h area of the table fills the view (looking straight down-ish), with `margin`. */
    public static fitDistance(w: number, h: number, width: number, height: number, fov = 40, margin = 1.1): number {
        const focal = height / 2 / Math.tan(fov * D2R / 2);

        return Math.max(w * focal / Math.max(1, width), h * focal / Math.max(1, height)) * margin;
    }

    /** Camera between a and b (t 0 … 1, eased); yaw takes the short way round, distance in log space. */
    public static lerp(a: HoloCamera, b: HoloCamera, t: number): HoloCamera {
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        let dy = (b.yaw - a.yaw) % 360;

        if (dy > 180) {
            dy -= 360;
        } else if (dy < -180) {
            dy += 360;
        }

        return {
            yaw: a.yaw + dy * e,
            pitch: a.pitch + (b.pitch - a.pitch) * e,
            distance: Math.exp(Math.log(a.distance) + (Math.log(b.distance) - Math.log(a.distance)) * e),
            tx: a.tx + (b.tx - a.tx) * e,
            ty: a.ty + (b.ty - a.ty) * e
        };
    }

    /**
     * Faces of the box [x, x+w] × [y, y+d] × [z0, z1] that face the eye, as
     * corner lists (world) with a shade 0 … 1 (top brightest).
     */
    public static boxFaces(eye: V3, x: number, y: number, w: number, d: number, z0: number, z1: number):
        {pts: V3[]; shade: number; top: boolean}[] {
        const out: {pts: V3[]; shade: number; top: boolean}[] = [];
        const X1 = x + w, Y1 = y + d;

        if (eye[1] < y) {
            out.push({pts: [[x, y, z0], [X1, y, z0], [X1, y, z1], [x, y, z1]], shade: 0.55, top: false});
        }
        if (eye[1] > Y1) {
            out.push({pts: [[x, Y1, z0], [X1, Y1, z0], [X1, Y1, z1], [x, Y1, z1]], shade: 0.45, top: false});
        }
        if (eye[0] < x) {
            out.push({pts: [[x, y, z0], [x, Y1, z0], [x, Y1, z1], [x, y, z1]], shade: 0.7, top: false});
        }
        if (eye[0] > X1) {
            out.push({pts: [[X1, y, z0], [X1, Y1, z0], [X1, Y1, z1], [X1, y, z1]], shade: 0.62, top: false});
        }
        if (eye[2] > z1) {
            out.push({pts: [[x, y, z1], [X1, y, z1], [X1, Y1, z1], [x, Y1, z1]], shade: 1, top: true});
        }

        return out;
    }

    /** Even–odd point in polygon. */
    public static inPolygon(px: number, py: number, poly: ReadonlyArray<{x: number; y: number}>): boolean {
        let inside = false;

        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i]!, b = poly[j]!;

            if ((a.y > py) !== (b.y > py) && px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x) {
                inside = !inside;
            }
        }

        return inside;
    }

    /** Distance from a point to a polyline. */
    public static polylineDistance(px: number, py: number, pts: ReadonlyArray<{x: number; y: number}>): number {
        let best = Infinity;

        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1]!, b = pts[i]!;
            const dx = b.x - a.x, dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));

            best = Math.min(best, Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t)));
        }

        return best;
    }

    /** Point at `t` (0 … 1) of a polyline's length, with the direction there. */
    public static along(pts: ReadonlyArray<[number, number]>, t: number): {x: number; y: number; angle: number} {
        let total = 0;

        for (let i = 1; i < pts.length; i++) {
            total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
        }

        let left = ((t % 1) + 1) % 1 * total;

        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1]!, b = pts[i]!;
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]);

            if (left <= len || i === pts.length - 1) {
                const u = len === 0 ? 0 : Math.min(1, left / len);
                return {x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, angle: Math.atan2(b[1] - a[1], b[0] - a[0])};
            }
            left -= len;
        }

        const p = pts[0] ?? [0, 0];

        return {x: p[0], y: p[1], angle: 0};
    }

    private static dot(a: V3, b: V3): number {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    private static cross(a: V3, b: V3): V3 {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }

}
