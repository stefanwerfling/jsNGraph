/**
 * jsngraph/iso — Isometric architecture diagrams: projection, icon kit, styles, editor.
 * Importing this subpath alone keeps the other parts out of a bundle;
 * `jsngraph` itself still exports everything.
 */
export { IsoEditor } from './iso/IsoEditor';
export { IsoProjection } from './iso/IsoProjection';
export type { IsoBounds } from './iso/IsoProjection';
export { IsoIcons } from './iso/IsoIcons';
export type { IsoShades } from './iso/IsoIcons';
export { IsoStyles } from './iso/IsoStyles';
export type { IsoStyleVar } from './iso/IsoStyles';
export type {
    IsoTile,
    IsoItem,
    IsoAnchor,
    IsoConnector,
    IsoRegion,
    IsoText,
    IsoDocument,
    IsoIconType,
    IsoEditorOptions,
    IsoItemEvent,
    IsoRegionEvent,
    IsoEditorEvents
} from './iso/IsoTypes';
