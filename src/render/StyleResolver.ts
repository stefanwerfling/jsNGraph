import { GraphEdge } from '../model/GraphEdge';
import { GraphNode } from '../model/GraphNode';
import { EdgeKindStyle, EdgeStyle, LabelPosition, NodeBadge, NodeIconDrawer, NodeKind, NodeRing, NodeShape, NodeStyle } from '../model/NGraphTypes';
import { Color } from '../util/Color';
import { Theme, ThemeTokens } from './Theme';

export interface ResolvedNodeStyle {
    shape: NodeShape;
    /** Disc fill (dot) or body fill (circle/card). */
    fill: string;
    /** Outline color. */
    stroke: string;
    radius: number;
    icon: NodeKind | NodeIconDrawer | null;
    iconColor: string;
    label: string;
    labelColor: string;
    /** Label font size, world px. */
    labelSize: number;
    /** Pill behind the label, or null for plain text. */
    labelBackground: string | null;
    image: string | null;
    badge: string | null;
    badgeColor: string;
    badges: ReadonlyArray<NodeBadge>;
    opacity: number;
    ring: Required<NodeRing> | null;
    /** Halo width in world px (0 = none). */
    glow: number;
    labelPosition: LabelPosition;
}

/** 'plain' text labels (default) or 'pill': a rounded backdrop behind each label. */
export type LabelStyle = 'plain' | 'pill';

export interface ResolvedEdgeStyle {
    color: string;
    width: number;
    dash: number[] | null;
    directed: boolean;
    label: string | null;
    opacity: number;
    animated: boolean;
    /** Halo width in world px (0 = none). */
    glow: number;
}

/** Edge colour source: 'load' (traffic colours, default) or the accent of the source / target node. */
export type EdgeColorMode = 'load' | 'source' | 'target';

/** Defaults the whole graph shares (NGraph options); per-node/edge styles win. */
export interface StyleDefaults {
    nodeGlow: number;
    edgeGlow: number;
    labelPosition: LabelPosition;
    edgeColor: EdgeColorMode;
}

export type NodeStyler = (node: GraphNode) => NodeStyle | null | undefined;
export type EdgeStyler = (edge: GraphEdge) => EdgeStyle | null | undefined;

/**
 * Built-in edge-kind presets. `knowledge` covers a notes/wiki graph:
 * plain wikilinks, typed (directed) relations, tag and semantic-similarity
 * edges — all in the theme's neutral tone instead of the load colors.
 */
export class EdgeKindPresets {

    public static readonly knowledge: Readonly<Record<string, EdgeKindStyle>> = {
        wikilink: {tone: 'neutral', animated: false},
        typed: {tone: 'neutral', directed: true, animated: false},
        supersedes: {tone: 'neutral', directed: true, dashed: [6, 4], animated: false},
        tag: {tone: 'neutral', dashed: [2, 4], width: 1, animated: false},
        semantic: {tone: 'neutral', dashed: [6, 4], width: 1, animated: false}
    };

}

/**
 * Turns runtime node/edge state into concrete draw parameters. Precedence,
 * lowest first: built-in defaults → node/edge data (color, size, group,
 * kind preset) → the consumer's `styleNode`/`styleEdge` callback.
 *
 * Device kinds are just one preset of this layer: a node with no style
 * fields renders exactly as before (device circle, load-colored edges).
 */
export class StyleResolver {

    private static readonly DEFAULT_DASH = [6, 4];

    public constructor(
        private theme: ThemeTokens,
        private edgeKinds: Readonly<Record<string, EdgeKindStyle>> = {},
        private nodeStyler: NodeStyler | null = null,
        private edgeStyler: EdgeStyler | null = null,
        private labelStyle: LabelStyle = 'plain',
        private defaults: StyleDefaults = {nodeGlow: 0, edgeGlow: 0, labelPosition: 'below', edgeColor: 'load'}
    ) {
        this.edgeKinds = StyleResolver.copyKinds(edgeKinds);
    }

    public setDefaults(defaults: Partial<StyleDefaults>): void {
        this.defaults = {...this.defaults, ...defaults};
    }

    public get styleDefaults(): Readonly<StyleDefaults> {
        return this.defaults;
    }

    /** A node's own accent (colour, else its group's palette colour, else its fill), or null. */
    public accent(node: GraphNode): string | null {
        return node.color ?? (node.group !== null
            ? Color.fromPalette(node.group, this.theme.palette ?? Theme.palette)
            : node.fill);
    }

    public setLabelStyle(labelStyle: LabelStyle): void {
        this.labelStyle = labelStyle;
    }

    public setTheme(theme: ThemeTokens): void {
        this.theme = theme;
    }

    public setStylers(nodeStyler: NodeStyler | null, edgeStyler: EdgeStyler | null): void {
        this.nodeStyler = nodeStyler;
        this.edgeStyler = edgeStyler;
    }

    public get stylers(): {node: NodeStyler | null; edge: EdgeStyler | null} {
        return {node: this.nodeStyler, edge: this.edgeStyler};
    }

    public setEdgeKinds(kinds: Readonly<Record<string, EdgeKindStyle>>): void {
        this.edgeKinds = StyleResolver.copyKinds(kinds);
    }

    /** Stored kind tables are copied, so a caller mutating its object later does not restyle behind our back. */
    private static copyKinds(kinds: Readonly<Record<string, EdgeKindStyle>>): Record<string, EdgeKindStyle> {
        const copy: Record<string, EdgeKindStyle> = {};
        for (const [name, style] of Object.entries(kinds)) {
            copy[name] = {...style};
        }

        return copy;
    }

    public node(node: GraphNode): ResolvedNodeStyle {
        const theme = this.theme;
        const accent = node.color ?? (node.group !== null
            ? Color.fromPalette(node.group, theme.palette ?? Theme.palette)
            : null);
        const labelBackground = this.labelStyle === 'pill' ? Color.withAlpha(theme.background, 0.72) : null;
        const badgeColor = node.badgeColor ?? theme.statusOk;
        const badges: ReadonlyArray<NodeBadge> = node.badges ?? [];
        const iconColor = node.iconColor ?? theme.nodeIcon;
        // Big nodes get a bigger label: 11 px up to the default radius, then +0.15 px per px, max 16.
        const labelSize = Math.min(16, 11 + Math.max(0, node.radius - 22) * 0.15);
        const base: ResolvedNodeStyle = node.shape === 'dot'
            ? {
                shape: 'dot',
                fill: accent ?? theme.nodeIcon,
                stroke: theme.background,
                radius: node.radius,
                icon: null,
                iconColor: iconColor,
                label: node.label,
                labelColor: theme.nodeLabel,
                labelSize: labelSize,
                labelBackground: labelBackground,
                image: null,
                badge: node.badge,
                badgeColor: badgeColor,
                badges: badges,
                opacity: 1,
                ring: null,
                glow: this.defaults.nodeGlow,
                labelPosition: this.defaults.labelPosition
            }
            : {
                shape: node.shape,
                fill: node.fill ?? theme.nodeFill,
                stroke: accent ?? node.fill ?? theme.nodeStroke,
                radius: node.radius,
                icon: node.kind,
                iconColor: iconColor,
                label: node.label,
                labelColor: theme.nodeLabel,
                labelSize: labelSize,
                labelBackground: labelBackground,
                image: node.image,
                badge: node.badge,
                badgeColor: badgeColor,
                badges: badges,
                opacity: 1,
                ring: null,
                glow: this.defaults.nodeGlow,
                labelPosition: this.defaults.labelPosition
            };
        const override = this.nodeStyler?.(node);

        if (override === null || override === undefined) {
            return base;
        }

        const shape = override.shape ?? base.shape;
        const color = override.color;

        return {
            shape: shape,
            fill: color !== undefined && shape === 'dot' ? color : override.fill ?? base.fill,
            stroke: color !== undefined && shape !== 'dot' ? color : base.stroke,
            radius: override.radius ?? base.radius,
            icon: override.icon !== undefined ? override.icon : shape === 'dot' ? null : base.icon,
            iconColor: override.iconColor ?? base.iconColor,
            label: override.label ?? base.label,
            labelColor: override.labelColor ?? base.labelColor,
            labelSize: override.labelSize ?? base.labelSize,
            labelBackground: override.labelBackground !== undefined ? override.labelBackground : base.labelBackground,
            image: override.image !== undefined ? override.image : shape === 'dot' ? null : base.image,
            badge: override.badge !== undefined ? GraphNode.badgeText(override.badge) : base.badge,
            badgeColor: override.badgeColor ?? base.badgeColor,
            badges: override.badges === undefined ? base.badges : override.badges ?? [],
            opacity: StyleResolver.unit(override.opacity ?? base.opacity),
            ring: override.ring === undefined || override.ring === null
                ? base.ring
                : {
                    color: override.ring.color,
                    width: override.ring.width ?? 2,
                    opacity: StyleResolver.unit(override.ring.opacity ?? 1),
                    gap: override.ring.gap ?? 1
                },
            glow: Math.max(0, override.glow ?? base.glow),
            labelPosition: override.labelPosition ?? base.labelPosition
        };
    }

    public edge(edge: GraphEdge): ResolvedEdgeStyle {
        const theme = this.theme;
        const kind: EdgeKindStyle = edge.kind !== null ? this.edgeKinds[edge.kind] ?? {} : {};
        const tone = kind.tone ?? 'load';
        const endpoint = this.defaults.edgeColor === 'source'
            ? this.accent(edge.source)
            : this.defaults.edgeColor === 'target' ? this.accent(edge.target) : null;
        const color = edge.color ?? kind.color ?? endpoint ?? (tone === 'neutral'
            ? theme.edgeNeutral ?? theme.nodeStroke
            : StyleResolver.loadColor(edge.load, theme));
        const base: ResolvedEdgeStyle = {
            color: color,
            width: edge.width ?? kind.width ?? (tone === 'load' ? 1.5 + edge.load * 2.5 : 1.3),
            dash: StyleResolver.dash(edge.dashed ?? kind.dashed ?? null),
            directed: edge.directed ?? kind.directed ?? false,
            label: edge.label,
            opacity: 0.85,
            animated: edge.animatedExplicit ? edge.animated : kind.animated ?? edge.animated,
            glow: this.defaults.edgeGlow
        };
        const override = this.edgeStyler?.(edge);

        if (override === null || override === undefined) {
            return base;
        }

        return {
            color: override.color ?? base.color,
            width: override.width ?? base.width,
            dash: override.dash !== undefined ? override.dash : base.dash,
            directed: override.directed ?? base.directed,
            label: override.label !== undefined ? override.label : base.label,
            opacity: StyleResolver.unit(override.opacity ?? base.opacity),
            animated: base.animated,
            glow: Math.max(0, override.glow ?? base.glow)
        };
    }

    /** Green → yellow → red by load, the network-monitoring palette. */
    public static loadColor(load: number, theme: ThemeTokens): string {
        return load < 0.5
            ? Color.lerp(theme.edgeLow, theme.edgeMid, load / 0.5)
            : Color.lerp(theme.edgeMid, theme.edgeHigh, (load - 0.5) / 0.5);
    }

    private static dash(dashed: boolean | number[] | null): number[] | null {
        if (dashed === null || dashed === false) {
            return null;
        }

        return dashed === true ? StyleResolver.DEFAULT_DASH : dashed;
    }

    private static unit(v: number): number {
        return Math.min(1, Math.max(0, v));
    }

}
