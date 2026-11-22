import { GraphEdge } from '../model/GraphEdge';
import { GraphNode } from '../model/GraphNode';

export interface LayeredLayoutOptions {
    /** Fraction of the remaining distance covered toward the slot per tick (0..1). */
    easing?: number;
    /** Horizontal gap kept between the outer columns and the canvas edge. */
    marginX?: number;
    /** Vertical gap kept between a column's ends and the canvas edge. */
    marginY?: number;
    /** Maximum vertical distance between two nodes in a column, in pixels. */
    maxSpacing?: number;
    /**
     * Number of barycenter ordering sweeps across the columns. Sweeps
     * alternate direction (forward = each column ordered against the one to
     * its left, backward = against the one to its right); more sweeps reduce
     * crossings further on deeper flows. Clamped to >= 1.
     */
    sweeps?: number;
    /**
     * Minimum vertical distance between two nodes in a column. Default 0:
     * a column always fits the canvas height. Set it (e.g. to the card
     * height plus a gap) to let tall columns grow past the canvas instead
     * of overlapping; `fit()` then zooms out to show them.
     */
    minSpacing?: number;
    /** Minimum horizontal distance between two columns. Default 0 (columns fit the canvas width). */
    minColumnGap?: number;
    /**
     * 'right' (default): layers are columns, 0 = leftmost. 'down': layers are
     * rows, 0 = top — an org-chart / team arrangement. With 'down' the axes
     * swap: layers spread over the height (marginY, minColumnGap = minimum
     * row gap), the nodes of one layer over the width (marginX, min/maxSpacing).
     */
    direction?: 'right' | 'down';
    /**
     * Layers drawn as a grid instead of one long line: layer → number of
     * sub-columns (sub-rows with 'down'). The members fill it row by row in
     * their crossing-reduced order, e.g. `{5: 6}` packs 216 "bit" nodes as
     * 36 rows × 6. Default: none.
     */
    grid?: Record<number, number>;
    /** Distance between the sub-columns of a grid layer. Default: the layer's own row spacing. */
    gridGap?: number;
}

/** Where one layer ended up (for column headers and separators). */
export interface LayeredColumn {
    /** The layer index (node.ring). */
    ring: number;
    /** Layer position on the layer axis (x for 'right', y for 'down'), world px. */
    pos: number;
    /** Half the layer's own extent on that axis (grid layers are wider), world px. */
    halfWidth: number;
    /** Members in the layer. */
    count: number;
}

const DEFAULTS: Required<LayeredLayoutOptions> = {
    easing: 0.12,
    marginX: 120,
    marginY: 48,
    maxSpacing: 84,
    sweeps: 4,
    minSpacing: 0,
    minColumnGap: 0,
    direction: 'right',
    grid: {},
    gridGap: 0
};

/**
 * Sugiyama-style layered layout: node.ring is the COLUMN (0 = leftmost),
 * columns are evenly spread left-to-right, nodes stack vertically inside
 * their column (`direction: 'down'`: rows top-to-bottom, side by side). Within a column nodes are ordered by the barycenter of
 * their neighbors in the adjacent column, swept back and forth across the
 * columns (the classic iterative crossing-reduction) so deeper flows settle
 * to a low-crossing arrangement without a full Sugiyama solver.
 * Deterministic, eased settling, dragged (`fixed`) nodes untouched — the
 * workflow-editor-style arrangement for directed flows.
 */
export class LayeredLayout {

    private readonly options: Required<LayeredLayoutOptions>;
    private placed: LayeredColumn[] = [];

    public constructor(options: LayeredLayoutOptions = {}) {
        this.options = {...DEFAULTS, ...options};
    }

    /** The layers as of the last tick, ordered by ring. */
    public get columns(): ReadonlyArray<LayeredColumn> {
        return this.placed;
    }

    public get direction(): 'right' | 'down' {
        return this.options.direction;
    }

    /** Interface parity with ForceLayout: slot layouts converge on their own. */
    public reheat(_alpha = 1): void {
        // nothing to warm up
    }

    public tick(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number): void {
        const {easing, marginX, marginY, maxSpacing, minSpacing, minColumnGap} = this.options;
        const down = this.options.direction === 'down';
        // Layer axis (columns, or rows when 'down') and the axis along one layer.
        const layerExtent = down ? height : width;
        const layerMargin = down ? marginY : marginX;
        const crossExtent = down ? width : height;
        const crossMargin = down ? marginX : marginY;
        const sweeps = Math.max(1, Math.floor(this.options.sweeps));

        const columns = new Map<number, GraphNode[]>();
        let maxRing = 0;

        for (const node of nodes) {
            const ring = Math.max(0, node.ring);
            const members = columns.get(ring);

            if (members === undefined) {
                columns.set(ring, [node]);
            } else {
                members.push(node);
            }

            maxRing = Math.max(maxRing, ring);
        }

        const orderedRings = [...columns.keys()].sort((a, b) => a - b);
        const adjacency = LayeredLayout.buildAdjacency(nodes, edges);

        // Position of every node within its own column; kept in sync as the
        // sweeps reorder columns so each ordering pass reads current indexes.
        const posIndex = new Map<string, number>();

        const reindex = (ring: number): void => {
            const members = columns.get(ring) ?? [];

            for (let i = 0; i < members.length; i++) {
                const node = members[i];

                if (node !== undefined) {
                    posIndex.set(node.id, i);
                }
            }
        };

        for (const ring of orderedRings) {
            reindex(ring);
        }

        const orderAgainst = (ring: number, referenceRing: number): void => {
            const members = columns.get(ring) ?? [];
            const referenceMembers = columns.get(referenceRing) ?? [];
            const referenceIds = new Set(referenceMembers.map((node) => node.id));
            const ordered = LayeredLayout.barycenterOrder(members, adjacency, posIndex, referenceIds);

            columns.set(ring, ordered);
            reindex(ring);
        };

        for (let s = 0; s < sweeps; s++) {
            if (s % 2 === 0) {
                for (let c = 1; c < orderedRings.length; c++) {
                    const ring = orderedRings[c];
                    const referenceRing = orderedRings[c - 1];

                    if (ring !== undefined && referenceRing !== undefined) {
                        orderAgainst(ring, referenceRing);
                    }
                }
            } else {
                for (let c = orderedRings.length - 2; c >= 0; c--) {
                    const ring = orderedRings[c];
                    const referenceRing = orderedRings[c + 1];

                    if (ring !== undefined && referenceRing !== undefined) {
                        orderAgainst(ring, referenceRing);
                    }
                }
            }
        }

        // Grid layers are wider than one line: their shape first, so the
        // outer ones can be kept inside the margins.
        const shapes = new Map<number, {sub: number; rows: number; spacing: number; subGap: number}>();

        for (const ring of orderedRings) {
            const count = (columns.get(ring) ?? []).length;
            const sub = Math.max(1, Math.min(count, Math.floor(this.options.grid[ring] ?? 1)));
            const rows = Math.ceil(count / sub);
            const spacing = rows <= 1
                ? 0
                : Math.max(minSpacing, Math.min(maxSpacing, (crossExtent - 2 * crossMargin) / (rows - 1)));
            const subGap = sub <= 1 ? 0 : this.options.gridGap > 0 ? this.options.gridGap : Math.max(8, spacing);

            shapes.set(ring, {sub, rows, spacing, subGap});
        }

        const half = (ring: number | undefined): number => {
            const shape = ring === undefined ? undefined : shapes.get(ring);

            return shape === undefined ? 0 : (shape.sub - 1) * shape.subGap / 2;
        };
        // Ring 0 sits at the start edge only when it exists; the last layer is always maxRing.
        const firstHalf = orderedRings[0] === 0 ? half(0) : 0;
        const lastHalf = half(orderedRings[orderedRings.length - 1]);

        // Columns spread over the width, centred; never closer than minColumnGap.
        const columnGap = maxRing === 0 ? 0 : Math.max(minColumnGap, (layerExtent - 2 * layerMargin - firstHalf - lastHalf) / maxRing);
        const shift = (firstHalf - lastHalf) / 2;

        this.placed = [];

        for (const ring of orderedRings) {
            const members = columns.get(ring) ?? [];
            const layerPos = layerExtent / 2 + shift + (ring - maxRing / 2) * columnGap;
            const {sub, rows, spacing, subGap} = shapes.get(ring)!;

            this.placed.push({ring, pos: layerPos, halfWidth: (sub - 1) * subGap / 2, count: members.length});

            for (let i = 0; i < members.length; i++) {
                const node = members[i];

                if (node === undefined || node.fixed) {
                    continue;
                }

                const row = Math.floor(i / sub);
                const col = i % sub;
                const crossPos = crossExtent / 2 + (row - (rows - 1) / 2) * spacing;
                const shift = (col - (sub - 1) / 2) * subGap;
                const tx = down ? crossPos : layerPos + shift;
                const ty = down ? layerPos + shift : crossPos;

                node.x += (tx - node.x) * easing;
                node.y += (ty - node.y) * easing;
                node.vx = 0;
                node.vy = 0;
            }
        }
    }

    /** Undirected id → neighbor-ids map, so repeated sweeps avoid rescanning every edge per node. */
    private static buildAdjacency(nodes: GraphNode[], edges: GraphEdge[]): Map<string, string[]> {
        const adjacency = new Map<string, string[]>();

        for (const node of nodes) {
            adjacency.set(node.id, []);
        }

        for (const edge of edges) {
            adjacency.get(edge.source.id)?.push(edge.target.id);
            adjacency.get(edge.target.id)?.push(edge.source.id);
        }

        return adjacency;
    }

    /**
     * Order a column by the average position of each node's neighbors in the
     * reference (adjacent) column. Nodes without such a neighbor keep their
     * current position (their input index is the fallback score), so they
     * stay put across sweeps rather than drifting to the end — keeping the
     * iteration stable and deterministic.
     */
    private static barycenterOrder(members: GraphNode[], adjacency: Map<string, string[]>,
        posIndex: Map<string, number>, referenceIds: Set<string>): GraphNode[] {
        const scored = members.map((node, inputIndex) => {
            const neighbors = adjacency.get(node.id) ?? [];
            let sum = 0;
            let count = 0;

            for (const neighborId of neighbors) {
                if (referenceIds.has(neighborId)) {
                    sum += posIndex.get(neighborId) ?? 0;
                    count++;
                }
            }

            const score = count > 0 ? sum / count : inputIndex;

            return {node: node, inputIndex: inputIndex, score: score};
        });

        scored.sort((a, b) => a.score - b.score || a.inputIndex - b.inputIndex);

        return scored.map((s) => s.node);
    }

}
