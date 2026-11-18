export interface Rgba {
    r: number;
    g: number;
    b: number;
    /** 0..1 */
    a: number;
}

/**
 * Color parsing and blending without a dependency. Understands #rgb,
 * #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() (comma or space syntax) and
 * `transparent`. Anything else (named colors, hsl(), oklch(), color-mix())
 * is normalized through a canvas 2d context when a DOM is available —
 * browsers serialize any valid `fillStyle` back to hex or rgba(). Without
 * a DOM, unknown formats parse to null and callers fall back.
 */
export class Color {

    private static probe: CanvasRenderingContext2D | null | undefined;
    private static readonly cache = new Map<string, Rgba | null>();

    public static parse(input: string): Rgba | null {
        const key = input.trim().toLowerCase();

        if (Color.cache.has(key)) {
            return Color.cache.get(key) ?? null;
        }

        let result = Color.parseLiteral(key);

        if (result === null) {
            const normalized = Color.normalizeViaCanvas(key);

            if (normalized !== null && normalized !== key) {
                result = Color.parseLiteral(normalized);
            }
        }

        if (Color.cache.size > 512) {
            Color.cache.clear();
        }

        Color.cache.set(key, result);
        return result;
    }

    public static toCss(c: Rgba): string {
        const r = Math.round(c.r);
        const g = Math.round(c.g);
        const b = Math.round(c.b);

        return c.a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Color.round3(c.a)})`;
    }

    /** Blend a→b by t (0..1). Unparseable inputs return `a` unchanged (or `b` when a is unparseable). */
    public static lerp(a: string, b: string, t: number): string {
        const ca = Color.parse(a);
        const cb = Color.parse(b);

        if (ca === null || cb === null) {
            return ca === null ? b : a;
        }

        const k = Math.min(1, Math.max(0, t));

        return Color.toCss({
            r: ca.r + (cb.r - ca.r) * k,
            g: ca.g + (cb.g - ca.g) * k,
            b: ca.b + (cb.b - ca.b) * k,
            a: ca.a + (cb.a - ca.a) * k
        });
    }

    /** The same color with its alpha multiplied by `alpha`. */
    public static withAlpha(color: string, alpha: number): string {
        const c = Color.parse(color);

        if (c === null) {
            return color;
        }

        return Color.toCss({...c, a: c.a * Math.min(1, Math.max(0, alpha))});
    }

    /** A stable pick from `palette` for `key` — same key, same color, across reloads. */
    public static fromPalette(key: string, palette: ReadonlyArray<string>): string | null {
        if (palette.length === 0) {
            return null;
        }

        let hash = 2166136261;

        for (let i = 0; i < key.length; i++) {
            hash ^= key.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }

        return palette[(hash >>> 0) % palette.length] ?? null;
    }

    private static parseLiteral(s: string): Rgba | null {
        if (s === 'transparent') {
            return {r: 0, g: 0, b: 0, a: 0};
        }

        if (s.startsWith('#')) {
            return Color.parseHex(s.slice(1));
        }

        const match = /^rgba?\(([^)]*)\)$/.exec(s);

        if (match === null) {
            return null;
        }

        const parts = (match[1] ?? '').split(/[\s,/]+/).filter((p) => p.length > 0);

        if (parts.length < 3 || parts.length > 4) {
            return null;
        }

        const channel = (p: string): number => p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p);
        const r = channel(parts[0] as string);
        const g = channel(parts[1] as string);
        const b = channel(parts[2] as string);
        const alphaPart = parts[3];
        const a = alphaPart === undefined ? 1 : alphaPart.endsWith('%') ? parseFloat(alphaPart) / 100 : parseFloat(alphaPart);

        if ([r, g, b, a].some((v) => Number.isNaN(v))) {
            return null;
        }

        return {r: Color.clamp(r, 255), g: Color.clamp(g, 255), b: Color.clamp(b, 255), a: Color.clamp(a, 1)};
    }

    private static parseHex(hex: string): Rgba | null {
        if (!/^[0-9a-f]+$/.test(hex)) {
            return null;
        }

        const expand = hex.length === 3 || hex.length === 4
            ? hex.split('').map((ch) => ch + ch).join('')
            : hex;

        if (expand.length !== 6 && expand.length !== 8) {
            return null;
        }

        const num = (from: number): number => parseInt(expand.slice(from, from + 2), 16);

        return {
            r: num(0),
            g: num(2),
            b: num(4),
            a: expand.length === 8 ? num(6) / 255 : 1
        };
    }

    private static normalizeViaCanvas(s: string): string | null {
        if (Color.probe === undefined) {
            Color.probe = typeof document === 'undefined'
                ? null
                : document.createElement('canvas').getContext('2d');
        }

        const ctx = Color.probe;

        if (ctx === null) {
            return null;
        }

        // A sentinel tells "invalid color" (fillStyle keeps the old value) from a real one.
        ctx.fillStyle = '#010203';
        ctx.fillStyle = s;
        const out = String(ctx.fillStyle).toLowerCase();

        return out === '#010203' && s !== '#010203' ? null : out;
    }

    private static clamp(v: number, max: number): number {
        return Math.min(max, Math.max(0, v));
    }

    private static round3(v: number): number {
        return Math.round(v * 1000) / 1000;
    }

}
