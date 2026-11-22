/**
 * Which node a pointer means. A point inside a node's drawn shape picks
 * that node (the topmost when shapes overlap). Small dots also get a
 * padded target of `minTarget` radius, so they can be hit at all (24 px
 * across at the default, WCAG 2.5.8); a padded hit only counts where no
 * drawn shape is hit, and then the nearest node wins, so a padded target
 * never takes a click from a neighbour in a dense graph.
 *
 * Pure, so it is tested without a canvas (test/HitPick.test.ts).
 */
export interface HitCandidate<T> {
    item: T;
    x: number;
    y: number;
    /** Draw order: higher is on top. */
    order: number;
    /** A circle of this radius, or a card (box) of this size. */
    shape: {kind: 'circle'; radius: number} | {kind: 'box'; w: number; h: number};
}

/** Default padded target radius in screen px (24 px across). */
export const MIN_HIT_RADIUS_PX = 12;

export const pickHit = <T>(candidates: Iterable<HitCandidate<T>>, x: number, y: number, minTarget: number): T | null => {
    let drawn: HitCandidate<T> | null = null;
    let padded: HitCandidate<T> | null = null;
    let paddedDist = Infinity;

    for (const c of candidates) {
        const dx = x - c.x;
        const dy = y - c.y;

        if (c.shape.kind === 'box') {
            if (Math.abs(dx) <= c.shape.w / 2 && Math.abs(dy) <= c.shape.h / 2 && (drawn === null || c.order > drawn.order)) {
                drawn = c;
            }
            continue;
        }

        const distSq = dx * dx + dy * dy;
        const r = c.shape.radius;

        if (distSq <= r * r) {
            if (drawn === null || c.order > drawn.order) drawn = c;
        } else if (distSq <= minTarget * minTarget && distSq < paddedDist) {
            padded = c;
            paddedDist = distSq;
        }
    }

    return (drawn ?? padded)?.item ?? null;
};
