/**
 * Tiny deterministic PRNG (mulberry32). Seeded so a rect chart renders the
 * exact same picture every time instead of flickering on each paint.
 */
export class RectRandom {

    private state: number;

    public constructor(seed: number) {
        this.state = (seed | 0) || 1;
    }

    public next(): number {
        this.state = (this.state + 0x6D2B79F5) | 0;
        let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

}
