import { describe, expect, it } from 'vitest';
import { Vec3, VolumeMath as V } from '../src/chart/VolumeMath';

describe('VolumeMath', () => {
    it('inverts a view-projection matrix', () => {
        const vp = V.multiply(V.perspective(35, 1.5, 0.05, 50), V.lookAt(V.orbit(-30, 25, 2.5), [0, 0, 0], [0, 0, 1]));
        const inv = V.invert(vp)!;
        const id = V.multiply(vp, inv);
        for (let i = 0; i < 16; i++) {
            expect(id[i]!).toBeCloseTo(i % 5 === 0 ? 1 : 0, 4);
        }
        expect(V.invert(new Float32Array(16))).toBeNull();
    });

    it('projects the target to the centre and round-trips a ray', () => {
        const eye = V.orbit(40, 30, 3);
        const vp = V.multiply(V.perspective(35, 1, 0.05, 50), V.lookAt(eye, [0, 0, 0], [0, 0, 1]));
        const c = V.transform(vp, [0, 0, 0]);
        expect(c.x).toBeCloseTo(0, 5);
        expect(c.y).toBeCloseTo(0, 5);
        const far = V.transform(V.invert(vp)!, [0, 0, 1]);
        const dir = V.norm([far.x - eye[0], far.y - eye[1], far.z - eye[2]]);
        const toOrigin = V.norm([-eye[0], -eye[1], -eye[2]]);
        expect(V.dot(dir, toOrigin)).toBeCloseTo(1, 5);
    });

    it('intersects rays with boxes', () => {
        expect(V.rayBox([-2, 0, 0], [1, 0, 0], [-1, -1, -1], [1, 1, 1])).toEqual([1, 3]);
        expect(V.rayBox([-2, 5, 0], [1, 0, 0], [-1, -1, -1], [1, 1, 1])).toBeNull();
        expect(V.rayBox([0, 0, 0], [0, 0, 1], [-1, -1, -1], [1, 1, 1])).toEqual([0, 1]);
        expect(V.rayBox([3, 0, 0], [1, 0, 0], [-1, -1, -1], [1, 1, 1])).toBeNull();
    });

    it('splats points and samples them back', () => {
        const dims: Vec3 = [16, 16, 16];
        const {data, max} = V.splat([{x: 0.5, y: 0.5, z: 0.5, channel: 2}, {x: 0.1, y: 0.1, z: 0.1, channel: 0, weight: 2}], dims, [1.5, 1.5, 1.5]);
        expect(max[2]).toBeGreaterThan(0);
        expect(max[1]).toBe(0);
        // the densest voxel of each channel is 255
        let m2 = 0;
        for (let i = 2; i < data.length; i += 4) m2 = Math.max(m2, data[i]!);
        expect(m2).toBe(255);
        const centre = V.sample(data, dims, 0.5, 0.5, 0.5, 2);
        const off = V.sample(data, dims, 0.8, 0.5, 0.5, 2);
        expect(centre).toBeGreaterThan(0.7);
        expect(off).toBeLessThan(0.05);
        expect(V.sample(data, dims, 0.5, 0.5, 0.5, 1)).toBe(0);
    });

    it('finds the strongest sample along a ray', () => {
        const dims: Vec3 = [16, 16, 16];
        const {data} = V.splat([{x: 0.5, y: 0.5, z: 0.75, channel: 1}], dims, [1, 1, 1]);
        const hit = V.strongest(data, dims, [0, -3, 0.25], [0, 1, 0], [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], [0, 1, 0, 0])!;
        expect(hit.v).toBeCloseTo(0.5, 1);
        expect(hit.w).toBeCloseTo(0.75, 5);
        expect(hit.values[1]!).toBeGreaterThan(0.5);
        expect(V.strongest(data, dims, [0, -3, 0.25], [0, 1, 0], [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], [1, 0, 0, 0])!.sum).toBe(0);
    });
});
