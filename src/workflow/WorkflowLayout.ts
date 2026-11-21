import { RectBoardGeometry, RectPoint } from '../rect/RectBoardGeometry';
import { WorkflowGeometry } from './WorkflowGeometry';
import { WorkflowModel } from './WorkflowModel';
import { WorkflowConnection } from './WorkflowTypes';

export interface WorkflowLayoutOptions {
    /** Gap between columns. Default 100. */
    gapX?: number;
    /** Gap between nodes in a column. Default 48. */
    gapY?: number;
    /** Gap between a node and the row of sub-nodes (model, tools …) under it. Default 80. */
    subGap?: number;
    /** Gap between disconnected parts of the workflow. Default 100. */
    componentGap?: number;
    /** Snap the result to this grid. Default 20. */
    grid?: number;
}

interface Box {
    id: string;
    w: number;
    h: number;
    x: number;
    y: number;
}

/**
 * Deterministic left-to-right "tidy up" for workflows.
 *
 * - Flow connections (output on the right → input on the left) define the
 *   columns: a node's column is its longest path from a source, after
 *   back edges (loops) are dropped by a depth-first search.
 * - Within a column, nodes are ordered by the barycenter of their
 *   predecessors (a few sweeps), which removes most crossings.
 * - Sub-nodes — nodes whose only connections go into a top/bottom socket of
 *   another node (a model or tool under an agent) — sit in a row under that node.
 * - Disconnected parts are laid out separately and stacked top to bottom.
 *
 * The result keeps the top-left corner of the laid-out nodes where it was,
 * so the view does not jump. Pure: reads the model, returns positions.
 */
export class WorkflowLayout {

    public static compute(model: WorkflowModel, options: WorkflowLayoutOptions = {}): Map<string, RectPoint> {
        const gapX = options.gapX ?? 100;
        const gapY = options.gapY ?? 48;
        const subGap = options.subGap ?? 80;
        const componentGap = options.componentGap ?? 100;
        const grid = options.grid ?? 20;
        const nodes = model.allNodes();
        const result = new Map<string, RectPoint>();

        if (nodes.length === 0) {
            return result;
        }

        const boxes = new Map<string, Box>(nodes.map((n) => {
            const size = WorkflowGeometry.nodeSize(model.getType(n.type));
            return [n.id, {id: n.id, w: size.w, h: size.h, x: n.x, y: n.y}];
        }));
        const flow: WorkflowConnection[] = [];
        const attach: WorkflowConnection[] = [];

        for (const c of model.allConnections()) {
            const out = model.port(c.from, 'out');
            const inp = model.port(c.to, 'in');

            if (out === undefined || inp === undefined || c.from.node === c.to.node) {
                continue;
            }
            if (WorkflowGeometry.portSide(inp, 'in') === 'left' && WorkflowGeometry.portSide(out, 'out') === 'right') {
                flow.push(c);
            } else {
                attach.push(c);
            }
        }

        // Sub-nodes: no flow connection at all, but attached to some node's socket.
        const parentOf = new Map<string, string>();

        for (const n of nodes) {
            const inFlow = flow.some((c) => c.from.node === n.id || c.to.node === n.id);
            const first = attach.find((c) => c.from.node === n.id);

            if (!inFlow && first !== undefined) {
                parentOf.set(n.id, first.to.node);
            }
        }
        // A sub-node of a sub-node is laid out as a normal node instead.
        for (const [child, parent] of [...parentOf]) {
            if (parentOf.has(parent)) {
                parentOf.delete(child);
            }
        }

        const mains = nodes.map((n) => n.id).filter((id) => !parentOf.has(id));
        const subsOf = new Map<string, string[]>();

        for (const [child, parent] of parentOf) {
            const list = subsOf.get(parent) ?? [];
            list.push(child);
            subsOf.set(parent, list);
        }
        for (const [parent, list] of subsOf) {
            const portOrder = (id: string): number => {
                const c = attach.find((x) => x.from.node === id && x.to.node === parent);
                const ports = model.ports(parent, 'in');
                return c === undefined ? 0 : ports.findIndex((p) => p.id === c.to.port);
            };
            list.sort((a, b) => portOrder(a) - portOrder(b) || boxes.get(a)!.x - boxes.get(b)!.x);
        }

        const subRow = (id: string): {w: number; h: number} => {
            const list = subsOf.get(id) ?? [];

            if (list.length === 0) {
                return {w: 0, h: 0};
            }

            return {
                w: list.reduce((sum, s) => sum + boxes.get(s)!.w, 0) + 40 * (list.length - 1),
                h: Math.max(...list.map((s) => boxes.get(s)!.h))
            };
        };

        // Components over the flow graph (undirected).
        const components = WorkflowLayout.components(mains, flow);
        let cursorY = 0;

        components.sort((a, b) => WorkflowLayout.minY(a, boxes) - WorkflowLayout.minY(b, boxes));

        for (const comp of components) {
            const placed = WorkflowLayout.layoutComponent(comp, flow, boxes, model, {gapX, gapY, subGap}, subRow, subsOf);
            const top = Math.min(...[...placed.entries()].map(([, p]) => p.y));
            let bottom = -Infinity;

            for (const [id, p] of placed) {
                const y = p.y - top + cursorY;
                result.set(id, {x: p.x, y});
                bottom = Math.max(bottom, y + boxes.get(id)!.h + (subRow(id).h > 0 ? subGap + subRow(id).h : 0));

                // Sub-nodes: a row centred under the parent.
                const list = subsOf.get(id) ?? [];
                let sx = p.x + boxes.get(id)!.w / 2 - subRow(id).w / 2;

                for (const s of list) {
                    result.set(s, {x: sx, y: y + boxes.get(id)!.h + subGap});
                    sx += boxes.get(s)!.w + 40;
                }
            }

            cursorY = bottom + componentGap;
        }

        // Keep the old top-left corner, snap to the grid.
        const oldX = Math.min(...nodes.map((n) => n.x));
        const oldY = Math.min(...nodes.map((n) => n.y));
        const newX = Math.min(...[...result.values()].map((p) => p.x));
        const newY = Math.min(...[...result.values()].map((p) => p.y));

        for (const [id, p] of result) {
            result.set(id, {
                x: RectBoardGeometry.snap(p.x - newX + oldX, grid),
                y: RectBoardGeometry.snap(p.y - newY + oldY, grid)
            });
        }

        return result;
    }

    private static layoutComponent(
        ids: string[],
        flow: WorkflowConnection[],
        boxes: Map<string, Box>,
        model: WorkflowModel,
        gaps: {gapX: number; gapY: number; subGap: number},
        subRow: (id: string) => {w: number; h: number},
        subsOf: Map<string, string[]>
    ): Map<string, RectPoint> {
        const set = new Set(ids);
        const edges = flow.filter((c) => set.has(c.from.node) && set.has(c.to.node));
        const byPos = (a: string, b: string): number => boxes.get(a)!.x - boxes.get(b)!.x || boxes.get(a)!.y - boxes.get(b)!.y;
        const outPortIndex = (c: WorkflowConnection): number => model.ports(c.from.node, 'out').findIndex((p) => p.id === c.from.port);

        // Depth-first search from the sources (left to right) marks back edges; the rest is a DAG.
        const dag: WorkflowConnection[] = [];
        const state = new Map<string, 1 | 2>();
        const visit = (id: string): void => {
            state.set(id, 1);
            const outs = edges.filter((c) => c.from.node === id)
                .sort((a, b) => outPortIndex(a) - outPortIndex(b) || byPos(a.to.node, b.to.node));

            for (const c of outs) {
                const s = state.get(c.to.node);

                if (s === 1) {
                    continue;              // back edge: a loop, ignored for ranking
                }
                dag.push(c);
                if (s === undefined) {
                    visit(c.to.node);
                }
            }
            state.set(id, 2);
        };
        const sources = ids.filter((id) => !edges.some((c) => c.to.node === id)).sort(byPos);

        for (const id of [...sources, ...[...ids].sort(byPos)]) {
            if (!state.has(id)) {
                visit(id);
            }
        }

        // Longest-path ranks over the DAG (relaxation; terminates since it is acyclic).
        const rank = new Map<string, number>(ids.map((id) => [id, 0]));
        let changed = true;

        for (let guard = 0; changed && guard <= ids.length; guard++) {
            changed = false;
            for (const c of dag) {
                const r = rank.get(c.from.node)! + 1;
                if (r > rank.get(c.to.node)!) {
                    rank.set(c.to.node, r);
                    changed = true;
                }
            }
        }

        const columns: string[][] = [];

        for (const id of [...ids].sort((a, b) => boxes.get(a)!.y - boxes.get(b)!.y)) {
            (columns[rank.get(id)!] ??= []).push(id);
        }

        // Barycenter sweeps: order each column by where its predecessors sit
        // (their index plus the fraction of the output port used).
        const index = new Map<string, number>();
        const reindex = (): void => columns.forEach((col) => col.forEach((id, i) => index.set(id, i)));

        reindex();
        for (let pass = 0; pass < 4; pass++) {
            for (let r = 1; r < columns.length; r++) {
                const col = columns[r] ?? [];
                const key = new Map<string, number>();

                for (const id of col) {
                    const preds = dag.filter((c) => c.to.node === id);

                    if (preds.length === 0) {
                        key.set(id, index.get(id)!);
                        continue;
                    }

                    const sum = preds.reduce((acc, c) => {
                        const n = Math.max(1, model.ports(c.from.node, 'out').length);
                        return acc + index.get(c.from.node)! + (outPortIndex(c) + 1) / (n + 1) - 0.5;
                    }, 0);
                    key.set(id, sum / preds.length);
                }

                col.sort((a, b) => key.get(a)! - key.get(b)!);
            }
            reindex();
        }

        // Coordinates: columns left to right, each column centred on y = 0.
        const placed = new Map<string, RectPoint>();
        let x = 0;

        for (const col of columns) {
            if (col === undefined || col.length === 0) {
                continue;
            }

            const colW = Math.max(...col.map((id) => Math.max(boxes.get(id)!.w, subRow(id).w)));
            const slot = (id: string): number => boxes.get(id)!.h + (subsOf.has(id) ? gaps.subGap + subRow(id).h : 0);
            const total = col.reduce((sum, id) => sum + slot(id), 0) + gaps.gapY * (col.length - 1);
            // Centre on the node centres so a straight chain stays on one line.
            let y = -total / 2;

            for (const id of col) {
                const b = boxes.get(id)!;
                const yy = col.length === 1 ? -b.h / 2 : y;
                placed.set(id, {x: x + (colW - b.w) / 2, y: yy});
                y += slot(id) + gaps.gapY;
            }

            x += colW + gaps.gapX;
        }

        return placed;
    }

    private static components(ids: string[], flow: WorkflowConnection[]): string[][] {
        const parent = new Map<string, string>(ids.map((id) => [id, id]));
        const find = (id: string): string => {
            let root = id;
            while (parent.get(root) !== root) {
                root = parent.get(root)!;
            }
            parent.set(id, root);
            return root;
        };

        for (const c of flow) {
            if (parent.has(c.from.node) && parent.has(c.to.node)) {
                parent.set(find(c.from.node), find(c.to.node));
            }
        }

        const groups = new Map<string, string[]>();

        for (const id of ids) {
            const root = find(id);
            const list = groups.get(root) ?? [];
            list.push(id);
            groups.set(root, list);
        }

        return [...groups.values()];
    }

    private static minY(ids: string[], boxes: Map<string, Box>): number {
        return Math.min(...ids.map((id) => boxes.get(id)!.y));
    }

}
