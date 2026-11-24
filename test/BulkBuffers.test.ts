import { describe, expect, it } from 'vitest';
import { BulkBuffers } from '../src/render/BulkBuffers';

const seg = (x1: number, y1: number, x2: number, y2: number, arrow = 0) => ({from: {x: x1, y: y1}, to: {x: x2, y: y2}, arrow});

describe('BulkBuffers (J11)', () => {
    it('packs a line as one instance and its arrowhead as another, with a unit direction', () => {
        const b = new BulkBuffers();

        b.line('#ff0000', 2, 0.5, seg(0, 0, 30, 40, 7));
        expect(b.lineCount).toBe(1);
        expect(b.arrowCount).toBe(1);
        expect([...b.lines.data.subarray(0, BulkBuffers.LINE_STRIDE)]).toEqual([0, 0, 30, 40, 2, 1, 0, 0, 0.5]);
        expect([...b.arrows.data.subarray(0, BulkBuffers.ARROW_STRIDE)].map((v) => Math.round(v * 100) / 100))
            .toEqual([30, 40, 0.6, 0.8, 7, 1, 0, 0, 0.5]);
    });

    it('drops invisible lines and arrowheads of zero-length segments', () => {
        const b = new BulkBuffers();

        b.line('#00ff00', 1, 0, seg(0, 0, 10, 0, 5));
        b.line('rgba(0, 0, 255, 0.5)', 1, 1, seg(3, 3, 3, 3, 5));
        expect(b.lineCount).toBe(1);
        expect(b.arrowCount).toBe(0);
        expect(b.lines.data[8]).toBe(0.5);
    });

    it('packs discs with fill and stroke alpha scaled, and grows past its capacity', () => {
        const b = new BulkBuffers();

        b.disc(5, 6, 3, '#ffffff', 'rgba(0, 0, 0, 0.5)', 0.5);
        expect([...b.discs.data.subarray(0, BulkBuffers.DISC_STRIDE)]).toEqual([5, 6, 3, 1, 1, 1, 0.5, 0, 0, 0, 0.25]);

        for (let i = 0; i < 5000; i++) {
            b.disc(i, i, 1, '#123456', '#123456', 1);
        }

        expect(b.discCount).toBe(5001);
        expect(b.discs.data[BulkBuffers.DISC_STRIDE * 5000]).toBe(4999);

        b.reset();
        expect(b.discCount + b.lineCount + b.arrowCount).toBe(0);
    });
});
