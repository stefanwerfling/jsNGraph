import { Color } from '../util/Color';
import { IsoIconType } from './IsoTypes';

/** The three face shades of a solid lit from the upper left. */
export interface IsoShades {
    top: string;
    left: string;
    right: string;
    line: string;
}

const OUTLINE = '#1c2230';
const SQ2 = Math.SQRT2;

/**
 * Our own isometric icon kit, built from solids in a 100 × 140 box whose tile
 * centre sits at (50, 115): `P(u, v, h)` projects a point u/v tiles off the
 * centre (−½…½ is the tile) and h px up. Boxes, cylinders and panels get three
 * shades of one colour and a dark outline, so every icon can be recoloured.
 * No image assets.
 */
export class IsoIcons {

    public static readonly W = 100;
    public static readonly H = 140;
    public static readonly CX = 50;
    public static readonly CY = 115;

    /** Screen point in the icon box. */
    public static P(u: number, v: number, h = 0): [number, number] {
        return [IsoIcons.CX + (u - v) * 50, IsoIcons.CY + (u + v) * 25 - h];
    }

    public static shades(color: string): IsoShades {
        return {
            top: Color.lerp(color, '#ffffff', 0.45),
            left: color,
            right: Color.lerp(color, '#000000', 0.25),
            line: Color.lerp(color, '#000000', 0.55)
        };
    }

    // ---- primitives (SVG markup) ------------------------------------------------------------------------

    public static poly(points: Array<[number, number]>, fill: string, stroke = OUTLINE, width = 1.1): string {
        const d = points.map(([x, y]) => `${IsoIcons.r(x)},${IsoIcons.r(y)}`).join(' ');

        return `<polygon points="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`;
    }

    public static line(points: Array<[number, number]>, stroke: string, width = 1, extra = ''): string {
        const d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${IsoIcons.r(x)} ${IsoIcons.r(y)}`).join('');

        return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
    }

    /** A box from (u0, v0) to (u1, v1), h0…h1 px high: top, left (v = v1) and right (u = u1) faces. */
    public static box(u0: number, v0: number, u1: number, v1: number, h0: number, h1: number, color: string): string {
        const s = IsoIcons.shades(color);
        const P = IsoIcons.P;

        return IsoIcons.poly([P(u0, v1, h0), P(u1, v1, h0), P(u1, v1, h1), P(u0, v1, h1)], s.left)
            + IsoIcons.poly([P(u1, v1, h0), P(u1, v0, h0), P(u1, v0, h1), P(u1, v1, h1)], s.right)
            + IsoIcons.poly([P(u0, v0, h1), P(u1, v0, h1), P(u1, v1, h1), P(u0, v1, h1)], s.top);
    }

    /** An upright cylinder of radius r (tiles) around (uc, vc). */
    public static cylinder(uc: number, vc: number, r: number, h0: number, h1: number, color: string): string {
        const s = IsoIcons.shades(color);
        const [cx, y0] = IsoIcons.P(uc, vc, h0);
        const y1 = IsoIcons.P(uc, vc, h1)[1];
        const rx = IsoIcons.r(r * 50 * SQ2), ry = IsoIcons.r(r * 25 * SQ2);
        const R = IsoIcons.r;

        return `<path d="M${R(cx - rx)} ${R(y1)}L${R(cx - rx)} ${R(y0)}A${rx} ${ry} 0 0 0 ${R(cx + rx)} ${R(y0)}L${R(cx + rx)} ${R(y1)}Z" fill="${s.left}" stroke="${OUTLINE}" stroke-width="1.1"/>`
            // the right half in shadow
            + `<path d="M${R(cx)} ${R(y1)}L${R(cx)} ${R(y0 + ry)}A${rx} ${ry} 0 0 0 ${R(cx + rx)} ${R(y0)}L${R(cx + rx)} ${R(y1)}Z" fill="${s.right}" opacity=".7"/>`
            + `<path d="M${R(cx + rx)} ${R(y1)}L${R(cx + rx)} ${R(y0)}" stroke="${OUTLINE}" stroke-width="1.1"/>`
            + `<ellipse cx="${R(cx)}" cy="${R(y1)}" rx="${rx}" ry="${ry}" fill="${s.top}" stroke="${OUTLINE}" stroke-width="1.1"/>`;
    }

    /** The front half of a ring round a cylinder at height h (a band line). */
    public static band(uc: number, vc: number, r: number, h: number, stroke: string, width = 1.1): string {
        const [cx, y] = IsoIcons.P(uc, vc, h);
        const rx = IsoIcons.r(r * 50 * SQ2), ry = IsoIcons.r(r * 25 * SQ2);

        return `<path d="M${IsoIcons.r(cx - rx)} ${IsoIcons.r(y)}A${rx} ${ry} 0 0 0 ${IsoIcons.r(cx + rx)} ${IsoIcons.r(y)}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`;
    }

    /** A soft shadow on the tile. */
    public static shadow(r = 0.36, opacity = 0.18): string {
        return `<ellipse cx="${IsoIcons.CX}" cy="${IsoIcons.CY + 2}" rx="${IsoIcons.r(r * 50 * SQ2)}" ry="${IsoIcons.r(r * 25 * SQ2)}" fill="#000" opacity="${opacity}"/>`;
    }

    // ---- built-in icons ---------------------------------------------------------------------------------

    public static builtins(): IsoIconType[] {
        const P = IsoIcons.P;
        const box = IsoIcons.box, cyl = IsoIcons.cylinder, line = IsoIcons.line, poly = IsoIcons.poly;
        const sh = IsoIcons.shadow;
        const led = (u: number, v: number, h: number, c = '#4ade80'): string => {
            const [x, y] = P(u, v, h);
            return `<circle cx="${IsoIcons.r(x)}" cy="${IsoIcons.r(y)}" r="1.6" fill="${c}" stroke="${OUTLINE}" stroke-width=".5"/>`;
        };
        /** A unit (slot line + LEDs) on the left face (v = v1) of a box. */
        const unit = (u0: number, u1: number, v1: number, h: number, s: IsoShades): string =>
            line([P(u0 + 0.06, v1, h), P(u1 - 0.22, v1, h)], s.line, 1.4) + led(u1 - 0.13, v1, h) + led(u1 - 0.06, v1, h, '#60a5fa');
        /** Arrow on the top face at height h, from (ua, va) to (ub, vb). */
        const topArrow = (ua: number, va: number, ub: number, vb: number, h: number, c = '#ffffff'): string => {
            const a = P(ua, va, h), b = P(ub, vb, h);
            const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
            const ux = dx / l, uy = dy / l;
            const head: Array<[number, number]> = [b, [b[0] - ux * 6 - uy * 3.5, b[1] - uy * 6 + ux * 3.5], [b[0] - ux * 6 + uy * 3.5, b[1] - uy * 6 - ux * 3.5]];
            return line([a, [b[0] - ux * 4, b[1] - uy * 4]], c, 2) + poly(head, c, c, 0.5);
        };
        const panel = (u0: number, u1: number, v: number, h0: number, h1: number, lean: number, frame: string, screen: string): string =>
            poly([P(u0, v, h0), P(u1, v, h0), P(u1, v - lean, h1), P(u0, v - lean, h1)], frame)
            + poly([P(u0 + 0.04, v - lean * 0.08, h0 + 4), P(u1 - 0.04, v - lean * 0.08, h0 + 4),
                P(u1 - 0.04, v - lean * 0.92, h1 - 3), P(u0 + 0.04, v - lean * 0.92, h1 - 3)], screen, OUTLINE, 0.6);

        const icons: IsoIconType[] = [
            {
                id: 'server', label: 'Server', color: '#c9d4e6', height: 52,
                render: (c) => {
                    const s = IsoIcons.shades(c);
                    let out = sh();
                    for (let k = 0; k < 3; k++) {
                        const h0 = k * 16;
                        out += box(-0.3, -0.3, 0.3, 0.3, h0, h0 + 14, c) + unit(-0.3, 0.3, 0.3, h0 + 7, s);
                    }
                    return out;
                }
            },
            {
                id: 'rack', label: 'Rack', color: '#aab4c6', height: 92,
                render: (c) => {
                    const s = IsoIcons.shades(c);
                    let out = sh(0.4) + box(-0.32, -0.32, 0.32, 0.32, 0, 88, Color.lerp(c, '#000000', 0.35));
                    for (let k = 0; k < 6; k++) {
                        const h = 8 + k * 13;
                        out += box(-0.29, -0.29, 0.29, 0.3, h, h + 10, c) + unit(-0.29, 0.29, 0.3, h + 5, s);
                    }
                    return out;
                }
            },
            {
                id: 'database', label: 'Database', color: '#c3d1ea', height: 52,
                render: (c) => {
                    const s = IsoIcons.shades(c);
                    return sh(0.34) + cyl(0, 0, 0.3, 0, 48, c) + IsoIcons.band(0, 0, 0.3, 16, s.line, 1.6) + IsoIcons.band(0, 0, 0.3, 32, s.line, 1.6);
                }
            },
            {
                id: 'storage', label: 'Storage', color: '#b8c7dd', height: 36,
                render: (c) => {
                    const s = IsoIcons.shades(c);
                    let out = sh(0.42) + box(-0.38, -0.26, 0.38, 0.26, 0, 32, c);
                    for (let k = 0; k < 5; k++) {
                        const u = -0.32 + k * 0.14;
                        out += poly([P(u, 0.26, 6), P(u + 0.1, 0.26, 6), P(u + 0.1, 0.26, 26), P(u, 0.26, 26)], s.top, OUTLINE, 0.7) + led(u + 0.05, 0.26, 10);
                    }
                    return out;
                }
            },
            {
                id: 'laptop', label: 'Laptop', color: '#c7d0dd', height: 50,
                render: (c) => sh(0.38) + box(-0.34, -0.24, 0.34, 0.24, 0, 4, c)
                    + poly([P(-0.28, -0.08, 4), P(0.28, -0.08, 4), P(0.28, 0.18, 4), P(-0.28, 0.18, 4)], Color.lerp(c, '#000000', 0.18), OUTLINE, 0.6)
                    + panel(-0.34, 0.34, -0.24, 4, 50, 0.08, Color.lerp(c, '#000000', 0.35), '#8fb4e8')
            },
            {
                id: 'desktop', label: 'Desktop', color: '#c7d0dd', height: 62,
                render: (c) => sh(0.4) + box(-0.08, -0.08, 0.08, 0.04, 0, 12, c)
                    + panel(-0.36, 0.36, -0.06, 12, 62, 0.02, Color.lerp(c, '#000000', 0.35), '#8fb4e8')
                    + box(-0.3, 0.16, 0.3, 0.34, 0, 3, c)
            },
            {
                id: 'phone', label: 'Phone', color: '#4b5568', height: 52,
                render: (c) => sh(0.2) + box(-0.14, -0.05, 0.14, 0.03, 0, 50, c)
                    + poly([P(-0.11, 0.03, 6), P(0.11, 0.03, 6), P(0.11, 0.03, 45), P(-0.11, 0.03, 45)], '#8fb4e8', OUTLINE, 0.6)
            },
            {
                id: 'user', label: 'User', color: '#b9c8e0', height: 66,
                render: (c) => {
                    const s = IsoIcons.shades(c);
                    const [hx, hy] = P(0, 0, 56);
                    return sh(0.28) + cyl(0, 0, 0.2, 0, 34, c)
                        // shoulders: a dome over the body
                        + `<path d="M${IsoIcons.r(P(0, 0, 34)[0] - 14.1)} ${IsoIcons.r(P(0, 0, 34)[1])}Q${IsoIcons.r(hx)} ${IsoIcons.r(hy - 6)} ${IsoIcons.r(P(0, 0, 34)[0] + 14.1)} ${IsoIcons.r(P(0, 0, 34)[1])}Z" fill="${s.top}" stroke="${OUTLINE}" stroke-width="1.1"/>`
                        + `<circle cx="${IsoIcons.r(hx)}" cy="${IsoIcons.r(hy)}" r="11" fill="${s.top}" stroke="${OUTLINE}" stroke-width="1.1"/>`
                        + `<path d="M${IsoIcons.r(hx + 2)} ${IsoIcons.r(hy - 10.8)}A11 11 0 0 1 ${IsoIcons.r(hx + 2)} ${IsoIcons.r(hy + 10.8)}A13 13 0 0 0 ${IsoIcons.r(hx + 2)} ${IsoIcons.r(hy - 10.8)}Z" fill="${s.right}" opacity=".55"/>`;
                }
            },
            {
                id: 'router', label: 'Router', color: '#5b8def', height: 22,
                render: (c) => sh(0.38) + cyl(0, 0, 0.34, 0, 16, c)
                    + topArrow(-0.04, 0, -0.26, 0, 16) + topArrow(0.04, 0, 0.26, 0, 16)
                    + topArrow(0, -0.04, 0, -0.26, 16) + topArrow(0, 0.04, 0, 0.26, 16)
            },
            {
                id: 'switch', label: 'Switch', color: '#4fa3c7', height: 20,
                render: (c) => sh(0.4) + box(-0.38, -0.26, 0.38, 0.26, 0, 12, c)
                    + topArrow(-0.3, -0.1, 0.3, -0.1, 12) + topArrow(0.3, 0.1, -0.3, 0.1, 12)
            },
            {
                id: 'firewall', label: 'Firewall', color: '#e0664f', height: 42,
                render: (c) => {
                    const s = IsoIcons.shades(c);
                    let out = sh(0.42) + box(-0.38, -0.14, 0.38, 0.14, 0, 38, c);
                    for (let k = 1; k < 4; k++) {
                        const h = k * 9.5;
                        out += line([P(-0.38, 0.14, h), P(0.38, 0.14, h)], s.line, 0.9) + line([P(0.38, 0.14, h), P(0.38, -0.14, h)], s.line, 0.9);
                    }
                    for (let k = 0; k < 4; k++) {
                        const off = k % 2 === 0 ? 0 : 0.095;
                        for (let u = -0.38 + 0.19 + off; u < 0.38; u += 0.19) {
                            out += line([P(u, 0.14, k * 9.5), P(u, 0.14, k * 9.5 + 9.5)], s.line, 0.9);
                        }
                    }
                    return out;
                }
            },
            {
                id: 'loadbalancer', label: 'Load balancer', color: '#8b7cf6', height: 20,
                render: (c) => sh(0.42) + box(-0.38, -0.3, 0.38, 0.3, 0, 14, c)
                    + topArrow(-0.32, 0, -0.06, 0, 14) + topArrow(0, 0, 0.3, -0.2, 14) + topArrow(0, 0, 0.32, 0, 14) + topArrow(0, 0, 0.3, 0.2, 14)
            },
            {
                id: 'cloud', label: 'Cloud', color: '#d6e2f5', height: 58,
                render: (c) => {
                    const s = IsoIcons.shades(c);
                    const blobs: Array<[number, number, number]> = [[30, 92, 15], [48, 82, 21], [68, 90, 16], [40, 100, 14], [60, 101, 15]];
                    const circles = (fill: string, stroke: string, w: number): string =>
                        blobs.map(([x, y, r]) => `<circle cx="${x}" cy="${y - 14}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${w}"/>`).join('');
                    // outline pass, then fill on top: only the outer edge keeps a line
                    return sh(0.36, 0.12) + circles(OUTLINE, OUTLINE, 2.4) + circles(c, 'none', 0)
                        + `<path d="M22 88Q50 100 78 88" fill="none" stroke="${s.right}" stroke-width="5" opacity=".35" stroke-linecap="round"/>`;
                }
            },
            {
                id: 'queue', label: 'Queue', color: '#f2b44b', height: 24,
                render: (c) => {
                    let out = sh(0.42) + box(-0.42, -0.16, 0.42, 0.16, 0, 4, Color.lerp(c, '#000000', 0.3));
                    for (let k = 0; k < 4; k++) {
                        const u = -0.38 + k * 0.2;
                        out += box(u, -0.1, u + 0.15, 0.1, 4, 20, c);
                    }
                    return out;
                }
            },
            {
                id: 'cache', label: 'Cache', color: '#f07d5a', height: 44,
                render: (c) => sh(0.34) + box(-0.26, -0.26, 0.26, 0.26, 0, 40, c)
                    + poly([P(-0.06, 0.26, 34), P(-0.16, 0.26, 18), P(-0.02, 0.26, 20), P(-0.1, 0.26, 4), P(0.12, 0.26, 24), P(-0.02, 0.26, 22), P(0.06, 0.26, 34)], '#fff3b0', OUTLINE, 0.8)
            },
            {
                id: 'function', label: 'Function', color: '#f0a03c', height: 44,
                render: (c) => sh(0.34) + box(-0.26, -0.26, 0.26, 0.26, 0, 40, c)
                    // λ on the left face
                    + line([P(-0.16, 0.26, 32), P(-0.1, 0.26, 33), P(0.12, 0.26, 6)], '#ffffff', 3)
                    + line([P(-0.02, 0.26, 20), P(-0.16, 0.26, 6)], '#ffffff', 3)
            },
            {
                id: 'container', label: 'Container', color: '#3fae8c', height: 34,
                render: (c) => {
                    const s = IsoIcons.shades(c);
                    let out = sh(0.44) + box(-0.42, -0.2, 0.42, 0.2, 0, 30, c);
                    for (let u = -0.36; u < 0.4; u += 0.08) {
                        out += line([P(u, 0.2, 3), P(u, 0.2, 27)], s.line, 0.8);
                    }
                    return out + line([P(0.42, 0.2, 3), P(0.42, -0.2, 3)], s.line, 0.8);
                }
            },
            {
                id: 'internet', label: 'Internet', color: '#5fb4e8', height: 66,
                render: (c) => {
                    const s = IsoIcons.shades(c);
                    const [x, y] = P(0, 0, 38);
                    return sh(0.3) + `<circle cx="${x}" cy="${y}" r="26" fill="${c}" stroke="${OUTLINE}" stroke-width="1.1"/>`
                        + `<ellipse cx="${x}" cy="${y}" rx="11" ry="26" fill="none" stroke="${s.line}" stroke-width="1"/>`
                        + `<ellipse cx="${x}" cy="${y}" rx="26" ry="9" fill="none" stroke="${s.line}" stroke-width="1"/>`
                        + `<path d="M${x} ${y - 26}V${y + 26}" stroke="${s.line}" stroke-width="1"/>`
                        + `<path d="M${x - 18} ${y - 20}A26 26 0 0 0 ${x - 18} ${y + 20}" fill="none" stroke="${s.top}" stroke-width="3" opacity=".6"/>`;
                }
            },
            {
                id: 'box', label: 'Box', color: '#c4ccd8', height: 40,
                render: (c) => sh(0.34) + box(-0.26, -0.26, 0.26, 0.26, 0, 36, c)
            }
        ];

        return icons;
    }

    /** The icon box's full SVG for one icon type and colour. */
    public static svg(type: IsoIconType, color?: string): string {
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${IsoIcons.W} ${IsoIcons.H}" width="${IsoIcons.W}" height="${IsoIcons.H}">${type.render(color ?? type.color ?? '#c4ccd8')}</svg>`;
    }

    private static r(v: number): number {
        return Math.round(v * 10) / 10;
    }

}
