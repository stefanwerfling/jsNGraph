/** Draws a glyph centred at (x, y) into a box of `size` px, in `color`. */
export type RecordIconDrawer = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) => void;

/** One line of a record: a product, a column, a field — with an optional value (stock, count, type). */
export interface RecordRow {
    /** Unique inside its record. */
    id: string;
    label: string;
    /** Shown right-aligned; a number ≤ 0 is drawn as an alert. */
    value?: number | string;
}

/** A card with a header (icon, title, subtitle) and a table of rows; links attach to rows. */
export interface RecordNode {
    id: string;
    title: string;
    subtitle?: string;
    /** A built-in glyph name (see `RecordIcons.names`) or a drawer. */
    icon?: string | RecordIconDrawer;
    /** Accent of the header (any CSS colour); default from the palette. */
    color?: string;
    /** Id of the group (frame) it belongs to. */
    group?: string;
    /** Force the column (0 = left); default = longest path from the sources. */
    column?: number;
    rows: RecordRow[];
}

/** A frame around records, collapsible into one compact box. */
export interface RecordGroup {
    id: string;
    label: string;
    collapsed?: boolean;
}

/** One end of a link: a row of a record. */
export interface RecordPort {
    node: string;
    row: string;
}

/** A flow from a row (right side) into a row (left side). */
export interface RecordLink {
    id?: string;
    from: RecordPort;
    to: RecordPort;
}

export interface RecordGraphData {
    nodes: RecordNode[];
    links: RecordLink[];
    groups?: RecordGroup[];
}
