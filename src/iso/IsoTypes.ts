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

export interface IsoEditorOptions {
    document?: IsoDocument;
    /** Only viewing in this milestone; editing arrives with I3. */
    readOnly?: boolean;
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
    /** Selected item and connector ids. */
    selectionChange: string[];
    viewportChange: {scale: number; offsetX: number; offsetY: number};
}
