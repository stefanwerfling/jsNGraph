import { NodeKind } from '../model/NGraphTypes';

/**
 * Hand-drawn device glyphs (no icon font/image assets, keeps the lib
 * dependency- and asset-free). Each draws centered at (0,0) within `size`
 * and assumes the caller has already translated the canvas context.
 */
export class NodeIcons {

    public static draw(ctx: CanvasRenderingContext2D, kind: NodeKind, size: number, color: string): void {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = Math.max(1.2, size * 0.09);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        switch (kind) {
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
            default:
                NodeIcons.generic(ctx, size);
        }

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
