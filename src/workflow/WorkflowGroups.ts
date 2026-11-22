import { RectArea, RectBoardGeometry } from '../rect/RectBoardGeometry';
import { WorkflowGeometry } from './WorkflowGeometry';
import { WorkflowModel } from './WorkflowModel';
import { WorkflowConnection, WorkflowGroup, WorkflowNodeData, WorkflowNodeType, WorkflowPortDir, WorkflowPortRef, WorkflowPortSpec } from './WorkflowTypes';

/** One port of a collapsed group, standing in for a member's port that has connections across the border. */
export interface WorkflowGroupProxy {
    /** The member's real port. */
    ref: WorkflowPortRef;
    dir: WorkflowPortDir;
    /** The port as the collapsed node shows it (`id` = {@link WorkflowGroups.proxyId}). */
    spec: WorkflowPortSpec;
}

/**
 * Pure geometry and bookkeeping of sub-workflows (groups): the frame around
 * an expanded group, and the single node a collapsed group is drawn as —
 * its size, position and proxy ports — plus a copy of the model in which
 * every collapsed group *is* that node (what the layout works on).
 */
export class WorkflowGroups {

    /** Space between the members' bounding box and the frame. */
    public static readonly PAD = 20;
    /** Height of the frame's header (label, collapse button). */
    public static readonly HEADER = 32;
    public static readonly BOX_WIDTH = 220;
    public static readonly DEFAULT_LABEL = 'Group';
    /** Type-name prefix of the synthetic node type of a collapsed group. */
    public static readonly TYPE_PREFIX = '\u0000group:';

    public static label(group: WorkflowGroup): string {
        return group.label ?? WorkflowGroups.DEFAULT_LABEL;
    }

    /** Port id on the collapsed node for a member's port. */
    public static proxyId(ref: WorkflowPortRef): string {
        return `${ref.node}:${ref.port}`;
    }

    /**
     * What an expanded group's frame wraps: its own nodes, the frames of
     * expanded child groups, and the boxes of collapsed ones.
     */
    public static contentRects(model: WorkflowModel, group: WorkflowGroup, seen = new Set<string>()): RectArea[] {
        seen.add(group.id);

        const rects = group.nodes.filter((id) => model.node(id) !== undefined).map((id) => WorkflowGroups.nodeRect(model, id));

        for (const child of model.children(group.id)) {
            if (seen.has(child.id)) {
                continue;
            }

            const rect = child.collapsed === true
                ? WorkflowGroups.collapsedRect(model, child)
                : WorkflowGroups.frame(WorkflowGroups.contentRects(model, child, seen));

            if (rect !== null) {
                rects.push(rect);
            }
        }

        return rects;
    }

    /** The frame of a group as drawn when expanded (null without members). */
    public static frameOf(model: WorkflowModel, group: WorkflowGroup): RectArea | null {
        return WorkflowGroups.frame(WorkflowGroups.contentRects(model, group));
    }

    private static nodeRect(model: WorkflowModel, id: string): RectArea {
        const node = model.node(id)!;
        const size = WorkflowGeometry.nodeSize(model.getType(node.type), node);

        return {x: node.x, y: node.y, w: size.w, h: size.h};
    }

    /** World rectangles of the group's existing members (nested ones included). */
    public static memberRects(model: WorkflowModel, group: WorkflowGroup): RectArea[] {
        return model.members(group.id).map((id) => WorkflowGroups.nodeRect(model, id));
    }

    /** The frame of an expanded group: members' box plus padding and the header on top. */
    public static frame(rects: RectArea[]): RectArea | null {
        const box = RectBoardGeometry.bounds(rects);
        const pad = WorkflowGroups.PAD;

        return box === null ? null : {
            x: box.x - pad,
            y: box.y - pad - WorkflowGroups.HEADER,
            w: box.w + pad * 2,
            h: box.h + pad * 2 + WorkflowGroups.HEADER
        };
    }

    /**
     * Ports of the collapsed group: one per member port that has a connection
     * to or from outside the group (several outside connections to the same
     * port share it). Inputs and outputs are ordered top to bottom by member.
     */
    public static proxies(model: WorkflowModel, group: WorkflowGroup): WorkflowGroupProxy[] {
        const set = new Set(model.members(group.id));
        const found = new Map<string, {ref: WorkflowPortRef; dir: WorkflowPortDir; port: WorkflowPortSpec}>();

        for (const c of model.allConnections()) {
            const fromIn = set.has(c.from.node);
            const toIn = set.has(c.to.node);
            const end = toIn && !fromIn ? {ref: c.to, dir: 'in' as const} : fromIn && !toIn ? {ref: c.from, dir: 'out' as const} : null;
            const port = end === null ? undefined : model.port(end.ref, end.dir);

            if (end !== null && port !== undefined) {
                found.set(`${end.dir}:${WorkflowGroups.proxyId(end.ref)}`, {ref: {...end.ref}, dir: end.dir, port});
            }
        }

        const order = (e: {ref: WorkflowPortRef; dir: WorkflowPortDir}): [number, number, number] => {
            const node = model.node(e.ref.node)!;
            return [node.y, node.x, model.ports(e.ref.node, e.dir).findIndex((p) => p.id === e.ref.port)];
        };
        const list = [...found.values()].sort((a, b) => {
            const [ay, ax, ai] = order(a);
            const [by, bx, bi] = order(b);
            return ay - by || ax - bx || ai - bi;
        });
        const perSide = new Map<string, number>();

        for (const e of list) {
            const key = `${e.dir}:${WorkflowGeometry.portSide(e.port, e.dir)}`;
            perSide.set(key, (perSide.get(key) ?? 0) + 1);
        }

        return list.map((e) => {
            const side = WorkflowGeometry.portSide(e.port, e.dir);
            const node = model.node(e.ref.node)!;
            const name = node.label ?? model.getType(node.type)?.label ?? node.type;
            const spec: WorkflowPortSpec = {id: WorkflowGroups.proxyId(e.ref), kind: e.port.kind ?? 'main', side};

            // Name the ports only where there is something to tell apart.
            if ((perSide.get(`${e.dir}:${side}`) ?? 0) > 1) {
                spec.label = e.port.label === undefined ? name : `${name} · ${e.port.label}`;
            }

            return {ref: e.ref, dir: e.dir, spec};
        });
    }

    /** The synthetic node type a collapsed group is drawn with. */
    public static collapsedType(model: WorkflowModel, group: WorkflowGroup): WorkflowNodeType {
        const proxies = WorkflowGroups.proxies(model, group);

        return {
            type: WorkflowGroups.TYPE_PREFIX + group.id,
            label: WorkflowGroups.label(group),
            icon: '⧉',
            color: group.color,
            width: WorkflowGroups.BOX_WIDTH,
            inputs: proxies.filter((p) => p.dir === 'in').map((p) => p.spec),
            outputs: proxies.filter((p) => p.dir === 'out').map((p) => p.spec)
        };
    }

    /** Where the collapsed node sits: at the members' top-left corner. Null without members. */
    public static collapsedRect(model: WorkflowModel, group: WorkflowGroup, type = WorkflowGroups.collapsedType(model, group)): RectArea | null {
        const box = RectBoardGeometry.bounds(WorkflowGroups.memberRects(model, group));

        return box === null ? null : {x: box.x, y: box.y, ...WorkflowGeometry.nodeSize(type)};
    }

    /**
     * What is hidden, and by which collapsed group drawn in its place: member
     * nodes, and groups nested inside a collapsed group. With nesting, the
     * outermost collapsed group around an item wins.
     */
    public static hidden(model: WorkflowModel): Map<string, string> {
        const out = new Map<string, string>();
        const outermost = (chain: string[]): string | undefined =>
            [...chain].reverse().find((g) => model.group(g)?.collapsed === true);

        for (const n of model.allNodes()) {
            const g = outermost(model.ancestors(n.id));
            if (g !== undefined) {
                out.set(n.id, g);
            }
        }
        for (const grp of model.allGroups()) {
            const g = outermost(model.ancestors(grp.id));
            if (g !== undefined) {
                out.set(grp.id, g);
            }
        }

        return out;
    }

    /** A connection end as drawn: on the collapsed group's proxy port when its node is hidden. */
    public static drawnEnd(ref: WorkflowPortRef, hidden: ReadonlyMap<string, string>): WorkflowPortRef {
        const g = hidden.get(ref.node);

        return g === undefined ? ref : {node: g, port: WorkflowGroups.proxyId(ref)};
    }

    /** Whether a connection runs inside one collapsed group (and is not drawn). */
    public static isInternal(conn: WorkflowConnection, hidden: ReadonlyMap<string, string>): boolean {
        const a = hidden.get(conn.from.node);

        return a !== undefined && a === hidden.get(conn.to.node);
    }

    /**
     * A copy of the model as it is drawn: each collapsed group is one node
     * (id = group id, synthetic type, at the members' top-left), connections
     * across its border end on its proxy ports, connections inside it are gone.
     */
    public static substitute(model: WorkflowModel): WorkflowModel {
        const hidden = WorkflowGroups.hidden(model);
        const types = model.allTypes();
        const nodes: WorkflowNodeData[] = model.allNodes().filter((n) => !hidden.has(n.id));

        for (const g of model.allGroups()) {
            const type = WorkflowGroups.collapsedType(model, g);
            const rect = g.collapsed === true && !hidden.has(g.id) ? WorkflowGroups.collapsedRect(model, g, type) : null;

            if (rect !== null) {
                types.push(type);
                nodes.push({id: g.id, type: type.type, x: rect.x, y: rect.y});
            }
        }

        const connections = model.allConnections()
            .filter((c) => !WorkflowGroups.isInternal(c, hidden))
            .map((c) => ({...c, from: WorkflowGroups.drawnEnd(c.from, hidden), to: WorkflowGroups.drawnEnd(c.to, hidden)}));

        return new WorkflowModel(types, {nodes, connections});
    }

}
