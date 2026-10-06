import { RectAccent } from './RectKitTypes';

type Rgb = [number, number, number];

/**
 * Colour helpers for the rect kit: a small named accent palette and a
 * dark-base → accent shading function used to tint cells/bars by intensity.
 */
export class RectColor {

    private static readonly palette: Record<string, string> = {
        amber: '#efa14b',
        green: '#2fd27a',
        cyan: '#37c7d4',
        violet: '#9a7bff',
        blue: '#7aa2ff',
        slate: '#43527a'
    };

    private static readonly base: Rgb = [14, 22, 40];

    /** Resolve a palette key to a hex string; pass-through for raw colours. */
    public static resolve(accent: RectAccent | undefined, fallback: RectAccent = 'cyan'): string {
        const key = accent ?? fallback;

        return RectColor.palette[key] ?? key;
    }

    /** Mix the dark base toward the accent by t (0..1). */
    public static shade(accent: RectAccent, t: number): string {
        const acc = RectColor.toRgb(RectColor.resolve(accent));
        const clamped = Math.max(0, Math.min(1, t));
        const mix = (i: 0 | 1 | 2): number => Math.round(RectColor.base[i] + (acc[i] - RectColor.base[i]) * clamped);

        return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
    }

    private static toRgb(hex: string): Rgb {
        const h = hex.replace('#', '');
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);

        return [
            Number.isNaN(r) ? 0 : r,
            Number.isNaN(g) ? 0 : g,
            Number.isNaN(b) ? 0 : b
        ];
    }

}
