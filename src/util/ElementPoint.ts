import { Point } from './Geometry';

/**
 * Client (viewport) coordinates → an element's local CSS px. Measures the
 * element's layout size (clientWidth) against its on-screen rect, so a CSS
 * transform on an ancestor (a zoomed board) does not skew the result.
 */
export class ElementPoint {

    public static local(element: HTMLElement, clientX: number, clientY: number): Point {
        const rect = element.getBoundingClientRect();
        const sx = rect.width > 0 ? element.clientWidth / rect.width : 1;
        const sy = rect.height > 0 ? element.clientHeight / rect.height : 1;

        return {x: (clientX - rect.left) * (sx || 1), y: (clientY - rect.top) * (sy || 1)};
    }

}
