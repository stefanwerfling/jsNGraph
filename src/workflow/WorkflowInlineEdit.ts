import { WorkflowConnections } from './WorkflowConnections';
import { WorkflowGroups } from './WorkflowGroups';
import { WorkflowModel } from './WorkflowModel';
import { WorkflowRenderer } from './WorkflowRenderer';
import { WorkflowGroup } from './WorkflowTypes';

/** What the inline editors need from the editor. */
export interface WorkflowInlineEditHost {
    readonly model: WorkflowModel;
    readonly root: HTMLDivElement;
    readOnly(): boolean;
    /** Store a connection label as one undo step; false when nothing changed. */
    setConnectionLabel(id: string, label: string | null): boolean;
    /** Store a group label as one undo step. */
    updateGroup(id: string, patch: Partial<Pick<WorkflowGroup, 'label'>>): boolean;
    /** Record a changed note text as one undo step. */
    commitNote(id: string): void;
}

/**
 * The editor's in-place text editors (internal): a sticky note's textarea,
 * a connection label input and a group label input. At most one of each is
 * open; finishing stores the text as one undo step or restores the view.
 */
export class WorkflowInlineEdit {

    private noteEdit: {id: string; area: HTMLTextAreaElement; before: string} | null = null;
    private connEdit: {id: string; input: HTMLInputElement} | null = null;
    private groupEdit: {id: string; input: HTMLInputElement} | null = null;

    public constructor(
        private readonly host: WorkflowInlineEditHost,
        private readonly scene: WorkflowRenderer,
        private readonly connections: WorkflowConnections
    ) {}

    public get editingNote(): string | null {
        return this.noteEdit?.id ?? null;
    }

    public get editingConnection(): string | null {
        return this.connEdit?.id ?? null;
    }

    public get editingGroup(): string | null {
        return this.groupEdit?.id ?? null;
    }

    // ---- notes ---------------------------------------------------------

    /** Open a note's text for editing. */
    public editNote(id: string): void {
        const view = this.scene.noteViews.get(id);
        const note = this.host.model.note(id);

        if (this.host.readOnly() || view === undefined || note === undefined) {
            return;
        }

        this.finishNote(true);

        const area = document.createElement('textarea');
        area.className = 'wf-note-edit';
        area.value = note.text;
        area.addEventListener('blur', () => this.finishNote(true));
        area.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
                this.finishNote(false);
                this.host.root.focus({preventScroll: true});
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.finishNote(true);
                this.host.root.focus({preventScroll: true});
            }
        });

        view.el.querySelector<HTMLElement>('.wf-note-text')!.style.visibility = 'hidden';
        view.el.appendChild(area);
        this.noteEdit = {id, area, before: note.text};
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
    }

    /** Close the note editor; `keep` stores the text (one undo step) when it changed. */
    public finishNote(keep: boolean): void {
        const edit = this.noteEdit;
        const model = this.host.model;

        if (edit === null) {
            return;
        }

        this.noteEdit = null;     // first: removing the textarea fires blur → re-entry
        const text = edit.area.value;
        edit.area.remove();

        if (keep && text !== edit.before && model.updateNote(edit.id, {text})) {
            this.scene.renderNote(model.note(edit.id)!);
            this.host.commitNote(edit.id);
        } else if (model.note(edit.id) !== undefined) {
            this.scene.renderNote(model.note(edit.id)!);
        }
    }

    // ---- connection labels ---------------------------------------------

    /** Open a connection's label for editing. */
    public editConnectionLabel(id: string): void {
        const conn = this.host.model.connection(id);
        const cv = this.connections.views.get(id);

        if (this.host.readOnly() || conn === undefined || cv === undefined) {
            return;
        }

        this.finishConnection(true);

        const input = document.createElement('input');
        input.className = 'wf-conn-text-edit';
        input.value = conn.label ?? '';
        input.placeholder = 'Label';
        input.style.left = `${cv.mid.x}px`;
        input.style.top = `${cv.mid.y}px`;
        input.addEventListener('blur', () => this.finishConnection(true));
        input.addEventListener('pointerdown', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape' || e.key === 'Enter') {
                this.finishConnection(e.key === 'Enter');
                this.host.root.focus({preventScroll: true});
            }
        });

        if (cv.text !== null) {
            cv.text.style.visibility = 'hidden';
        }
        this.scene.labelLayer.appendChild(input);
        this.connEdit = {id, input};
        input.focus();
        input.select();
    }

    /** Close the label editor; `keep` stores the text (one undo step) when it changed. */
    public finishConnection(keep: boolean): void {
        const edit = this.connEdit;

        if (edit === null) {
            return;
        }

        this.connEdit = null;     // first: removing the input fires blur → re-entry
        const text = edit.input.value;
        edit.input.remove();

        if (!keep || !this.host.setConnectionLabel(edit.id, text)) {
            this.connections.render();
        }
    }

    /** The edited connection is no longer drawn: drop the input without storing. */
    public dropConnection(): void {
        if (this.connEdit !== null) {
            this.connEdit.input.remove();
            this.connEdit = null;
        }
    }

    // ---- group labels --------------------------------------------------

    /** Open a group's label for editing. */
    public editGroupLabel(id: string): void {
        const group = this.host.model.group(id);
        const rect = this.scene.groupViews.get(id)?.rect ?? this.scene.nodeViews.get(id)?.rect;

        if (this.host.readOnly() || group === undefined || rect === undefined) {
            return;
        }

        this.finishGroup(true);

        const input = document.createElement('input');
        input.className = 'wf-group-edit';
        input.value = WorkflowGroups.label(group);
        input.placeholder = WorkflowGroups.DEFAULT_LABEL;
        input.style.left = `${rect.x + 36}px`;
        input.style.top = `${rect.y + 5}px`;
        input.addEventListener('blur', () => this.finishGroup(true));
        input.addEventListener('pointerdown', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape' || e.key === 'Enter') {
                this.finishGroup(e.key === 'Enter');
                this.host.root.focus({preventScroll: true});
            }
        });

        this.scene.labelLayer.appendChild(input);
        this.groupEdit = {id, input};
        input.focus();
        input.select();
    }

    /** Close the group label editor; `keep` stores the label (one undo step) when it changed. */
    public finishGroup(keep: boolean): void {
        const edit = this.groupEdit;

        if (edit === null) {
            return;
        }

        this.groupEdit = null;    // first: removing the input fires blur → re-entry
        const text = edit.input.value.trim();
        const group = this.host.model.group(edit.id);
        edit.input.remove();

        if (keep && group !== undefined && text !== WorkflowGroups.label(group)) {
            this.host.updateGroup(edit.id, {label: text});
        } else if (group !== undefined) {
            this.scene.renderGroups();
            this.connections.render();
        }
    }

}
