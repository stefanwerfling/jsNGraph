import { IsoAnchor, IsoConnector, IsoDocument, IsoItem, IsoRegion, IsoText, IsoTile } from './IsoTypes';

/** A copied part of a document (clipboard, duplicate). */
export interface IsoFragment {
    items: IsoItem[];
    connectors: IsoConnector[];
    regions: IsoRegion[];
    texts: IsoText[];
}

/** What kind of element an id names. */
export type IsoKind = 'item' | 'connector' | 'region' | 'text';

/**
 * Pure document operations of the isometric editor: occupancy, moving with
 * collision checks, free tiles, removing with dependent connectors, copy and
 * paste with fresh ids. Functions mutate the document they are given (the
 * editor works on its own copy) and never touch the DOM.
 */
export class IsoModel {

    /** The same document with every list present (a deep copy). */
    public static normalize(doc: IsoDocument): Required<IsoDocument> {
        const d = JSON.parse(JSON.stringify(doc)) as IsoDocument;

        return {items: d.items ?? [], connectors: d.connectors ?? [], regions: d.regions ?? [], texts: d.texts ?? []};
    }

    public static key(t: IsoTile): string {
        return `${t.x},${t.y}`;
    }

    public static kindOf(doc: Required<IsoDocument>, id: string): IsoKind | null {
        if (doc.items.some((i) => i.id === id)) {
            return 'item';
        }
        if (doc.connectors.some((c) => c.id === id)) {
            return 'connector';
        }
        if (doc.regions.some((r) => r.id === id)) {
            return 'region';
        }

        return doc.texts.some((t) => t.id === id) ? 'text' : null;
    }

    /** Tile → item id, leaving out `except`. */
    public static occupied(doc: Required<IsoDocument>, except: ReadonlySet<string> = new Set()): Map<string, string> {
        const out = new Map<string, string>();

        for (const it of doc.items) {
            if (!except.has(it.id)) {
                out.set(IsoModel.key(it.tile), it.id);
            }
        }

        return out;
    }

    /** The free tile nearest to `tile` (rings of growing Chebyshev distance, nearest by Manhattan distance first). */
    public static freeTileNear(doc: Required<IsoDocument>, tile: IsoTile, except: ReadonlySet<string> = new Set()): IsoTile {
        const occ = IsoModel.occupied(doc, except);

        for (let r = 0; r < 200; r++) {
            const ring: IsoTile[] = [];
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) === r) {
                        ring.push({x: tile.x + dx, y: tile.y + dy});
                    }
                }
            }
            ring.sort((a, b) => Math.abs(a.x - tile.x) + Math.abs(a.y - tile.y) - (Math.abs(b.x - tile.x) + Math.abs(b.y - tile.y))
                || a.y - b.y || a.x - b.x);
            const free = ring.find((t) => !occ.has(IsoModel.key(t)));
            if (free !== undefined) {
                return free;
            }
        }

        return {...tile};
    }

    /** Whether the items among `ids` can all move by (dx, dy) without landing on an item that stays. */
    public static canMove(doc: Required<IsoDocument>, ids: ReadonlySet<string>, dx: number, dy: number): boolean {
        const occ = IsoModel.occupied(doc, ids);

        return doc.items.every((it) => !ids.has(it.id) || !occ.has(IsoModel.key({x: it.tile.x + dx, y: it.tile.y + dy})));
    }

    /**
     * Move everything named in `ids` by (dx, dy) tiles: items, regions, texts,
     * and connectors' waypoints and tile ends when the connector itself is
     * named or both of its ends move along.
     */
    public static move(doc: Required<IsoDocument>, ids: ReadonlySet<string>, dx: number, dy: number): void {
        const shift = (t: IsoTile): void => {
            t.x += dx;
            t.y += dy;
        };
        const moves = (a: IsoAnchor): boolean => 'item' in a ? ids.has(a.item) : false;

        for (const it of doc.items) {
            if (ids.has(it.id)) {
                shift(it.tile);
            }
        }
        for (const r of doc.regions) {
            if (ids.has(r.id)) {
                shift(r.from);
                shift(r.to);
            }
        }
        for (const t of doc.texts) {
            if (ids.has(t.id)) {
                shift(t.tile);
            }
        }
        for (const c of doc.connectors) {
            const along = ids.has(c.id) || (moves(c.from) && moves(c.to));
            if (!along) {
                continue;
            }
            for (const v of c.via ?? []) {
                shift(v);
            }
            for (const a of [c.from, c.to]) {
                if ('tile' in a) {
                    shift(a.tile);
                }
            }
        }
    }

    /** Remove `ids` and every connector attached to a removed item; returns all removed ids. */
    public static remove(doc: Required<IsoDocument>, ids: ReadonlySet<string>): string[] {
        const removed: string[] = [];
        const gone = (a: IsoAnchor): boolean => 'item' in a && ids.has(a.item);
        const keep = <T extends {id: string}>(list: T[], drop: (x: T) => boolean): T[] => list.filter((x) => {
            if (drop(x)) {
                removed.push(x.id);
                return false;
            }
            return true;
        });

        doc.items = keep(doc.items, (i) => ids.has(i.id));
        doc.connectors = keep(doc.connectors, (c) => ids.has(c.id) || gone(c.from) || gone(c.to));
        doc.regions = keep(doc.regions, (r) => ids.has(r.id));
        doc.texts = keep(doc.texts, (t) => ids.has(t.id));

        return removed;
    }

    /** A copy of `ids` plus the connectors running between copied items (and named connectors whose item ends are copied). */
    public static fragment(doc: Required<IsoDocument>, ids: ReadonlySet<string>): IsoFragment {
        const items = doc.items.filter((i) => ids.has(i.id));
        const itemIds = new Set(items.map((i) => i.id));
        const inside = (a: IsoAnchor): boolean => 'tile' in a || itemIds.has(a.item);
        const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

        return {
            items: clone(items),
            connectors: clone(doc.connectors.filter((c) => inside(c.from) && inside(c.to)
                && (ids.has(c.id) || ('item' in c.from && 'item' in c.to)))),
            regions: clone(doc.regions.filter((r) => ids.has(r.id))),
            texts: clone(doc.texts.filter((t) => ids.has(t.id)))
        };
    }

    /** Top-left tile of a fragment (smallest x and y of everything in it). */
    public static origin(f: IsoFragment): IsoTile | null {
        const tiles: IsoTile[] = [
            ...f.items.map((i) => i.tile), ...f.regions.flatMap((r) => [r.from, r.to]), ...f.texts.map((t) => t.tile),
            ...f.connectors.flatMap((c) => [...(c.via ?? []), ...[c.from, c.to].filter((a): a is {tile: IsoTile} => 'tile' in a).map((a) => a.tile)])
        ];

        return tiles.length === 0 ? null : {x: Math.min(...tiles.map((t) => t.x)), y: Math.min(...tiles.map((t) => t.y))};
    }

    /**
     * Insert a fragment with its origin at `at` and fresh ids; items that would
     * land on an occupied tile take the nearest free one. Returns the new ids.
     */
    public static paste(doc: Required<IsoDocument>, f: IsoFragment, at: IsoTile): string[] {
        const o = IsoModel.origin(f) ?? at;
        const dx = at.x - o.x, dy = at.y - o.y;
        const map = new Map<string, string>();
        const fresh = (id: string, prefix: string): string => {
            const n = IsoModel.uid(doc, prefix, map);
            map.set(id, n);
            return n;
        };
        const added: string[] = [];
        const s = (t: IsoTile): IsoTile => ({x: t.x + dx, y: t.y + dy});

        for (const it of f.items) {
            const copy: IsoItem = JSON.parse(JSON.stringify(it)) as IsoItem;
            copy.id = fresh(it.id, 'item');
            copy.tile = IsoModel.freeTileNear(doc, s(it.tile));
            doc.items.push(copy);
            added.push(copy.id);
        }
        for (const r of f.regions) {
            const copy: IsoRegion = {...JSON.parse(JSON.stringify(r)) as IsoRegion, id: fresh(r.id, 'region'), from: s(r.from), to: s(r.to)};
            doc.regions.push(copy);
            added.push(copy.id);
        }
        for (const t of f.texts) {
            const copy: IsoText = {...JSON.parse(JSON.stringify(t)) as IsoText, id: fresh(t.id, 'text'), tile: s(t.tile)};
            doc.texts.push(copy);
            added.push(copy.id);
        }
        const anchor = (a: IsoAnchor): IsoAnchor | null => {
            if ('tile' in a) {
                return {tile: s(a.tile)};
            }
            const id = map.get(a.item);
            return id === undefined ? null : {item: id};
        };
        for (const c of f.connectors) {
            const from = anchor(c.from), to = anchor(c.to);
            if (from === null || to === null) {
                continue;
            }
            const copy: IsoConnector = {...JSON.parse(JSON.stringify(c)) as IsoConnector, id: fresh(c.id, 'link'), from, to};
            if (c.via !== undefined) {
                copy.via = c.via.map(s);
            }
            doc.connectors.push(copy);
            added.push(copy.id);
        }

        return added;
    }

    /** An id not used in the document (nor in `taken`). */
    public static uid(doc: Required<IsoDocument>, prefix: string, taken: ReadonlyMap<string, string> = new Map()): string {
        const used = new Set<string>([
            ...doc.items.map((i) => i.id), ...doc.connectors.map((c) => c.id), ...doc.regions.map((r) => r.id),
            ...doc.texts.map((t) => t.id), ...taken.values()
        ]);
        let n = 1;

        while (used.has(`${prefix}-${n}`)) {
            n++;
        }

        return `${prefix}-${n}`;
    }

    /** Resize a region by dragging one corner (0 = from, 1 = (to.x, from.y), 2 = to, 3 = (from.x, to.y)) to `tile`. */
    public static resizeRegion(r: IsoRegion, corner: number, tile: IsoTile): void {
        const x0 = Math.min(r.from.x, r.to.x), x1 = Math.max(r.from.x, r.to.x);
        const y0 = Math.min(r.from.y, r.to.y), y1 = Math.max(r.from.y, r.to.y);
        // the opposite corner stays
        const fixed = [{x: x1, y: y1}, {x: x0, y: y1}, {x: x0, y: y0}, {x: x1, y: y0}][corner] ?? {x: x0, y: y0};

        r.from = {x: Math.min(fixed.x, tile.x), y: Math.min(fixed.y, tile.y)};
        r.to = {x: Math.max(fixed.x, tile.x), y: Math.max(fixed.y, tile.y)};
    }

}
