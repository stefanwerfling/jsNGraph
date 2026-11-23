/** A tile on the floor grid: x grows to the lower right, y to the lower left. */
export interface IsoTile {
    x: number;
    y: number;
}

/** A device or service standing on one tile. */
export interface IsoItem {
    id: string;
    tile: IsoTile;
    /** `IsoIconType.id`; unknown ids draw a generic box. */
    icon: string;
    label?: string;
    description?: string;
    /** Base colour of the icon (faces are shaded from it); default the icon type's colour. */
    color?: string;
    /** Colour of the floor tile under it; default a tint of `color`; '' = none. */
    base?: string;
    /** How high the label callout floats above the icon, in tile heights (default 1; 0 = label right on the icon). */
    labelHeight?: number;
    /** Icon size relative to a tile (default 1), e.g. 0.6 for a pallet. */
    scale?: number;
    /** Mirror the icon left ↔ right (faces the other diagonal). */
    flip?: boolean;
    meta?: unknown;
}

export type IsoAnchor = {item: string} | {tile: IsoTile};

/** A line between two items or tiles, routed along the grid around other items. */
export interface IsoConnector {
    id: string;
    from: IsoAnchor;
    to: IsoAnchor;
    via?: IsoTile[];
    style?: 'solid' | 'dashed' | 'dotted';
    /** Line width in px at zoom 1 (default 6). */
    width?: number;
    color?: string;
    /** Arrowheads lying on the floor (default 'end'). */
    arrows?: 'none' | 'end' | 'both';
    label?: string;
    /** Where the label sits along the route, 0…1 (default 0.5). */
    labelAt?: number;
    /** Dots travelling from → to (off under prefers-reduced-motion). */
    animated?: boolean;
}

/** A coloured area on the floor covering the tiles from…to (inclusive, any corner order). */
export interface IsoRegion {
    id: string;
    from: IsoTile;
    to: IsoTile;
    color?: string;
    label?: string;
    /** Walls along the two back edges (the far ones), in tile heights — rooms and halls seen as a cut-away. */
    wall?: number;
    /** Tiles inside the region along a back edge where the wall has a gap. */
    doors?: IsoTile[];
}

/** Text printed on the floor, starting at a tile, running along x (to the lower right) or y (from the tile to the upper right). */
export interface IsoText {
    id: string;
    tile: IsoTile;
    text: string;
    /** Font size in tile units (default 0.4). */
    size?: number;
    axis?: 'x' | 'y';
    color?: string;
    bold?: boolean;
}

export interface IsoDocument {
    items: IsoItem[];
    connectors?: IsoConnector[];
    regions?: IsoRegion[];
    texts?: IsoText[];
}

/** An icon: SVG markup drawn in a 100 × 140 box whose tile diamond centre is (50, 115). */
export interface IsoIconType {
    id: string;
    label?: string;
    /** Default base colour. */
    color?: string;
    /** Markup of the inner SVG (no <svg> wrapper) for a base colour. */
    render: (color: string) => string;
    /** Height above the tile centre the icon reaches (px in the 100-wide box), for label placement; default 70. */
    height?: number;
}

export type IsoStatusState = 'ok' | 'warn' | 'down' | 'idle';

/** Live status of an item — display state, not document data. */
export interface IsoItemStatus {
    state: IsoStatusState;
    /** Short line shown in the label (e.g. "running · 42/min"). */
    message?: string;
    /** 0…1, drawn as a bar in the label. */
    progress?: number;
}

/** Live status of a connector. */
export interface IsoConnectorStatus {
    /** false = dimmed, no travelling dots. */
    active?: boolean;
    /** Override the line colour (e.g. by load). */
    color?: string;
}

/**
 * Something moving over the floor (forklift, worker, crate): drawn like an item
 * but placed at any floor point and updated cheaply, every frame if needed.
 * Not document data; no events.
 */
export interface IsoActor {
    id: string;
    icon: string;
    /** Floor position in tiles (the centre of tile {x, y} is x + 0.5, y + 0.5). */
    u: number;
    v: number;
    color?: string;
    scale?: number;
    flip?: boolean;
    /** Tooltip. */
    title?: string;
}

/** What a press on the floor does: select/move, draw a connector, draw a region, place a text, or always pan. */
export type IsoMode = 'select' | 'connect' | 'region' | 'text' | 'pan';

export type IsoChangeKind = 'add' | 'move' | 'remove' | 'update' | 'connect' | 'reroute' | 'region' | 'resize' | 'text'
    | 'paste' | 'undo' | 'redo';

/** One finished gesture or API edit (the document after it: `getDocument()`). */
export interface IsoChange {
    kind: IsoChangeKind;
    /** Ids added, moved, removed or updated. */
    ids: string[];
}

export interface IsoEditorOptions {
    document?: IsoDocument;
    /** Viewer only: pan, zoom, select, click events — no editing (default false). */
    readOnly?: boolean;
    /** Initial mode (default 'select'). */
    mode?: IsoMode;
    /** Undo steps kept (default 100). */
    historySize?: number;
    theme?: 'dark' | 'light';
    /** Extra or replacing icon types. */
    icons?: IsoIconType[];
    /** Width of a tile in px at zoom 1 (height is half of it; default 100). */
    tileSize?: number;
    /** Draw the floor grid (default true). */
    grid?: boolean;
    minScale?: number;
    maxScale?: number;
}

export interface IsoItemEvent {
    item: IsoItem;
    originalEvent: MouseEvent;
}

export interface IsoRegionEvent {
    region: IsoRegion;
    originalEvent: MouseEvent;
}

export interface IsoConnectorEvent {
    connector: IsoConnector;
    originalEvent: MouseEvent;
}

export interface IsoEditorEvents extends Record<string, unknown> {
    itemHover: IsoItem | null;
    connectorHover: IsoConnector | null;
    connectorClick: IsoConnectorEvent;
    itemClick: IsoItemEvent;
    itemDblClick: IsoItemEvent;
    regionClick: IsoRegionEvent;
    /** A click on the empty floor, with the tile under the pointer. */
    floorClick: {tile: IsoTile; originalEvent: MouseEvent};
    /** Selected ids (items, connectors, regions, texts). */
    selectionChange: string[];
    change: IsoChange;
    modeChange: IsoMode;
    viewportChange: {scale: number; offsetX: number; offsetY: number};
}
