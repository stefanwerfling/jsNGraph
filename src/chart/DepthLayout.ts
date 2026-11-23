/** One order (or one price level): a price and how many units at it. */
export interface DepthOrder {
    price: number;
    quantity: number;
}

/** A price level with the cumulative quantity up to it, seen from the middle. */
export interface DepthLevel {
    price: number;
    quantity: number;
    /** Bids: everything at this price or higher; asks: at this price or lower. */
    cumulative: number;
}

export interface DepthBook {
    /** Best (highest) bid first. */
    bids: DepthLevel[];
    /** Best (lowest) ask first. */
    asks: DepthLevel[];
    bestBid: number | null;
    bestAsk: number | null;
    /** bestAsk − bestBid (null when a side is empty; ≤ 0 when the book is crossed). */
    spread: number | null;
    mid: number | null;
}

/**
 * Pure part of `DepthChart`: merges orders into price levels and sums them
 * outwards from the middle — buyers at p or higher, sellers at p or lower —
 * the two staircases of a market depth chart. No DOM.
 */
export class DepthLayout {

    public static book(bids: readonly DepthOrder[], asks: readonly DepthOrder[]): DepthBook {
        const b = DepthLayout.levels(bids, -1);
        const a = DepthLayout.levels(asks, 1);
        const bestBid = b[0]?.price ?? null;
        const bestAsk = a[0]?.price ?? null;
        const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

        return {
            bids: b, asks: a, bestBid, bestAsk, spread,
            mid: bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk
        };
    }

    /** Merge equal prices, sort from the middle outwards (dir −1: high → low), add up. */
    public static levels(orders: readonly DepthOrder[], dir: 1 | -1): DepthLevel[] {
        const merged = new Map<number, number>();

        for (const o of orders) {
            if (Number.isFinite(o.price) && Number.isFinite(o.quantity) && o.quantity > 0) {
                merged.set(o.price, (merged.get(o.price) ?? 0) + o.quantity);
            }
        }

        const prices = Array.from(merged.keys()).sort((x, y) => (x - y) * dir);
        let sum = 0;

        return prices.map((price) => {
            const quantity = merged.get(price)!;
            sum += quantity;
            return {price, quantity, cumulative: sum};
        });
    }

    /**
     * Depth at a price: for bids the units wanted at `price` or higher, for
     * asks the units offered at `price` or lower.
     */
    public static depthAt(levels: readonly DepthLevel[], price: number, side: 'bid' | 'ask'): number {
        let depth = 0;

        for (const l of levels) {
            if (side === 'bid' ? l.price >= price : l.price <= price) {
                depth = l.cumulative;
            } else {
                break;
            }
        }

        return depth;
    }

}
