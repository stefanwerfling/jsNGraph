import { EventEmitter } from '../util/EventEmitter';
import { Camera } from '../view/Camera';
import { IsoFragment } from './IsoModel';
import { IsoProjection } from './IsoProjection';
import {
    IsoAnchor, IsoChangeKind, IsoDocument, IsoEditorEvents, IsoIconType, IsoItem, IsoMode, IsoText, IsoTile
} from './IsoTypes';

/** The editor's document with every list present. */
export type IsoDoc = Required<IsoDocument>;

/**
 * What `IsoEditor` hands its internal parts (scene, overlay, live layer,
 * gestures, keyboard, label editor): shared view objects, the current
 * document / selection / mode, and the editor actions they trigger. Internal,
 * not exported from the package.
 */
export interface IsoHost {
    readonly root: HTMLDivElement;
    readonly camera: Camera;
    readonly proj: IsoProjection;
    readonly events: EventEmitter<IsoEditorEvents>;

    /** The live document (not a copy). */
    doc(): IsoDoc;
    /** Swap the document without an undo step (live drags). */
    setDoc(doc: IsoDoc): void;
    selected(): ReadonlySet<string>;
    mode(): IsoMode;
    readOnly(): boolean;
    /** Icon type by id, falling back to the built-in box. */
    iconType(id: string): IsoIconType;

    select(ids: string[]): void;
    /** Record an undo step, redraw, emit `change`. */
    commit(kind: IsoChangeKind, ids: string[]): void;
    render(): void;
    applyClasses(): void;
    applyCamera(): void;
    /** The user moved the camera: stop auto-fitting. */
    markMoved(): void;
    /** Cancel a running camera flight. */
    stopFlight(): void;

    setMode(mode: IsoMode): void;
    fit(animate: boolean): void;
    editLabel(id: string): void;
    addConnector(from: IsoAnchor, to: IsoAnchor): string;
    addRegion(from: IsoTile, to: IsoTile): string;
    addText(tile: IsoTile, text: string): string;
    dropAt(icon: string, clientX: number, clientY: number, data: Partial<Omit<IsoItem, 'id' | 'tile' | 'icon'>>): string;
    updateText(id: string, patch: Partial<Omit<IsoText, 'id'>>): void;
    remove(ids: string[]): void;
    undo(): boolean;
    redo(): boolean;
    selectAll(): void;
    duplicate(): string[];
    paste(fragment?: IsoFragment): string[];
}
