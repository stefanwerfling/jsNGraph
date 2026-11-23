type Glyph = (ctx: CanvasRenderingContext2D) => void;

/**
 * Hand-drawn line glyphs for record headers (no icon font, no assets).
 * Each glyph is drawn in a 24×24 box around the origin, stroked.
 */
export class RecordIcons {

    private static readonly glyphs: Record<string, Glyph> = {
        factory: (c) => {
            c.moveTo(-9, 9); c.lineTo(-9, -2); c.lineTo(-4, 1); c.lineTo(-4, -2); c.lineTo(1, 1); c.lineTo(1, -2);
            c.lineTo(6, 1); c.lineTo(6, -8); c.lineTo(9, -8); c.lineTo(9, 9); c.closePath();
            c.moveTo(-5, 5); c.lineTo(-3, 5); c.moveTo(0, 5); c.lineTo(2, 5);
        },
        mine: (c) => {
            c.moveTo(-8, 8); c.lineTo(6, -6);
            c.moveTo(-2, -9); c.quadraticCurveTo(7, -9, 9, 0);
            c.moveTo(-9, 9); c.lineTo(9, 9);
        },
        truck: (c) => {
            c.rect(-10, -6, 12, 10);
            c.moveTo(2, -2); c.lineTo(7, -2); c.lineTo(10, 1); c.lineTo(10, 4); c.lineTo(2, 4);
            c.moveTo(-3, 7); c.arc(-5, 7, 2, 0, Math.PI * 2);
            c.moveTo(8, 7); c.arc(6, 7, 2, 0, Math.PI * 2);
        },
        warehouse: (c) => {
            c.moveTo(-10, 9); c.lineTo(-10, -3); c.lineTo(0, -9); c.lineTo(10, -3); c.lineTo(10, 9);
            c.rect(-5, 1, 10, 8); c.moveTo(-5, 5); c.lineTo(5, 5);
        },
        store: (c) => {
            c.moveTo(-9, -8); c.lineTo(9, -8); c.lineTo(10, -3); c.lineTo(-10, -3); c.closePath();
            c.moveTo(-8, -3); c.lineTo(-8, 9); c.lineTo(8, 9); c.lineTo(8, -3);
            c.rect(-3, 2, 6, 7);
        },
        recycle: (c) => {
            for (let i = 0; i < 3; i++) {
                const a = -Math.PI / 2 + i * Math.PI * 2 / 3;
                const b = a + Math.PI * 2 / 3 - 0.5;
                c.moveTo(Math.cos(a) * 8, Math.sin(a) * 8);
                c.arc(0, 0, 8, a, b);
                const tx = Math.cos(b) * 8;
                const ty = Math.sin(b) * 8;
                c.moveTo(tx + Math.cos(b - 2.2) * 4, ty + Math.sin(b - 2.2) * 4);
                c.lineTo(tx, ty);
                c.lineTo(tx + Math.cos(b - 0.6) * 4, ty + Math.sin(b - 0.6) * 4);
            }
        },
        gear: (c) => {
            for (let i = 0; i < 8; i++) {
                const a = i * Math.PI / 4;
                c.moveTo(Math.cos(a) * 6.5, Math.sin(a) * 6.5);
                c.lineTo(Math.cos(a) * 9.5, Math.sin(a) * 9.5);
            }
            c.moveTo(6.5, 0); c.arc(0, 0, 6.5, 0, Math.PI * 2);
            c.moveTo(2.5, 0); c.arc(0, 0, 2.5, 0, Math.PI * 2);
        },
        box: (c) => {
            c.moveTo(0, -9); c.lineTo(9, -4.5); c.lineTo(9, 5); c.lineTo(0, 9.5); c.lineTo(-9, 5); c.lineTo(-9, -4.5); c.closePath();
            c.moveTo(-9, -4.5); c.lineTo(0, 0); c.lineTo(9, -4.5); c.moveTo(0, 0); c.lineTo(0, 9.5);
        },
        ship: (c) => {
            c.moveTo(-10, 2); c.lineTo(10, 2); c.lineTo(7, 8); c.lineTo(-7, 8); c.closePath();
            c.rect(-6, -4, 5, 6); c.rect(-1, -7, 5, 9);
            c.moveTo(-10, 11); c.quadraticCurveTo(-5, 9, 0, 11); c.quadraticCurveTo(5, 13, 10, 11);
        },
        bolt: (c) => {
            c.moveTo(2, -10); c.lineTo(-6, 2); c.lineTo(0, 2); c.lineTo(-2, 10); c.lineTo(6, -2); c.lineTo(0, -2); c.closePath();
        },
        leaf: (c) => {
            c.moveTo(-8, 8); c.quadraticCurveTo(-9, -8, 9, -9); c.quadraticCurveTo(8, 8, -8, 8);
            c.moveTo(-8, 8); c.lineTo(3, -3);
        },
        battery: (c) => {
            c.rect(-10, -5, 18, 10); c.rect(8, -2, 2, 4);
            c.moveTo(-6, 0); c.lineTo(-2, 0); c.moveTo(-4, -2); c.lineTo(-4, 2); c.moveTo(1, 0); c.lineTo(5, 0);
        },
        wheel: (c) => {
            c.moveTo(9, 0); c.arc(0, 0, 9, 0, Math.PI * 2);
            c.moveTo(2, 0); c.arc(0, 0, 2, 0, Math.PI * 2);
            for (let i = 0; i < 6; i++) {
                const a = i * Math.PI / 3;
                c.moveTo(Math.cos(a) * 2, Math.sin(a) * 2);
                c.lineTo(Math.cos(a) * 9, Math.sin(a) * 9);
            }
        },
        wrench: (c) => {
            c.moveTo(-8, 8); c.lineTo(2, -2);
            c.moveTo(2, -2); c.arc(5, -5, 4.2, Math.PI * 0.75, Math.PI * 2.25 - 0.9);
            c.moveTo(-9, 7); c.lineTo(-7, 9);
        },
        cart: (c) => {
            c.moveTo(-10, -8); c.lineTo(-7, -8); c.lineTo(-4, 4); c.lineTo(8, 4); c.lineTo(10, -4); c.lineTo(-6, -4);
            c.moveTo(-1, 8); c.arc(-3, 8, 2, 0, Math.PI * 2);
            c.moveTo(8, 8); c.arc(6, 8, 2, 0, Math.PI * 2);
        },
        drop: (c) => {
            c.moveTo(0, -10); c.bezierCurveTo(4, -4, 8, 0, 8, 3); c.arc(0, 3, 8, 0, Math.PI); c.bezierCurveTo(-8, 0, -4, -4, 0, -10);
        }
    };

    /** Names of the built-in glyphs. */
    public static get names(): string[] {
        return Object.keys(RecordIcons.glyphs);
    }

    /** Draw glyph `name` centred at (x, y), `size` px wide, stroked in `color`. False if unknown. */
    public static draw(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, size: number, color: string): boolean {
        const glyph = RecordIcons.glyphs[name];

        if (glyph === undefined) {
            return false;
        }

        const k = size / 24;

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(k, k);
        ctx.beginPath();
        glyph(ctx);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.7;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();

        return true;
    }

}
