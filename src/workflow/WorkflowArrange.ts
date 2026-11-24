import { RectArea, RectBoardGeometry, RectPoint } from '../rect/RectBoardGeometry';
import { WorkflowGroups } from './WorkflowGroups';
import { WorkflowLayout, WorkflowLayoutOptions } from './WorkflowLayout';
import { WorkflowModel } from './WorkflowModel';
import { WorkflowRenderer } from './WorkflowRenderer';
import { WorkflowChangeKind, WorkflowDocument, WorkflowGroup } from './WorkflowTypes';

/** What the arranger needs from the editor. */
export interface WorkflowArrangeHost {
    readonly model: WorkflowModel;
    readonly grid: number;
    renderConnections(): void;
    commit(kind: WorkflowChangeKind, nodes: string[], connections: string[], notes?: string[], groups?: string[]): void;
    /** A tidy-up landed and was committed: frame the result. */
    tidied(animate: boolean): void;
}

/**
 * Where things go in the workflow editor (internal): the animated tidy-up
 * (one undoable move, settled at once when something else needs the final
 * state), room-making when a group opens or a node is inserted, and the
 * offset of a pasted fragment.
 */
export class WorkflowArrange {

    /** Frame handle of a running tidy-up animation; input waits for it. */
    private tween: number | null = null;
    /** Ends the running tidy-up at once: jump to the end and commit it as one move. */
    private tweenFinish: (() => void) | null = null;

    public constructor(private readonly host: WorkflowArrangeHost, private readonly scene: WorkflowRenderer) {}

    /** A tidy-up is animating. */
    public get running(): boolean {
        return this.tween !== null;
    }

    /**
     * Lay out what is drawn (a collapsed group is one node, its members move
     * along) and move there, animated unless `animate: false`; notes that
     * enclosed nodes are fitted around them again. One `move` commit.
     */
    public tidy(options: WorkflowLayoutOptions & {animate?: boolean}): void {
        const model = this.host.model;
        const grid = this.host.grid;
        const drawn = WorkflowGroups.substitute(model);
        const viewTarget = WorkflowLayout.compute(drawn, {grid, ...options});
        const target = new Map<string, RectPoint>();
        const from = new Map<string, RectPoint>();

        for (const [id, p] of viewTarget) {
            if (model.node(id) !== undefined) {
                target.set(id, p);
                continue;
            }

            const at = drawn.node(id)!;

            for (const m of model.members(id)) {
                const n = model.node(m)!;
                target.set(m, {x: n.x + p.x - at.x, y: n.y + p.y - at.y});
            }
        }
        for (const [id] of target) {
            const n = model.node(id)!;
            from.set(id, {x: n.x, y: n.y});
        }

        const moved = [...target].filter(([id, p]) => from.get(id)!.x !== p.x || from.get(id)!.y !== p.y).map(([id]) => id);

        // Notes that framed a group follow it: their new box wraps the group's new boxes.
        const noteFrom = new Map<string, RectArea>();
        const noteTo = new Map<string, RectArea>();

        for (const [id, view] of this.scene.noteViews) {
            const inside = [...this.scene.nodeViews].filter(([, v]) => RectBoardGeometry.contains(view.rect, v.rect));
            const box = RectBoardGeometry.bounds(inside.map(([nid, v]) => ({...v.rect, ...viewTarget.get(nid)!})));

            if (inside.length === 0 || box === null) {
                continue;
            }

            const top = inside.reduce((m, [, v]) => Math.min(m, v.rect.y), Infinity) - view.rect.y;
            const left = inside.reduce((m, [, v]) => Math.min(m, v.rect.x), Infinity) - view.rect.x;
            const padTop = Math.max(20, Math.min(top, 120));
            const pad = Math.max(20, Math.min(left, 60));

            noteFrom.set(id, {...view.rect});
            noteTo.set(id, {
                x: box.x - pad,
                y: box.y - padTop,
                w: RectBoardGeometry.snap(box.w + pad * 2, grid),
                h: RectBoardGeometry.snap(box.h + padTop + pad, grid)
            });
        }

        if (moved.length === 0) {
            return;
        }

        const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
        const apply = (t: number): void => {
            for (const [id, p] of target) {
                const o = from.get(id)!;
                if (model.node(id) === undefined) {
                    continue;
                }
                model.moveNode(id, lerp(o.x, p.x, t), lerp(o.y, p.y, t));
                this.scene.positionNode(id);
            }
            for (const [id, to] of noteTo) {
                const o = noteFrom.get(id)!;
                if (model.note(id) === undefined) {
                    continue;
                }
                model.updateNote(id, {x: lerp(o.x, to.x, t), y: lerp(o.y, to.y, t), w: lerp(o.w, to.w, t), h: lerp(o.h, to.h, t)});
                this.scene.positionNote(id);
            }
            this.host.renderConnections();
        };
        const finish = (): void => {
            this.tween = null;
            this.tweenFinish = null;
            apply(1);
            this.host.commit('move', moved, [], [...noteTo.keys()]);
            this.host.tidied(options.animate !== false);
        };

        if (options.animate === false || typeof requestAnimationFrame === 'undefined') {
            finish();
            return;
        }

        let start: number | null = null;
        const frame = (now: number): void => {
            start ??= now;
            const t = Math.min(1, (now - start) / 350);

            if (t >= 1) {
                finish();
                return;
            }
            apply(t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
            this.tween = requestAnimationFrame(frame);
        };

        this.tween = requestAnimationFrame(frame);
        this.tweenFinish = finish;
    }

    /**
     * A tidy-up still animating is completed right now (committed as its one
     * move), so a following undo, delete or mode switch sees the final state —
     * undo then takes the tidy-up back instead of being overwritten by it.
     */
    public settle(): void {
        const finish = this.tweenFinish;

        if (this.tween !== null) {
            cancelAnimationFrame(this.tween);
        }
        if (finish !== null) {
            finish();
        }
    }

    /** Stop a running tidy-up without committing (the document is being replaced). */
    public drop(): void {
        if (this.tween !== null) {
            cancelAnimationFrame(this.tween);
        }
        this.tween = null;
        this.tweenFinish = null;
    }

    /**
     * Before a group opens up: when its frame would cover other nodes, nodes
     * right of the collapsed node move right and nodes under it move down by
     * as much as the frame outgrows it. Returns the moved node ids.
     */
    public makeRoom(group: WorkflowGroup, box: RectArea): string[] {
        const model = this.host.model;
        const grid = this.host.grid;
        const frame = WorkflowGroups.frameOf(model, group);
        const inside = new Set([...model.members(group.id), ...model.descendantGroups(group.id)]);
        // Nodes, and collapsed groups (moved with their members), outside the opening group.
        const others = [...this.scene.nodeViews].filter(([id]) => !inside.has(id) && (model.node(id) !== undefined || model.group(id) !== undefined));
        const gap = WorkflowGroups.PAD * 2;   // room for ports and a little air

        if (frame === null) {
            return [];
        }

        const grown = {x: frame.x - gap, y: frame.y - gap, w: frame.w + gap * 2, h: frame.h + gap * 2};

        if (!others.some(([, v]) => RectBoardGeometry.overlaps(grown, v.rect))) {
            return [];
        }

        const dx = RectBoardGeometry.snap(Math.max(0, frame.x + frame.w + gap - (box.x + box.w)), grid);
        const dy = RectBoardGeometry.snap(Math.max(0, frame.y + frame.h + gap - (box.y + box.h)), grid);
        const moved: string[] = [];

        for (const [id, v] of others) {
            const right = v.rect.x >= box.x + box.w;
            const below = !right && v.rect.y >= box.y + box.h && v.rect.x < frame.x + frame.w && v.rect.x + v.rect.w > frame.x;
            const shift = right ? {x: dx, y: 0} : below ? {x: 0, y: dy} : null;

            if (shift === null || (shift.x === 0 && shift.y === 0)) {
                continue;
            }
            for (const n of model.node(id) !== undefined ? [id] : model.members(id)) {
                const node = model.node(n)!;

                model.moveNode(n, node.x + shift.x, node.y + shift.y);
                moved.push(n);
            }
            this.scene.positionNode(id);
        }

        return moved;
    }

    /** No drawn node overlaps the area. */
    public isFree(area: RectArea): boolean {
        return ![...this.scene.nodeViews.values()].some((v) => RectBoardGeometry.overlaps(area, v.rect));
    }

    /**
     * Make room for a node inserted at `area` right of a source node: when
     * the spot is taken, every node right of the source moves over by `width`
     * (snapped, plus a gap). Returns the moved node ids.
     */
    public makeRoomRight(area: RectArea, sourceId: string, sourceRight: number, width: number): string[] {
        const moved: string[] = [];

        if (this.isFree(area)) {
            return moved;
        }

        const shift = RectBoardGeometry.snap(width + 80, this.host.grid);

        for (const [id, v] of this.scene.nodeViews) {
            if (id !== sourceId && v.rect.x >= sourceRight) {
                this.host.model.moveNode(id, v.rect.x + shift, v.rect.y);
                this.scene.positionNode(id);
                moved.push(id);
            }
        }

        return moved;
    }

    /**
     * Offset for a pasted fragment: its top-left at `at` (snapped), or without
     * it, diagonal steps of 40 until the copy no longer sits on the original.
     */
    public pasteOffset(fragment: WorkflowDocument, at: RectPoint | undefined): RectPoint | null {
        const items: RectPoint[] = [...fragment.nodes, ...(fragment.notes ?? [])];
        const model = this.host.model;

        if (items.length === 0) {
            return null;
        }

        if (at !== undefined) {
            const minX = Math.min(...items.map((n) => n.x));
            const minY = Math.min(...items.map((n) => n.y));

            return {x: RectBoardGeometry.snap(at.x - minX, this.host.grid), y: RectBoardGeometry.snap(at.y - minY, this.host.grid)};
        }

        const taken = new Set([...model.allNodes(), ...model.allNotes()].map((n) => `${n.x},${n.y}`));
        const first = items[0]!;
        let k = 1;

        while (k < 50 && taken.has(`${first.x + 40 * k},${first.y + 40 * k}`)) {
            k++;
        }

        return {x: 40 * k, y: 40 * k};
    }

}
