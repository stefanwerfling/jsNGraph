/** Column-major 4×4 matrix (WebGL order). */
export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];

/** A point to splat into a volume: position 0 … 1 per axis, channel 0 … 3, weight. */
export interface VolumePoint {
    x: number;
    y: number;
    z: number;
    channel: number;
    weight?: number;
}

/**
 * Pure maths of `VolumeView`: 4×4 matrices, the orbit camera, ray/box
 * intersection, trilinear sampling and a CPU ray march (for picking), and
 * turning points into a 4-channel density volume with a Gaussian kernel.
 * Volumes are Uint8 RGBA, x fastest, then y, then z.
 */
export class VolumeMath {

    public static perspective(fovDeg: number, aspect: number, near: number, far: number): Mat4 {
        const f = 1 / Math.tan(fovDeg * Math.PI / 360);
        const m = new Float32Array(16);

        m[0] = f / aspect;
        m[5] = f;
        m[10] = (far + near) / (near - far);
        m[11] = -1;
        m[14] = 2 * far * near / (near - far);

        return m;
    }

    public static lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
        const z = VolumeMath.norm([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
        const x = VolumeMath.norm(VolumeMath.cross(up, z));
        const y = VolumeMath.cross(z, x);
        const m = new Float32Array(16);

        m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
        m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
        m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
        m[12] = -VolumeMath.dot(x, eye);
        m[13] = -VolumeMath.dot(y, eye);
        m[14] = -VolumeMath.dot(z, eye);
        m[15] = 1;

        return m;
    }

    public static multiply(a: Mat4, b: Mat4): Mat4 {
        const out = new Float32Array(16);

        for (let c = 0; c < 4; c++) {
            for (let r = 0; r < 4; r++) {
                let s = 0;
                for (let k = 0; k < 4; k++) {
                    s += a[k * 4 + r]! * b[c * 4 + k]!;
                }
                out[c * 4 + r] = s;
            }
        }

        return out;
    }

    /** Inverse of a 4×4 matrix (null when singular). */
    public static invert(m: Mat4): Mat4 | null {
        const inv = new Float32Array(16);
        const a = Array.from(m);
        const g = (i: number): number => a[i]!;

        inv[0] = g(5) * g(10) * g(15) - g(5) * g(11) * g(14) - g(9) * g(6) * g(15) + g(9) * g(7) * g(14) + g(13) * g(6) * g(11) - g(13) * g(7) * g(10);
        inv[4] = -g(4) * g(10) * g(15) + g(4) * g(11) * g(14) + g(8) * g(6) * g(15) - g(8) * g(7) * g(14) - g(12) * g(6) * g(11) + g(12) * g(7) * g(10);
        inv[8] = g(4) * g(9) * g(15) - g(4) * g(11) * g(13) - g(8) * g(5) * g(15) + g(8) * g(7) * g(13) + g(12) * g(5) * g(11) - g(12) * g(7) * g(9);
        inv[12] = -g(4) * g(9) * g(14) + g(4) * g(10) * g(13) + g(8) * g(5) * g(14) - g(8) * g(6) * g(13) - g(12) * g(5) * g(10) + g(12) * g(6) * g(9);
        inv[1] = -g(1) * g(10) * g(15) + g(1) * g(11) * g(14) + g(9) * g(2) * g(15) - g(9) * g(3) * g(14) - g(13) * g(2) * g(11) + g(13) * g(3) * g(10);
        inv[5] = g(0) * g(10) * g(15) - g(0) * g(11) * g(14) - g(8) * g(2) * g(15) + g(8) * g(3) * g(14) + g(12) * g(2) * g(11) - g(12) * g(3) * g(10);
        inv[9] = -g(0) * g(9) * g(15) + g(0) * g(11) * g(13) + g(8) * g(1) * g(15) - g(8) * g(3) * g(13) - g(12) * g(1) * g(11) + g(12) * g(3) * g(9);
        inv[13] = g(0) * g(9) * g(14) - g(0) * g(10) * g(13) - g(8) * g(1) * g(14) + g(8) * g(2) * g(13) + g(12) * g(1) * g(10) - g(12) * g(2) * g(9);
        inv[2] = g(1) * g(6) * g(15) - g(1) * g(7) * g(14) - g(5) * g(2) * g(15) + g(5) * g(3) * g(14) + g(13) * g(2) * g(7) - g(13) * g(3) * g(6);
        inv[6] = -g(0) * g(6) * g(15) + g(0) * g(7) * g(14) + g(4) * g(2) * g(15) - g(4) * g(3) * g(14) - g(12) * g(2) * g(7) + g(12) * g(3) * g(6);
        inv[10] = g(0) * g(5) * g(15) - g(0) * g(7) * g(13) - g(4) * g(1) * g(15) + g(4) * g(3) * g(13) + g(12) * g(1) * g(7) - g(12) * g(3) * g(5);
        inv[14] = -g(0) * g(5) * g(14) + g(0) * g(6) * g(13) + g(4) * g(1) * g(14) - g(4) * g(2) * g(13) - g(12) * g(1) * g(6) + g(12) * g(2) * g(5);
        inv[3] = -g(1) * g(6) * g(11) + g(1) * g(7) * g(10) + g(5) * g(2) * g(11) - g(5) * g(3) * g(10) - g(9) * g(2) * g(7) + g(9) * g(3) * g(6);
        inv[7] = g(0) * g(6) * g(11) - g(0) * g(7) * g(10) - g(4) * g(2) * g(11) + g(4) * g(3) * g(10) + g(8) * g(2) * g(7) - g(8) * g(3) * g(6);
        inv[11] = -g(0) * g(5) * g(11) + g(0) * g(7) * g(9) + g(4) * g(1) * g(11) - g(4) * g(3) * g(9) - g(8) * g(1) * g(7) + g(8) * g(3) * g(5);
        inv[15] = g(0) * g(5) * g(10) - g(0) * g(6) * g(9) - g(4) * g(1) * g(10) + g(4) * g(2) * g(9) + g(8) * g(1) * g(6) - g(8) * g(2) * g(5);

        const det = g(0) * inv[0]! + g(1) * inv[4]! + g(2) * inv[8]! + g(3) * inv[12]!;

        if (Math.abs(det) < 1e-12) {
            return null;
        }
        for (let i = 0; i < 16; i++) {
            inv[i] = inv[i]! / det;
        }

        return inv;
    }

    /** Apply a matrix to a point (with the perspective divide). */
    public static transform(m: Mat4, p: Vec3): {x: number; y: number; z: number; w: number} {
        const x = m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!;
        const y = m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!;
        const z = m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!;
        const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!;

        return {x: x / w, y: y / w, z: z / w, w};
    }

    /** Camera position orbiting the origin (z up): yaw around z, pitch above the x/y plane, degrees. */
    public static orbit(yaw: number, pitch: number, distance: number): Vec3 {
        const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;

        return [Math.cos(p) * Math.sin(y) * distance, -Math.cos(p) * Math.cos(y) * distance, Math.sin(p) * distance];
    }

    /** Entry/exit distance of a ray through an axis-aligned box, or null when it misses. */
    public static rayBox(origin: Vec3, dir: Vec3, min: Vec3, max: Vec3): [number, number] | null {
        let t0 = -Infinity, t1 = Infinity;

        for (let i = 0; i < 3; i++) {
            const o = origin[i]!, d = dir[i]!;
            if (Math.abs(d) < 1e-12) {
                if (o < min[i]! || o > max[i]!) {
                    return null;
                }
                continue;
            }
            let a = (min[i]! - o) / d, b = (max[i]! - o) / d;
            if (a > b) {
                [a, b] = [b, a];
            }
            t0 = Math.max(t0, a);
            t1 = Math.min(t1, b);
        }

        return t0 <= t1 && t1 >= 0 ? [Math.max(0, t0), t1] : null;
    }

    /** Trilinear sample of channel `c` at u/v/w 0 … 1 (texel centres like GL LINEAR + clamp), 0 … 1. */
    public static sample(vol: Uint8Array, dims: Vec3, u: number, v: number, w: number, c: number): number {
        const [nx, ny, nz] = dims;
        const fx = Math.min(nx - 1, Math.max(0, u * nx - 0.5));
        const fy = Math.min(ny - 1, Math.max(0, v * ny - 0.5));
        const fz = Math.min(nz - 1, Math.max(0, w * nz - 0.5));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
        const x1 = Math.min(nx - 1, x0 + 1), y1 = Math.min(ny - 1, y0 + 1), z1 = Math.min(nz - 1, z0 + 1);
        const tx = fx - x0, ty = fy - y0, tz = fz - z0;
        const at = (x: number, y: number, z: number): number => vol[((z * ny + y) * nx + x) * 4 + c]! / 255;
        const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

        return lerp(
            lerp(lerp(at(x0, y0, z0), at(x1, y0, z0), tx), lerp(at(x0, y1, z0), at(x1, y1, z0), tx), ty),
            lerp(lerp(at(x0, y0, z1), at(x1, y0, z1), tx), lerp(at(x0, y1, z1), at(x1, y1, z1), tx), ty),
            tz
        );
    }

    /**
     * March a ray through the box (world `min`…`max` maps to texture 0 … 1)
     * and return the strongest sample (weighted channel sum) with its
     * texture position, or null.
     */
    public static strongest(vol: Uint8Array, dims: Vec3, origin: Vec3, dir: Vec3, min: Vec3, max: Vec3, weights: ReadonlyArray<number>, steps = 200):
        {u: number; v: number; w: number; values: number[]; sum: number} | null {
        const hit = VolumeMath.rayBox(origin, dir, min, max);

        if (hit === null) {
            return null;
        }

        let best: {u: number; v: number; w: number; values: number[]; sum: number} | null = null;

        for (let i = 0; i <= steps; i++) {
            const t = hit[0] + (hit[1] - hit[0]) * i / steps;
            const p: Vec3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
            const u = (p[0] - min[0]) / (max[0] - min[0]), v = (p[1] - min[1]) / (max[1] - min[1]), w = (p[2] - min[2]) / (max[2] - min[2]);
            const values = [0, 1, 2, 3].map((c) => VolumeMath.sample(vol, dims, u, v, w, c));
            const sum = values.reduce((s, x, c) => s + x * (weights[c] ?? 0), 0);
            if (best === null || sum > best.sum) {
                best = {u, v, w, values, sum};
            }
        }

        return best;
    }

    /**
     * Splat points into an RGBA volume with a Gaussian of `sigma` voxels
     * (per axis), each channel normalised so its densest voxel is 255 (or by
     * `scale` when given: value × scale).
     */
    public static splat(points: ReadonlyArray<VolumePoint>, dims: Vec3, sigma: Vec3, options: {scale?: number[]; wrapZ?: boolean} = {}): {
        data: Uint8Array; max: number[];
    } {
        const [nx, ny, nz] = dims;
        const acc = new Float32Array(nx * ny * nz * 4);
        const r = sigma.map((s) => Math.max(1, Math.ceil(s * 2.5)));
        const k = [0, 1, 2].map((a) => Array.from({length: 2 * r[a]! + 1}, (_, i) => {
            const d = i - r[a]!;
            return Math.exp(-0.5 * d * d / (sigma[a]! * sigma[a]!));
        }));

        for (const p of points) {
            const cx = p.x * nx - 0.5, cy = p.y * ny - 0.5, cz = p.z * nz - 0.5;
            const ix = Math.round(cx), iy = Math.round(cy), iz = Math.round(cz);
            const w = p.weight ?? 1;
            const c = Math.max(0, Math.min(3, p.channel));

            for (let dz = -r[2]!; dz <= r[2]!; dz++) {
                let z = iz + dz;
                if (options.wrapZ === true) {
                    z = ((z % nz) + nz) % nz;
                } else if (z < 0 || z >= nz) {
                    continue;
                }
                const kz = k[2]![dz + r[2]!]! * w;
                for (let dy = -r[1]!; dy <= r[1]!; dy++) {
                    const y = iy + dy;
                    if (y < 0 || y >= ny) {
                        continue;
                    }
                    const kzy = kz * k[1]![dy + r[1]!]!;
                    for (let dx = -r[0]!; dx <= r[0]!; dx++) {
                        const x = ix + dx;
                        if (x < 0 || x >= nx) {
                            continue;
                        }
                        const i = ((z * ny + y) * nx + x) * 4 + c;
                        acc[i] = acc[i]! + kzy * k[0]![dx + r[0]!]!;
                    }
                }
            }
        }

        const max = [0, 0, 0, 0];

        for (let i = 0; i < acc.length; i++) {
            const c = i & 3;
            if (acc[i]! > max[c]!) {
                max[c] = acc[i]!;
            }
        }

        const data = new Uint8Array(acc.length);

        for (let i = 0; i < acc.length; i++) {
            const c = i & 3;
            const f = options.scale?.[c] ?? (max[c]! > 0 ? 1 / max[c]! : 0);
            data[i] = Math.max(0, Math.min(255, Math.round(acc[i]! * f * 255)));
        }

        return {data, max};
    }

    public static dot(a: Vec3, b: Vec3): number {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    public static cross(a: Vec3, b: Vec3): Vec3 {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }

    public static norm(a: Vec3): Vec3 {
        const l = Math.hypot(a[0], a[1], a[2]) || 1;

        return [a[0] / l, a[1] / l, a[2] / l];
    }

}
