import { describe, expect, it } from 'vitest';
import { RenderLoop } from '../src/view/RenderLoop';

/** A manual frame clock: frames only run when the test calls flush(). */
class FakeFrames {

    public queue = new Map<number, (t: number) => void>();
    private next = 1;
    private now = 0;

    public readonly request = (cb: (t: number) => void): number => {
        const id = this.next++;
        this.queue.set(id, cb);
        return id;
    };

    public readonly cancel = (id: number): void => {
        this.queue.delete(id);
    };

    public flush(): number {
        const batch = [...this.queue.values()];
        this.queue.clear();
        this.now += 16;

        for (const cb of batch) {
            cb(this.now);
        }

        return batch.length;
    }

}

describe('RenderLoop', () => {
    it('does nothing until a frame is requested, and coalesces requests', () => {
        const frames = new FakeFrames();
        let drawn = 0;
        const loop = new RenderLoop(() => {
            drawn++;
            return false;
        }, frames.request, frames.cancel);

        expect(frames.flush()).toBe(0);
        loop.request();
        loop.request();
        loop.request();
        expect(frames.flush()).toBe(1);
        expect(drawn).toBe(1);
        expect(frames.flush()).toBe(0);
    });

    it('keeps going while the frame callback says it is animating, then idles', () => {
        const frames = new FakeFrames();
        let remaining = 3;
        let drawn = 0;
        const loop = new RenderLoop(() => {
            drawn++;
            return --remaining > 0;
        }, frames.request, frames.cancel);

        loop.request();

        while (frames.flush() > 0) {
            // drain
        }

        expect(drawn).toBe(3);
        expect(loop.isRunning).toBe(false);
    });

    it('pause blocks frames, resume draws a catch-up frame', () => {
        const frames = new FakeFrames();
        let drawn = 0;
        const loop = new RenderLoop(() => {
            drawn++;
            return false;
        }, frames.request, frames.cancel);

        loop.request();
        loop.pause();
        expect(frames.flush()).toBe(0);
        loop.request();
        expect(loop.hasPending).toBe(true);
        expect(frames.flush()).toBe(0);
        expect(drawn).toBe(0);

        loop.resume();
        expect(frames.flush()).toBe(1);
        expect(drawn).toBe(1);
    });

    it('destroy cancels the scheduled frame and ignores later requests', () => {
        const frames = new FakeFrames();
        let drawn = 0;
        const loop = new RenderLoop(() => {
            drawn++;
            return true;
        }, frames.request, frames.cancel);

        loop.request();
        loop.destroy();
        loop.request();
        expect(frames.flush()).toBe(0);
        expect(drawn).toBe(0);
    });
});
