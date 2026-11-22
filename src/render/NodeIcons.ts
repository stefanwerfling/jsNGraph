import { NodeIconDrawer, NodeKind } from '../model/NGraphTypes';

/**
 * Hand-drawn device glyphs (no icon font/image assets, keeps the lib
 * dependency- and asset-free). Each draws centered at (0,0) within `size`
 * and assumes the caller has already translated the canvas context.
 */
export class NodeIcons {

    public static draw(ctx: CanvasRenderingContext2D, kind: NodeKind | NodeIconDrawer, size: number, color: string): void {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = Math.max(1.2, size * 0.09);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        if (typeof kind === 'function') {
            kind(ctx, size, color);
            ctx.restore();
            return;
        }

        switch (kind) {
            case 'person':
                NodeIcons.person(ctx, size);
                break;
            case 'company':
                NodeIcons.company(ctx, size);
                break;
            case 'location':
                NodeIcons.location(ctx, size);
                break;
            case 'web':
                NodeIcons.web(ctx, size);
                break;
            case 'phone':
                NodeIcons.phone(ctx, size);
                break;
            case 'group':
                NodeIcons.group(ctx, size);
                break;
            case 'server':
                NodeIcons.server(ctx, size);
                break;
            case 'database':
                NodeIcons.database(ctx, size);
                break;
            case 'router':
                NodeIcons.router(ctx, size);
                break;
            case 'laptop':
                NodeIcons.laptop(ctx, size);
                break;
            case 'tablet':
                NodeIcons.tablet(ctx, size);
                break;
            case 'pc':
                NodeIcons.pc(ctx, size);
                break;
            case 'agent':
                NodeIcons.agent(ctx, size);
                break;
            case 'gateway':
                NodeIcons.gateway(ctx, size);
                break;
            default:
                NodeIcons.generic(ctx, size);
        }

        ctx.restore();
    }

    /** Head + shoulders outline. */
    private static person(ctx: CanvasRenderingContext2D, s: number): void {
        ctx.beginPath();
        ctx.arc(0, -s * 0.15, s * 0.16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, s * 0.36, s * 0.3, Math.PI, 0);
        ctx.closePath();
        ctx.stroke();
    }

    /** Office building: block with a window grid and a door. */
    private static company(ctx: CanvasRenderingContext2D, s: number): void {
        const w = s * 0.56;
        const h = s * 0.7;
        const win = s * 0.08;

        ctx.strokeRect(-w / 2, -h / 2, w, h);

        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
                ctx.fillRect(-w / 2 + w * (0.17 + col * 0.27) - win / 2, -h / 2 + h * (0.15 + row * 0.2), win, win);
            }
        }

        ctx.fillRect(-s * 0.06, h / 2 - s * 0.16, s * 0.12, s * 0.16);
    }

    /** Map pin with a hole. */
    private static location(ctx: CanvasRenderingContext2D, s: number): void {
        const cy = -s * 0.1;
        const r = s * 0.22;

        ctx.beginPath();
        ctx.arc(0, cy, r, Math.PI * 0.8, Math.PI * 0.2);
        ctx.lineTo(0, s * 0.38);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, cy, s * 0.08, 0, Math.PI * 2);
        ctx.stroke();
    }

    /** Globe: outline, one meridian, equator and two parallels. */
    private static web(ctx: CanvasRenderingContext2D, s: number): void {
        const r = s * 0.36;
        const chord = Math.sqrt(r * r - (r / 2) * (r / 2));

        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.moveTo(0, -r);
        ctx.ellipse(0, 0, r * 0.42, r, 0, -Math.PI / 2, Math.PI * 1.5);
        ctx.moveTo(-r, 0);
        ctx.lineTo(r, 0);
        ctx.moveTo(-chord, -r / 2);
        ctx.lineTo(chord, -r / 2);
        ctx.moveTo(-chord, r / 2);
        ctx.lineTo(chord, r / 2);
        ctx.stroke();
    }

    /** Telephone handset: a thick arc bulging down-left with ear/mouth pieces. */
    private static phone(ctx: CanvasRenderingContext2D, s: number): void {
        const r = s * 0.27;
        const from = Math.PI * 0.35;
        const to = Math.PI * 1.15;

        ctx.save();
        ctx.lineWidth = s * 0.13;
        ctx.beginPath();
        ctx.arc(s * 0.06, -s * 0.06, r, from, to);
        ctx.stroke();

        for (const a of [from, to]) {
            ctx.beginPath();
            ctx.arc(s * 0.06 + Math.cos(a) * r, -s * 0.06 + Math.sin(a) * r, s * 0.1, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    /** Three people, the front one larger. */
    private static group(ctx: CanvasRenderingContext2D, s: number): void {
        for (const dx of [-0.24, 0.24]) {
            ctx.save();
            ctx.translate(s * dx, -s * 0.04);
            ctx.lineWidth = Math.max(1, s * 0.07);
            NodeIcons.person(ctx, s * 0.62);
            ctx.restore();
        }

        ctx.save();
        ctx.translate(0, s * 0.04);
        NodeIcons.person(ctx, s * 0.82);
        ctx.restore();
    }

    private static server(ctx: CanvasRenderingContext2D, s: number): void {
        const w = s * 0.9;
        const h = s * 0.3;

        for (let i = 0; i < 3; i++) {
            const y = -h * 1.5 + i * (h + 2);
            ctx.strokeRect(-w / 2, y, w, h);
            ctx.beginPath();
            ctx.arc(w / 2 - h * 0.35, y + h / 2, h * 0.12, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    private static database(ctx: CanvasRenderingContext2D, s: number): void {
        const w = s * 0.8;
        const h = s * 0.9;
        const ry = h * 0.14;

        ctx.beginPath();
        ctx.ellipse(0, -h / 2, w / 2, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-w / 2, -h / 2);
        ctx.lineTo(-w / 2, h / 2);
        ctx.ellipse(0, h / 2, w / 2, ry, 0, Math.PI, 0, true);
        ctx.lineTo(w / 2, -h / 2);
        ctx.stroke();
    }

    private static router(ctx: CanvasRenderingContext2D, s: number): void {
        const w = s * 0.9;

        ctx.beginPath();
        ctx.moveTo(0, -w / 2);
        ctx.lineTo(w / 2, 0);
        ctx.lineTo(0, w / 2);
        ctx.lineTo(-w / 2, 0);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, w * 0.1, 0, Math.PI * 2);
        ctx.fill();
    }

    private static laptop(ctx: CanvasRenderingContext2D, s: number): void {
        const w = s * 0.85;
        const h = s * 0.55;

        ctx.strokeRect(-w / 2, -h / 2, w, h * 0.72);
        ctx.beginPath();
        ctx.moveTo(-w / 2 - 3, h * 0.22);
        ctx.lineTo(w / 2 + 3, h * 0.22);
        ctx.stroke();
    }

    private static tablet(ctx: CanvasRenderingContext2D, s: number): void {
        const w = s * 0.55;
        const h = s * 0.85;
        const r = 4;

        NodeIcons.roundRectStroke(ctx, -w / 2, -h / 2, w, h, r);
    }

    private static pc(ctx: CanvasRenderingContext2D, s: number): void {
        const w = s * 0.75;
        const h = s * 0.55;

        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(0, h / 2 + s * 0.14);
        ctx.moveTo(-w * 0.3, h / 2 + s * 0.14);
        ctx.lineTo(w * 0.3, h / 2 + s * 0.14);
        ctx.stroke();
    }

    /** Robot head: rounded face, two eyes, antenna — a worker agent. */
    private static agent(ctx: CanvasRenderingContext2D, s: number): void {
        const w = s * 0.72;
        const h = s * 0.58;

        NodeIcons.roundRectStroke(ctx, -w / 2, -h / 2 + s * 0.08, w, h, 5);

        ctx.beginPath();
        ctx.moveTo(0, -h / 2 + s * 0.08);
        ctx.lineTo(0, -h / 2 - s * 0.1);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, -h / 2 - s * 0.16, s * 0.06, 0, Math.PI * 2);
        ctx.fill();

        const eyeY = s * 0.08;
        const eyeDx = w * 0.22;

        ctx.beginPath();
        ctx.arc(-eyeDx, eyeY, s * 0.07, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(eyeDx, eyeY, s * 0.07, 0, Math.PI * 2);
        ctx.fill();
    }

    /** Hub hexagon with spokes and a core — the steering gateway. */
    private static gateway(ctx: CanvasRenderingContext2D, s: number): void {
        const r = s * 0.42;

        ctx.beginPath();

        for (let i = 0; i < 6; i++) {
            const angle = -Math.PI / 2 + (i / 6) * Math.PI * 2;
            const x = Math.cos(angle) * r;
            const y = Math.sin(angle) * r;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.closePath();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
        ctx.fill();

        for (let i = 0; i < 6; i++) {
            const angle = -Math.PI / 2 + (i / 6) * Math.PI * 2;

            ctx.beginPath();
            ctx.moveTo(Math.cos(angle) * r * 0.35, Math.sin(angle) * r * 0.35);
            ctx.lineTo(Math.cos(angle) * r * 0.78, Math.sin(angle) * r * 0.78);
            ctx.stroke();
        }
    }

    private static generic(ctx: CanvasRenderingContext2D, s: number): void {
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.32, 0, Math.PI * 2);
        ctx.stroke();
    }

    private static roundRectStroke(ctx: CanvasRenderingContext2D, x: number, y: number,
        w: number, h: number, r: number): void {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        ctx.stroke();
    }

}
