import { IsoGestures } from './IsoGestures';
import { IsoHost } from './IsoHost';
import { IsoLabelEditor } from './IsoLabelEditor';
import { IsoFragment, IsoModel } from './IsoModel';
import { IsoMode } from './IsoTypes';

/**
 * Keyboard and clipboard of the editor (internal to `IsoEditor`): Escape,
 * undo/redo, select all, duplicate, delete, F2, arrow moves, mode letters on
 * the focused root, and the document's copy / cut / paste events (JSON
 * fragments under one key, so foreign clipboard text is ignored). Holds the
 * internal clipboard fragment.
 */
export class IsoKeyboard {

    /** Key of our fragment in clipboard JSON. */
    public static readonly CLIP_KEY = 'jsngraph-iso';

    private readonly host: IsoHost;
    private readonly gestures: IsoGestures;
    private readonly labels: IsoLabelEditor;
    private fragment: IsoFragment | null = null;

    public constructor(host: IsoHost, gestures: IsoGestures, labels: IsoLabelEditor) {
        this.host = host;
        this.gestures = gestures;
        this.labels = labels;
        host.root.addEventListener('keydown', this.onKey);
        document.addEventListener('copy', this.onCopy);
        document.addEventListener('cut', this.onCut);
        document.addEventListener('paste', this.onPaste);
    }

    /** The last copied fragment (live, not a copy). */
    public get stored(): IsoFragment | null {
        return this.fragment;
    }

    /** Copy the selection into the internal clipboard and, when allowed, the system one. Null when nothing is selected. */
    public copy(): IsoFragment | null {
        const selected = this.host.selected();

        if (selected.size === 0) {
            return null;
        }
        this.fragment = IsoModel.fragment(this.host.doc(), selected);
        const json = JSON.stringify(this.fragment);
        navigator.clipboard?.writeText(`{"${IsoKeyboard.CLIP_KEY}":${json}}`).catch(() => undefined);

        return JSON.parse(json) as IsoFragment;
    }

    public destroy(): void {
        document.removeEventListener('copy', this.onCopy);
        document.removeEventListener('cut', this.onCut);
        document.removeEventListener('paste', this.onPaste);
    }

    private readonly onKey = (e: KeyboardEvent): void => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
            return;
        }
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();

        if (e.key === 'Escape') {
            if (this.gestures.busy) {
                this.gestures.clearPending();
                this.gestures.cancel();
            } else if (this.host.mode() !== 'select') {
                this.host.setMode('select');
            } else {
                this.host.select([]);
            }
            return;
        }
        if (this.host.readOnly()) {
            return;
        }
        if (mod && key === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
                this.host.redo();
            } else {
                this.host.undo();
            }
        } else if (mod && key === 'y') {
            e.preventDefault();
            this.host.redo();
        } else if (mod && key === 'a') {
            e.preventDefault();
            this.host.selectAll();
        } else if (mod && key === 'd') {
            e.preventDefault();
            this.host.duplicate();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            this.host.remove([...this.host.selected()]);
        } else if (e.key === 'F2' && this.host.selected().size === 1) {
            this.host.editLabel([...this.host.selected()][0]!);
        } else if (e.key.startsWith('Arrow') && this.host.selected().size > 0) {
            e.preventDefault();
            const [dx, dy] = {ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1]}[e.key] ?? [0, 0];
            const ids = new Set([...this.host.selected()].filter((id) => IsoModel.kindOf(this.host.doc(), id) !== 'connector'));
            if (IsoModel.canMove(this.host.doc(), ids, dx!, dy!)) {
                IsoModel.move(this.host.doc(), ids, dx!, dy!);
                this.host.commit('move', [...ids]);
            }
        } else if (!mod && !e.altKey) {
            const mode = ({v: 'select', c: 'connect', r: 'region', t: 'text', h: 'pan'} as Record<string, IsoMode>)[key];
            if (mode !== undefined) {
                this.host.setMode(mode);
            }
        }
    };

    private focused(): boolean {
        return document.activeElement === this.host.root && !this.labels.active;
    }

    private readonly onCopy = (e: ClipboardEvent): void => {
        if (!this.focused() || this.host.selected().size === 0) {
            return;
        }
        this.fragment = IsoModel.fragment(this.host.doc(), this.host.selected());
        e.clipboardData?.setData('text/plain', JSON.stringify({[IsoKeyboard.CLIP_KEY]: this.fragment}));
        e.preventDefault();
    };

    private readonly onCut = (e: ClipboardEvent): void => {
        if (!this.focused() || this.host.selected().size === 0 || this.host.readOnly()) {
            return;
        }
        this.onCopy(e);
        this.host.remove([...this.host.selected()]);
    };

    private readonly onPaste = (e: ClipboardEvent): void => {
        if (!this.focused() || this.host.readOnly()) {
            return;
        }
        let f: IsoFragment | null = this.fragment;
        const text = e.clipboardData?.getData('text/plain') ?? '';
        try {
            const parsed = JSON.parse(text) as Record<string, IsoFragment>;
            const ours = parsed[IsoKeyboard.CLIP_KEY];
            if (ours !== undefined) {
                f = ours;
            }
        } catch {
            // not ours: keep the internal clipboard
        }
        if (f !== null) {
            e.preventDefault();
            this.host.paste(f);
        }
    };

}
