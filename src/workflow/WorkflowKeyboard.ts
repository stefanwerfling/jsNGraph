import type { WorkflowEditor } from './WorkflowEditor';
import { WorkflowGestures } from './WorkflowGestures';
import { WorkflowRenderer } from './WorkflowRenderer';
import { WorkflowViewport } from './WorkflowViewport';
import { WorkflowFragment } from './WorkflowTypes';
import { WorkflowModel } from './WorkflowModel';

/** What the keyboard handler needs from the editor beyond its public API. */
export interface WorkflowKeyboardHost {
    readonly root: HTMLDivElement;
    selection(): ReadonlySet<string>;
    selectedConnection(): string | null;
}

/**
 * Keyboard and clipboard input of the workflow editor (internal):
 * shortcuts (Escape, Ctrl+A/Z/Y/G/D, Delete, D) and copy/cut/paste of JSON
 * fragments through the system clipboard while the editor has focus.
 */
export class WorkflowKeyboard {

    private readonly onKey = (e: KeyboardEvent): void => this.handleKey(e);
    private readonly onCopy = (e: ClipboardEvent): void => this.handleClipboard(e, 'copy');
    private readonly onCut = (e: ClipboardEvent): void => this.handleClipboard(e, 'cut');
    private readonly onPaste = (e: ClipboardEvent): void => this.handleClipboard(e, 'paste');

    public constructor(
        private readonly host: WorkflowKeyboardHost,
        private readonly editor: WorkflowEditor,
        private readonly scene: WorkflowRenderer,
        private readonly gestures: WorkflowGestures,
        private readonly viewport: WorkflowViewport
    ) {
        host.root.addEventListener('keydown', this.onKey);
        document.addEventListener('copy', this.onCopy);
        document.addEventListener('cut', this.onCut);
        document.addEventListener('paste', this.onPaste);
    }

    public destroy(): void {
        this.host.root.removeEventListener('keydown', this.onKey);
        document.removeEventListener('copy', this.onCopy);
        document.removeEventListener('cut', this.onCut);
        document.removeEventListener('paste', this.onPaste);
    }

    /** A clipboard text as a fragment, or null when it is not one of ours. */
    public static parseFragment(text: string): WorkflowFragment | null {
        try {
            const data = JSON.parse(text) as Partial<WorkflowFragment>;

            if (data.format === 'jsngraph-workflow' && Array.isArray(data.nodes) && Array.isArray(data.connections)) {
                return {format: 'jsngraph-workflow', version: 1, ...WorkflowModel.cleanFragment(data)};
            }
        } catch {
            // not JSON — someone else's clipboard
        }

        return null;
    }

    /** Copy/cut/paste while the editor has focus; the clipboard carries a JSON fragment. */
    private handleClipboard(e: ClipboardEvent, kind: 'copy' | 'cut' | 'paste'): void {
        const active = document.activeElement;

        if (active === null || !this.host.root.contains(active) || this.gestures.active || WorkflowGestures.isField(active)) {
            return;
        }

        if (kind === 'paste') {
            if (this.editor.readOnly) {
                return;
            }

            const fragment = WorkflowKeyboard.parseFragment(e.clipboardData?.getData('text/plain') ?? '');

            if (fragment !== null) {
                e.preventDefault();
                const p = this.gestures.pointer;
                const at = p === null ? undefined : this.viewport.camera.toWorld(p.x, p.y);
                this.editor.paste(fragment, at);
            }
            return;
        }

        const fragment = this.editor.copySelection();

        if (fragment === null || e.clipboardData === null) {
            return;
        }

        e.preventDefault();
        e.clipboardData.setData('text/plain', JSON.stringify(fragment));

        if (kind === 'cut' && !this.editor.readOnly) {
            this.editor.remove([...this.host.selection()], false);
        }
    }

    private handleKey(e: KeyboardEvent): void {
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        const editor = this.editor;

        if (WorkflowGestures.isField(e.target as Element) || WorkflowGestures.isBodyControl(e.target as Element)) {
            return;
        }

        if (key === 'escape') {
            if (this.gestures.active) {
                this.gestures.cancel();
            } else {
                editor.clearSelection();
            }
            return;
        }
        if (mod && key === 'a') {
            e.preventDefault();
            editor.select([...this.scene.nodeViews.keys(), ...this.scene.noteViews.keys()]);
            return;
        }
        if (editor.readOnly || this.gestures.active) {
            return;
        }
        if (key === 'delete' || key === 'backspace') {
            e.preventDefault();
            this.deleteSelection();
        } else if (mod && key === 'z' && !e.shiftKey) {
            e.preventDefault();
            editor.undo();
        } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
            e.preventDefault();
            editor.redo();
        } else if (mod && key === 'g' && !e.shiftKey) {
            e.preventDefault();
            editor.group();
        } else if (mod && key === 'g') {
            e.preventDefault();
            const groups = new Set(editor.getSelection().groups);
            if (groups.size === 0) {
                editor.getSelection().nodes.forEach((id) => {
                    const g = editor.groupOf(id);
                    if (g !== null) {
                        groups.add(g);
                    }
                });
            }
            groups.forEach((id) => editor.ungroup(id));
        } else if (mod && key === 'd') {
            e.preventDefault();
            editor.duplicateSelection();
        } else if (!mod && !e.altKey && key === 'd' && this.host.selection().size > 0) {
            e.preventDefault();
            editor.setDisabled(this.host.selection());
        }
    }

    private deleteSelection(): void {
        const conn = this.host.selectedConnection();

        if (conn !== null) {
            this.editor.disconnect(conn);
        } else if (this.host.selection().size > 0) {
            this.editor.remove([...this.host.selection()]);
        }
    }

}
