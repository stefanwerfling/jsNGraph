import { ModelModuleData, ModuleKind } from './ModelTypes';

/**
 * Runtime module: the data a caller provided plus the geometry the flow
 * layout computes (center position + box size + rank/lane). x/y are the
 * CENTER of the block, in world coordinates.
 */
export class ModelNode {

    public readonly id: string;
    public label: string;
    public kind: ModuleKind;
    public sublabel: string | null;
    public repeat: number;
    public detail: Record<string, string | number> | null;
    public accent: string | null;
    /** Granularity level this module appears at (0 = coarsest). */
    public readonly level: number;
    /** Id of the containing coarser module, or null for a top-level module. */
    public readonly parent: string | null;

    public x: number;
    public y: number;
    public w: number;
    public h: number;

    /** Depth in the flow (longest path from a source). Set by the layout. */
    public rank = 0;
    /** Order within the rank, left to right. Set by the layout. */
    public lane = 0;
    /** True when x/y came from the caller and must not be moved by the layout. */
    public readonly pinned: boolean;

    public constructor(data: ModelModuleData) {
        this.id = data.id;
        this.label = data.label;
        this.kind = data.kind ?? 'generic';
        this.sublabel = data.sublabel ?? null;
        this.repeat = data.repeat !== undefined && data.repeat > 1 ? Math.floor(data.repeat) : 1;
        this.detail = data.detail ?? null;
        this.accent = data.accent ?? null;
        this.level = data.level ?? 0;
        this.parent = data.parent ?? null;
        this.pinned = data.x !== undefined && data.y !== undefined;
        this.x = data.x ?? 0;
        this.y = data.y ?? 0;

        const size = ModelNode.measure(this.label, this.sublabel);

        this.w = size.w;
        this.h = size.h;
    }

    /**
     * Block size derived from the longest text line — mirrors the approach
     * CanvasRenderer uses for cards so blocks hug their label without a
     * measuring pass against the (not-yet-available) 2d context.
     */
    public static measure(label: string, sublabel: string | null): {w: number; h: number} {
        const labelW = 7.4 * label.length;
        const subW = sublabel !== null ? 6 * sublabel.length : 0;
        const w = Math.max(150, Math.min(300, 44 + Math.max(labelW, subW)));
        const h = sublabel !== null ? 60 : 48;

        return {w: w, h: h};
    }

}
