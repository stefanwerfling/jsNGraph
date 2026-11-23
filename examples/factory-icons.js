// Factory icon set for the isometric editor, drawn from IsoIcons' public solids (box, cylinder, poly, line, band).
// Every icon lives in the 100 × 140 icon box with the tile centre at (50, 115); P(u, v, h) = u/v tiles off the centre,
// h px up. One base colour per icon, faces shaded from it. Exposes window.FactoryIcons = IsoIconType[].
(() => {
    const {IsoIcons} = window.JSNGraph;
    const {P, box, cylinder: cyl, poly, line, band} = IsoIcons;
    const sh = (r = 0.36, o = 0.2) => IsoIcons.shadow(r, o);
    const shade = (c) => IsoIcons.shades(c);
    const OUT = '#1c2230';
    const r1 = (n) => Math.round(n * 10) / 10;
    const dot = (u, v, h, r, fill, stroke = OUT) => {
        const [x, y] = P(u, v, h);
        return `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width=".6"/>`;
    };
    const ellipse = (u, v, h, rx, ry, fill, stroke = OUT) => {
        const [x, y] = P(u, v, h);
        return `<ellipse cx="${r1(x)}" cy="${r1(y)}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width=".7"/>`;
    };
    /** A flat panel on the left face (v = const) from u0…u1, h0…h1. */
    const faceL = (u0, u1, v, h0, h1, fill, stroke = OUT, w = 0.7) => poly([P(u0, v, h0), P(u1, v, h0), P(u1, v, h1), P(u0, v, h1)], fill, stroke, w);
    /** A flat panel on the right face (u = const) from v0…v1. */
    const faceR = (u, v0, v1, h0, h1, fill, stroke = OUT, w = 0.7) => poly([P(u, v1, h0), P(u, v0, h0), P(u, v0, h1), P(u, v1, h1)], fill, stroke, w);
    const led = (u, v, h, c) => dot(u, v, h, 1.7, c);
    const wood = '#c08a4e';
    const steel = '#c6cfdb';

    const pallet = (h = 0) => box(-0.34, -0.34, 0.34, 0.34, h, h + 5, wood);
    const crates = (color, h = 5, rows = 2, tall = 16) => {
        let out = '';
        for (let k = 0; k < rows; k++) {
            const h0 = h + k * tall;
            out += box(-0.32, -0.32, 0, 0, h0, h0 + tall - 1, color) + box(0.02, -0.32, 0.32, 0, h0, h0 + tall - 1, color)
                + box(-0.32, 0.02, 0, 0.32, h0, h0 + tall - 1, color) + box(0.02, 0.02, 0.32, 0.32, h0, h0 + tall - 1, color);
        }
        return out;
    };
    const fruitTop = (h, colors) => {
        let out = '';
        let i = 0;
        for (let a = -0.24; a <= 0.25; a += 0.12) {
            for (let b = -0.24; b <= 0.25; b += 0.12) {
                out += dot(a, b, h, 2.6, colors[i++ % colors.length]);
            }
        }
        return out;
    };

    const icons = [
        {
            id: 'truck', label: 'Truck', color: '#e8edf4', height: 46,
            render: (c) => sh(0.5, 0.22)
                // trailer, then the cab in front (towards +u)
                + box(-0.48, -0.2, 0.18, 0.2, 7, 44, c)
                + faceL(-0.44, 0.14, 0.2, 18, 34, 'rgba(91,141,239,.25)', 'none')
                + line([P(-0.44, 0.2, 26), P(0.14, 0.2, 26)], '#5b8def', 3)
                + box(0.21, -0.18, 0.48, 0.18, 5, 34, '#d9534f')
                + faceR(0.48, -0.14, 0.14, 20, 31, '#9ec3f0')
                + box(-0.46, -0.16, 0.46, 0.16, 2, 7, '#3a4252')
                + dot(-0.36, 0.2, 5, 4.2, '#262b36') + dot(-0.22, 0.2, 5, 4.2, '#262b36') + dot(0.34, 0.18, 5, 4.2, '#262b36')
        },
        {
            id: 'forklift', label: 'Forklift', color: '#f2b632', height: 46,
            render: (c) => sh(0.3) + forklift(c, false)
        },
        {
            id: 'forklift-load', label: 'Forklift (loaded)', color: '#f2b632', height: 46,
            render: (c) => sh(0.32) + forklift(c, true)
        },
        {
            id: 'pallet', label: 'Pallet', color: '#c9a46a', height: 38,
            render: (c) => sh(0.38) + pallet() + crates(c, 5, 2)
        },
        {
            id: 'pallet-fruit', label: 'Fruit bins', color: '#b07a43', height: 26,
            render: (c) => sh(0.38) + pallet() + box(-0.32, -0.32, 0.32, 0.32, 5, 24, c)
                + poly([P(-0.28, -0.28, 23), P(0.28, -0.28, 23), P(0.28, 0.28, 23), P(-0.28, 0.28, 23)], '#5b3b1f', OUT, 0.5)
                + fruitTop(24, ['#d93b30', '#e8572e', '#9dc03b', '#c9302c'])
        },
        {
            id: 'pallet-wrapped', label: 'Wrapped pallet', color: '#dfe6ef', height: 46,
            render: (c) => sh(0.38) + pallet() + crates('#e3a64a', 5, 2, 20)
                + box(-0.34, -0.34, 0.34, 0.34, 5, 45, c).replace(/fill="([^"]+)"/g, 'fill="$1" fill-opacity=".55"')
        },
        {
            id: 'crate', label: 'Crate', color: '#e3a64a', height: 20,
            render: (c) => box(-0.18, -0.18, 0.18, 0.18, 0, 18, c) + line([P(-0.18, 0.18, 9), P(0.18, 0.18, 9)], shade(c).line, 0.8)
        },
        {
            id: 'tray', label: 'Bottle tray', color: '#8fd06a', height: 16,
            render: (c) => {
                let out = box(-0.22, -0.16, 0.22, 0.16, 0, 6, '#5e6a7d');
                for (let a = -0.15; a <= 0.16; a += 0.1) {
                    for (let b = -0.09; b <= 0.1; b += 0.09) {
                        out += cyl(a, b, 0.035, 6, 16, c);
                    }
                }
                return out;
            }
        },
        {
            id: 'pallet-rack', label: 'Pallet rack', color: '#3f6fd8', height: 84,
            render: (c) => {
                let out = sh(0.44, 0.15);
                const beam = '#f08a24';
                for (const h of [0, 28, 56]) {
                    out += box(-0.42, -0.36, 0.42, 0.36, h, h + 2.5, beam);
                    if (h < 56) {
                        out += pallet(h + 2.5) + crates(h === 0 ? '#e3a64a' : '#d9534f', h + 7.5, 1, 18);
                    }
                }
                for (const [u, v] of [[-0.42, -0.36], [0.4, -0.36], [-0.42, 0.34], [0.4, 0.34]]) {
                    out += box(u, v, u + 0.03, v + 0.03, 0, 82, c);
                }
                return out;
            }
        },
        {
            id: 'washer', label: 'Fruit washer', color: '#8ab4e8', height: 50,
            render: (c) => sh(0.42) + box(-0.4, -0.28, 0.4, 0.28, 0, 30, steel)
                + faceL(-0.34, 0.34, 0.28, 8, 24, '#6fb6ef')
                + dot(-0.2, 0.28, 18, 2, '#ffffff', 'none') + dot(0.05, 0.28, 13, 2.4, '#ffffff', 'none') + dot(0.22, 0.28, 19, 1.8, '#ffffff', 'none')
                + box(-0.36, -0.24, 0.0, 0.24, 30, 34, c) + box(0.04, -0.24, 0.36, 0.24, 30, 48, shade(c).right)
                + line([P(0.2, -0.24, 48), P(0.2, -0.36, 62)], '#7d8798', 3)
        },
        {
            id: 'hopper', label: 'Mill', color: '#b9c4d4', height: 70,
            render: (c) => {
                const s = shade(c);
                return sh(0.36) + [[-0.24, -0.24], [0.2, -0.24], [-0.24, 0.2], [0.2, 0.2]].map(([u, v]) => box(u, v, u + 0.04, v + 0.04, 0, 30, '#6e7a8c')).join('')
                    + box(-0.14, -0.14, 0.14, 0.14, 22, 34, s.right)
                    + poly([P(-0.14, 0.14, 34), P(0.14, 0.14, 34), P(0.34, 0.34, 66), P(-0.34, 0.34, 66)], s.left)
                    + poly([P(0.14, 0.14, 34), P(0.14, -0.14, 34), P(0.34, -0.34, 66), P(0.34, 0.34, 66)], s.right)
                    + poly([P(-0.34, -0.34, 66), P(0.34, -0.34, 66), P(0.34, 0.34, 66), P(-0.34, 0.34, 66)], s.top)
                    + poly([P(-0.28, -0.28, 66), P(0.28, -0.28, 66), P(0.28, 0.28, 66), P(-0.28, 0.28, 66)], '#7a3b22', OUT, 0.5)
                    + fruitTop(66.5, ['#d93b30', '#9dc03b', '#e8572e']);
            }
        },
        {
            id: 'press', label: 'Belt press', color: '#9fb1c8', height: 56,
            render: (c) => sh(0.44) + box(-0.42, -0.26, 0.42, 0.26, 0, 14, '#6e7a8c')
                + box(-0.38, -0.22, 0.38, 0.22, 14, 40, c)
                + faceL(-0.34, 0.34, 0.22, 18, 34, '#30384a')
                + cyl(-0.18, 0.22, 0.07, 22, 30, '#d1dae6') + cyl(0.0, 0.22, 0.07, 20, 28, '#d1dae6') + cyl(0.18, 0.22, 0.07, 22, 30, '#d1dae6')
                + box(-0.1, -0.1, 0.1, 0.1, 40, 54, shade(c).right)
                + box(0.42, -0.12, 0.5, 0.12, 2, 10, '#e8b923')
        },
        {
            id: 'tank', label: 'Tank', color: steel, height: 96,
            render: (c) => {
                const s = shade(c);
                return sh(0.36) + [[-0.2, 0], [0.2, 0], [0, -0.2], [0, 0.2]].map(([u, v]) => line([P(u, v, 0), P(u * 0.9, v * 0.9, 12)], '#5b6575', 2.4)).join('')
                    + cyl(0, 0, 0.32, 12, 88, c) + band(0, 0, 0.32, 30, s.line, 1) + band(0, 0, 0.32, 62, s.line, 1)
                    + ellipse(0, 0, 88, 8, 4, s.right) + line([P(0, 0, 92), P(0.1, -0.1, 98)], '#7d8798', 2.5)
                    + faceL(-0.06, 0.06, 0.3, 40, 56, '#2b3240');
            }
        },
        {
            id: 'heatx', label: 'Pasteuriser', color: '#d8dee8', height: 58,
            render: (c) => {
                let out = sh(0.42) + box(-0.38, -0.2, 0.38, 0.2, 0, 8, '#6e7a8c') + box(-0.34, -0.16, -0.24, 0.16, 8, 50, '#5b8def')
                    + box(0.24, -0.16, 0.34, 0.16, 8, 50, '#5b8def');
                for (let u = -0.22; u <= 0.2; u += 0.055) {
                    out += box(u, -0.14, u + 0.04, 0.14, 10, 46, c);
                }
                return out + line([P(-0.29, 0.1, 50), P(-0.29, 0.1, 58), P(0.29, 0.1, 58), P(0.29, 0.1, 50)], '#e0664f', 3)
                    + line([P(-0.29, -0.1, 50), P(-0.29, -0.1, 55), P(0.29, -0.1, 55), P(0.29, -0.1, 50)], '#2fb3a5', 3);
            }
        },
        {
            id: 'filler', label: 'Filler', color: '#c3cede', height: 60,
            render: (c) => {
                let out = sh(0.44) + box(-0.4, -0.4, 0.4, 0.4, 0, 18, '#6e7a8c') + cyl(0, 0, 0.3, 18, 28, c);
                for (let k = 0; k < 12; k++) {
                    const a = k / 12 * Math.PI * 2;
                    out += cyl(Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0.035, 28, 40, '#8fd06a');
                }
                return out + cyl(0, 0, 0.07, 28, 58, '#9aa6b8')
                    + poly([P(-0.4, 0.4, 18), P(0.4, 0.4, 18), P(0.4, 0.4, 56), P(-0.4, 0.4, 56)], 'rgba(170,210,255,.18)', '#9fb3cc', 0.8)
                    + poly([P(0.4, 0.4, 18), P(0.4, -0.4, 18), P(0.4, -0.4, 56), P(0.4, 0.4, 56)], 'rgba(170,210,255,.12)', '#9fb3cc', 0.8);
            }
        },
        {
            id: 'labeller', label: 'Capper & labeller', color: '#aab8cc', height: 52,
            render: (c) => sh(0.42) + box(-0.4, -0.24, 0.4, 0.24, 0, 26, c)
                + faceL(-0.32, -0.04, 0.24, 8, 22, '#2b3240') + led(0.12, 0.24, 18, '#4ade80') + led(0.2, 0.24, 18, '#f5b93b')
                + cyl(-0.16, 0, 0.14, 26, 34, '#f2f4f8') + cyl(-0.16, 0, 0.05, 34, 36, '#6e7a8c')
                + box(0.08, -0.08, 0.26, 0.1, 26, 48, shade(c).right) + cyl(0.17, 0.01, 0.05, 48, 52, '#d9534f')
        },
        {
            id: 'conveyor', label: 'Conveyor', color: '#5e6a7d', height: 16,
            render: (c) => {
                let out = [[-0.44, -0.12], [0.4, -0.12], [-0.44, 0.08], [0.4, 0.08]].map(([u, v]) => box(u, v, u + 0.04, v + 0.04, 0, 10, '#4a5262')).join('')
                    + box(-0.48, -0.14, 0.48, 0.14, 10, 14, c);
                for (let u = -0.4; u <= 0.41; u += 0.1) {
                    out += line([P(u, -0.14, 14), P(u, 0.14, 14)], shade(c).top, 0.6);
                }
                return out;
            }
        },
        {
            id: 'packer', label: 'Case packer', color: '#7fb07a', height: 50,
            render: (c) => sh(0.44) + box(-0.42, -0.3, 0.42, 0.3, 0, 42, c)
                + faceL(-0.36, 0.1, 0.3, 10, 34, 'rgba(30,38,52,.75)')
                + box(-0.26, 0.04, -0.06, 0.24, 10, 22, '#e3a64a') + box(-0.02, 0.04, 0.16, 0.24, 10, 22, '#e3a64a')
                + led(0.22, 0.3, 30, '#4ade80') + led(0.3, 0.3, 30, '#f5b93b')
                + faceR(0.42, -0.2, 0.2, 6, 24, '#2b3240')
        },
        {
            id: 'robot', label: 'Robot palletiser', color: '#f08a24', height: 64,
            render: (c) => {
                const s = shade(c);
                const a = P(0, 0, 14), b = P(0, 0, 30), e = P(0.18, -0.18, 58), f = P(0.36, -0.06, 40);
                const seg = (p, q, w) => line([p, q], OUT, w + 2.4) + line([p, q], c, w);
                return sh(0.3) + box(-0.4, -0.4, 0.4, 0.4, 0, 1.5, '#e8b923') + cyl(0, 0, 0.18, 0, 14, s.right)
                    + seg(a, b, 9) + seg(b, e, 7) + seg(e, f, 5)
                    + `<circle cx="${r1(b[0])}" cy="${r1(b[1])}" r="5" fill="${s.top}" stroke="${OUT}" stroke-width=".8"/>`
                    + `<circle cx="${r1(e[0])}" cy="${r1(e[1])}" r="4" fill="${s.top}" stroke="${OUT}" stroke-width=".8"/>`
                    + box(0.3, -0.12, 0.42, 0.0, 30, 38, '#6e7a8c');
            }
        },
        {
            id: 'wrapper', label: 'Stretch wrapper', color: '#8aa0bd', height: 70,
            render: (c) => sh(0.44) + cyl(0, 0, 0.38, 0, 6, '#6e7a8c') + box(-0.46, -0.1, -0.38, 0.1, 0, 68, c)
                + box(-0.38, -0.08, -0.3, 0.08, 34, 44, shade(c).right) + pallet(6) + crates('#e3a64a', 11, 2, 18)
                + box(-0.34, -0.34, 0.34, 0.34, 11, 30, '#eef4fb').replace(/fill="([^"]+)"/g, 'fill="$1" fill-opacity=".5"')
        },
        {
            id: 'labbench', label: 'Lab bench', color: '#e6ebf2', height: 54,
            render: (c) => sh(0.42) + [[-0.4, -0.22], [0.36, -0.22], [-0.4, 0.2], [0.36, 0.2]].map(([u, v]) => box(u, v, u + 0.04, v + 0.03, 0, 24, '#6e7a8c')).join('')
                + box(-0.42, -0.24, 0.42, 0.24, 24, 28, c)
                + cyl(-0.24, 0.02, 0.05, 28, 40, '#8fd06a') + cyl(-0.1, 0.06, 0.04, 28, 36, '#f5b93b') + cyl(0.02, -0.04, 0.05, 28, 42, '#e0664f')
                + box(0.14, -0.12, 0.3, 0.06, 28, 32, '#3a4252') + box(0.2, -0.08, 0.26, -0.02, 32, 52, '#3a4252')
                + cyl(0.23, 0.0, 0.025, 40, 46, '#9aa6b8')
        },
        {
            id: 'worker', label: 'Worker', color: '#f5b93b', height: 52,
            render: (c) => {
                const [hx, hy] = P(0, 0, 40);
                return IsoIcons.shadow(0.16, 0.22) + cyl(-0.05, 0.04, 0.045, 0, 16, '#33415a') + cyl(0.05, -0.04, 0.045, 0, 16, '#33415a')
                    + cyl(0, 0, 0.11, 14, 32, c) + band(0, 0, 0.11, 22, '#ffffff', 1.6)
                    + `<circle cx="${r1(hx)}" cy="${r1(hy)}" r="6.5" fill="#f1c9a5" stroke="${OUT}" stroke-width=".8"/>`
                    + `<path d="M${r1(hx - 7.5)} ${r1(hy - 1)}A7.5 7 0 0 1 ${r1(hx + 7.5)} ${r1(hy - 1)}Z" fill="#f4f6fa" stroke="${OUT}" stroke-width=".8"/>`;
            }
        },
        {
            id: 'console', label: 'Control desk', color: '#5d6b82', height: 54,
            render: (c) => {
                let out = sh(0.44) + box(-0.42, -0.1, 0.42, 0.26, 0, 22, c);
                for (const u of [-0.42, -0.14, 0.14]) {
                    out += poly([P(u + 0.02, -0.1, 24), P(u + 0.26, -0.1, 24), P(u + 0.26, -0.16, 50), P(u + 0.02, -0.16, 50)], '#2b3240')
                        + poly([P(u + 0.04, -0.105, 27), P(u + 0.24, -0.105, 27), P(u + 0.24, -0.155, 47), P(u + 0.04, -0.155, 47)],
                            u < -0.2 ? '#3a7bd5' : u < 0 ? '#2fb3a5' : '#3a7bd5', OUT, 0.4);
                }
                return out + led(-0.3, 0.26, 12, '#4ade80') + led(-0.2, 0.26, 12, '#f5b93b');
            }
        },
        {
            id: 'cabinet', label: 'PLC cabinet', color: '#a7b1c2', height: 66,
            render: (c) => {
                const s = shade(c);
                let out = sh(0.3) + box(-0.24, -0.14, 0.24, 0.14, 0, 64, c)
                    + line([P(0, 0.14, 4), P(0, 0.14, 60)], s.line, 0.8) + faceL(-0.2, -0.04, 0.14, 40, 56, '#2b3240');
                for (let k = 0; k < 4; k++) {
                    out += led(0.06 + k * 0.04, 0.14, 50, ['#4ade80', '#4ade80', '#f5b93b', '#60a5fa'][k]);
                }
                return out;
            }
        },
        {
            id: 'hmi', label: 'HMI panel', color: '#5d6b82', height: 56,
            render: (c) => sh(0.16) + box(-0.04, -0.04, 0.04, 0.04, 0, 34, '#6e7a8c')
                + poly([P(-0.2, 0.02, 32), P(0.2, 0.02, 32), P(0.2, -0.02, 56), P(-0.2, -0.02, 56)], c)
                + poly([P(-0.17, 0.018, 35), P(0.17, 0.018, 35), P(0.17, -0.016, 53), P(-0.17, -0.016, 53)], '#2fb3a5', OUT, 0.4)
        },
        {
            id: 'office', label: 'Office desk', color: '#c9a46a', height: 44,
            render: (c) => sh(0.4) + box(-0.38, -0.22, 0.38, 0.22, 22, 26, c)
                + [[-0.36, -0.2], [0.32, -0.2], [-0.36, 0.17], [0.32, 0.17]].map(([u, v]) => box(u, v, u + 0.04, v + 0.03, 0, 22, '#6e7a8c')).join('')
                + poly([P(-0.2, -0.12, 27), P(0.12, -0.12, 27), P(0.12, -0.15, 44), P(-0.2, -0.15, 44)], '#2b3240')
                + poly([P(-0.18, -0.122, 29), P(0.1, -0.122, 29), P(0.1, -0.148, 42), P(-0.18, -0.148, 42)], '#e8edf4', OUT, 0.3)
                + box(-0.16, 0.0, 0.1, 0.12, 26, 27.5, '#3a4252')
        },
        {
            id: 'plant', label: 'Plant', color: '#4c9a5b', height: 40,
            render: (c) => sh(0.2) + cyl(0, 0, 0.1, 0, 12, '#c08a4e')
                + `<circle cx="50" cy="${115 - 24}" r="11" fill="${c}" stroke="${OUT}" stroke-width=".8"/>`
                + `<circle cx="44" cy="${115 - 30}" r="7" fill="${shade(c).top}" stroke="${OUT}" stroke-width=".6"/>`
        }
    ];

    function forklift(c, loaded) {
        const s = shade(c);
        let out = box(-0.26, -0.15, 0.1, 0.15, 3, 18, c)
            + box(-0.3, -0.14, -0.2, 0.14, 3, 24, s.right)
            + dot(-0.18, 0.15, 4, 3.6, '#262b36') + dot(0.04, 0.15, 4, 3.6, '#262b36')
            // overhead guard and the driver
            + line([P(-0.18, 0.13, 18), P(-0.18, 0.13, 40), P(0.06, 0.13, 40), P(0.06, 0.13, 18)], '#2b3240', 1.6)
            + line([P(-0.18, -0.13, 18), P(-0.18, -0.13, 40), P(0.06, -0.13, 40)], '#2b3240', 1.6)
            + dot(-0.05, 0, 30, 4.5, '#f1c9a5')
            // mast and forks at the front (+u)
            + box(0.12, -0.13, 0.15, -0.09, 2, 46, '#3a4252') + box(0.12, 0.09, 0.15, 0.13, 2, 46, '#3a4252')
            + box(0.15, -0.1, 0.42, -0.06, 3, 5, '#3a4252') + box(0.15, 0.06, 0.42, 0.1, 3, 5, '#3a4252');
        if (loaded) {
            out += box(0.15, -0.16, 0.45, 0.16, 5, 8, wood) + box(0.16, -0.15, 0.44, 0.15, 8, 30, '#e3a64a')
                + line([P(0.16, 0.15, 19), P(0.44, 0.15, 19)], '#9a6a2c', 0.8);
        }
        return out;
    }

    window.FactoryIcons = icons;
})();
