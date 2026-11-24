/**
 * Minimal stand-in for CanvasRenderingContext2D under happy-dom (which has no
 * canvas): every method is a no-op, measureText returns a width, properties
 * just store what is assigned. Enough for classes that draw, not for pixels.
 */
export class FakeCanvas {

    public static install(): void {
        const proto = HTMLCanvasElement.prototype as unknown as {getContext: (kind: string) => unknown};

        const global = globalThis as unknown as {Path2D?: unknown};

        if (global.Path2D === undefined) {
            global.Path2D = FakeCanvas.FakePath2D;
        }

        proto.getContext = function getContext(kind: string): unknown {
            return kind === '2d' ? FakeCanvas.context(this as unknown as HTMLCanvasElement) : null;
        };
    }

    /** Path2D stand-in: every path command is a no-op. */
    private static readonly FakePath2D = class {
        public moveTo(): void { /* no-op */ }
        public lineTo(): void { /* no-op */ }
        public bezierCurveTo(): void { /* no-op */ }
        public quadraticCurveTo(): void { /* no-op */ }
        public arc(): void { /* no-op */ }
        public arcTo(): void { /* no-op */ }
        public ellipse(): void { /* no-op */ }
        public rect(): void { /* no-op */ }
        public roundRect(): void { /* no-op */ }
        public closePath(): void { /* no-op */ }
        public addPath(): void { /* no-op */ }
    };

    private static context(canvas: HTMLCanvasElement): unknown {
        const store: Record<string | symbol, unknown> = {canvas: canvas};
        const noop = (): void => undefined;

        return new Proxy(store, {
            get(target, key) {
                if (key in target) {
                    return target[key];
                }

                switch (key) {
                    case 'measureText':
                        return (text: string) => ({width: text.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2});
                    case 'getLineDash':
                        return () => [];
                    case 'createLinearGradient':
                    case 'createRadialGradient':
                    case 'createConicGradient':
                        return () => ({addColorStop: noop});
                    case 'createPattern':
                        return () => null;
                    case 'getImageData':
                    case 'createImageData':
                        return (_x: number, _y: number, w = 1, h = 1) => ({width: w, height: h, data: new Uint8ClampedArray(w * h * 4)});
                    case 'isPointInPath':
                    case 'isPointInStroke':
                        return () => false;
                    case 'getTransform':
                        return () => ({a: 1, b: 0, c: 0, d: 1, e: 0, f: 0});
                    default:
                        return noop;
                }
            },
            set(target, key, value) {
                target[key] = value;
                return true;
            }
        });
    }

}
