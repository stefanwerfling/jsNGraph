import { RectBoardGeometry } from '../rect/RectBoardGeometry';
import { WorkflowArrange } from './WorkflowArrange';
import { WorkflowConnections } from './WorkflowConnections';
import type { WorkflowEditor, WorkflowNodeInput } from './WorkflowEditor';
import { WorkflowGeometry } from './WorkflowGeometry';
import { WorkflowModel } from './WorkflowModel';
import { WorkflowRenderer } from './WorkflowRenderer';
import { WorkflowViewport } from './WorkflowViewport';
import { WorkflowNodeData } from './WorkflowTypes';

/** What the palette drag needs from the editor beyond its public API. */
export interface WorkflowPaletteHost {
    readonly model: WorkflowModel;
    readonly root: HTMLDivElement;
    readonly grid: number;
    /** `--wf-*` overrides, copied onto the drag preview. */
    readonly styleVars: ReadonlyMap<string, string>;
}

/**
 * New nodes from a host palette (internal): the drag preview that follows
 * the pointer and lights the connection it would drop into, and the drop
 * itself — a new node centred on the point, or inserted into the connection.
 */
export class WorkflowPalette {

    /** Cleanup of a running palette drag. */
    private paletteDrag: (() => void) | null = null;

    public constructor(
        private readonly host: WorkflowPaletteHost,
        private readonly editor: WorkflowEditor,
        private readonly scene: WorkflowRenderer,
        private readonly connections: WorkflowConnections,
        private readonly arrange: WorkflowArrange,
        private readonly viewport: WorkflowViewport
    ) {}

    /** Add a node at a client point (see `WorkflowEditor.dropAt`); the caller checked read-only. */
    public drop(input: WorkflowNodeInput, clientX: number, clientY: number): WorkflowNodeData | null {
        if (!this.isOver(clientX, clientY)) {
            return null;
        }

        const grid = this.host.grid;
        const size = WorkflowGeometry.nodeSize(this.host.model.getType(input.type));
        const w = this.viewport.toWorld(clientX, clientY);
        const x = RectBoardGeometry.snap(w.x - size.w / 2, grid);
        const y = RectBoardGeometry.snap(w.y - size.h / 2, grid);
        const conn = this.connectionAt(clientX, clientY, input.type);

        if (conn !== null) {
            // Where it was dropped if that spot is free; otherwise beside the
            // source, moving what follows out of the way (insertNode's own placement).
            const free = this.arrange.isFree({x: x - 20, y: y - 20, w: size.w + 40, h: size.h + 40});

            return this.editor.insertNode(conn, free ? {...input, x, y} : input);
        }

        const node = this.editor.addNode({...input, x, y});
        this.editor.select([node.id]);

        return node;
    }

    /** Start dragging a new node (see `WorkflowEditor.beginDrag`); the caller checked read-only. */
    public begin(input: WorkflowNodeInput, e: PointerEvent): void {
        e.preventDefault();
        this.paletteDrag?.();

        const type = this.host.model.getType(input.type);
        const size = WorkflowGeometry.nodeSize(type);
        const preview = this.scene.buildNode({...input, id: '', x: 0, y: 0}, type, {x: 0, y: 0, ...size});
        const ghost = document.createElement('div');
        let target: string | null = null;

        ghost.className = 'wf-ghost';
        ghost.dataset.wfTheme = this.host.root.dataset.wfTheme;
        for (const [name, value] of this.host.styleVars) {
            ghost.style.setProperty(`--wf-${name}`, value);
        }
        ghost.appendChild(preview.el);
        document.body.appendChild(ghost);

        const mark = (id: string | null): void => {
            if (target !== null) {
                this.connections.views.get(target)?.g.classList.remove('wf-drop');
            }
            target = id;
            if (id !== null) {
                this.connections.views.get(id)?.g.classList.add('wf-drop');
            }
        };
        const move = (ev: PointerEvent): void => {
            const s = this.viewport.camera.scale;
            const over = this.isOver(ev.clientX, ev.clientY);

            ghost.style.transform = `translate(${ev.clientX - size.w * s / 2}px, ${ev.clientY - size.h * s / 2}px) scale(${s})`;
            ghost.classList.toggle('wf-ghost-out', !over);
            mark(over ? this.connectionAt(ev.clientX, ev.clientY, input.type) : null);
        };
        const cleanup = (): void => {
            mark(null);
            ghost.remove();
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            window.removeEventListener('keydown', key, true);
            this.paletteDrag = null;
        };
        const up = (ev: PointerEvent): void => {
            cleanup();
            if (ev.type === 'pointerup') {
                const node = this.editor.dropAt(input, ev.clientX, ev.clientY);
                if (node !== null) {
                    this.host.root.focus({preventScroll: true});
                }
            }
        };
        const key = (ev: KeyboardEvent): void => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                cleanup();
            }
        };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        window.addEventListener('keydown', key, true);
        this.paletteDrag = cleanup;
        move(e);
    }

    /** End a running palette drag without dropping. */
    public cancel(): void {
        this.paletteDrag?.();
    }

    /** The client point lies on the editor and nothing of the host covers it there. */
    private isOver(clientX: number, clientY: number): boolean {
        const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(clientX, clientY) : null;

        return hit !== null && this.host.root.contains(hit) && !hit.classList.contains('wf-minimap');
    }

    /**
     * The connection under (or within a few px of) a client point that a node
     * of `type` could be inserted into — a thin line is hard to hit exactly.
     */
    private connectionAt(clientX: number, clientY: number, type: string): string | null {
        const r = 10;

        for (const [dx, dy] of [[0, 0], [0, -r], [0, r], [-r, 0], [r, 0]] as const) {
            const hit = document.elementFromPoint(clientX + dx, clientY + dy);
            const id = hit?.closest<SVGGElement>('[data-wf-conn]')?.dataset.wfConn;

            if (id !== undefined && this.host.root.contains(hit) && this.host.model.canInsert(type, id) && this.connections.canInsertAt(id)) {
                return id;
            }
        }

        return null;
    }

}
