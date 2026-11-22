import { GraphEdge } from '../model/GraphEdge';
import { GraphNode } from '../model/GraphNode';
import { EdgeKindStyle, EdgeStyle, NodeKind, NodeRing, NodeShape, NodeStyle } from '../model/NGraphTypes';
import { Color } from '../util/Color';
import { Theme, ThemeTokens } from './Theme';

export interface ResolvedNodeStyle {
    shape: NodeShape;
    /** Disc fill (dot) or body fill (circle/card). */
    fill: string;
    /** Outline color. */
    stroke: string;
    radius: number;
    icon: NodeKind | null;
    label: string;
    labelColor: string;
    /** Pill behind the label, or null for plain text. */
    labelBackground: string | null;
    image: string | null;
    badge: string | null;
    badgeColor: string;
    opacity: number;
    ring: Required<NodeRing> | null;
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
}

export type NodeStyler = (node: GraphNode) => NodeStyle | null | undefined;
export type EdgeStyler = (edge: GraphEdge) => EdgeStyle | null | undefined;

const DEFAULT_DASH = [6, 4];

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

    public constructor(
        private theme: ThemeTokens,
        private edgeKinds: Readonly<Record<string, EdgeKindStyle>> = {},
        private nodeStyler: NodeStyler | null = null,
        private edgeStyler: EdgeStyler | null = null,
        private labelStyle: LabelStyle = 'plain'
    ) {
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
        this.edgeKinds = kinds;
    }

    public node(node: GraphNode): ResolvedNodeStyle {
        const theme = this.theme;
        const accent = node.color ?? (node.group !== null
            ? Color.fromPalette(node.group, theme.palette ?? Theme.palette)
            : null);
        const labelBackground = this.labelStyle === 'pill' ? Color.withAlpha(theme.background, 0.72) : null;
        const badgeColor = node.badgeColor ?? theme.statusOk;
        const base: ResolvedNodeStyle = node.shape === 'dot'
            ? {
                shape: 'dot',
                fill: accent ?? theme.nodeIcon,
                stroke: theme.background,
                radius: node.radius,
                icon: null,
                label: node.label,
                labelColor: theme.nodeLabel,
                labelBackground: labelBackground,
                image: null,
                badge: node.badge,
                badgeColor: badgeColor,
                opacity: 1,
                ring: null
            }
            : {
                shape: node.shape,
                fill: theme.nodeFill,
                stroke: accent ?? theme.nodeStroke,
                radius: node.radius,
                icon: node.kind,
                label: node.label,
                labelColor: theme.nodeLabel,
                labelBackground: labelBackground,
                image: node.image,
                badge: node.badge,
                badgeColor: badgeColor,
                opacity: 1,
                ring: null
            };
        const override = this.nodeStyler?.(node);

        if (override === null || override === undefined) {
            return base;
        }

        const shape = override.shape ?? base.shape;
        const color = override.color;

        return {
            shape: shape,
            fill: color !== undefined && shape === 'dot' ? color : base.fill,
            stroke: color !== undefined && shape !== 'dot' ? color : base.stroke,
            radius: override.radius ?? base.radius,
            icon: override.icon !== undefined ? override.icon : shape === 'dot' ? null : base.icon,
            label: override.label ?? base.label,
            labelColor: override.labelColor ?? base.labelColor,
            labelBackground: override.labelBackground !== undefined ? override.labelBackground : base.labelBackground,
            image: override.image !== undefined ? override.image : shape === 'dot' ? null : base.image,
            badge: override.badge !== undefined ? GraphNode.badgeText(override.badge) : base.badge,
            badgeColor: override.badgeColor ?? base.badgeColor,
            opacity: StyleResolver.unit(override.opacity ?? base.opacity),
            ring: override.ring === undefined || override.ring === null
                ? base.ring
                : {color: override.ring.color, width: override.ring.width ?? 2, opacity: StyleResolver.unit(override.ring.opacity ?? 1)}
        };
    }

    public edge(edge: GraphEdge): ResolvedEdgeStyle {
        const theme = this.theme;
        const kind: EdgeKindStyle = edge.kind !== null ? this.edgeKinds[edge.kind] ?? {} : {};
        const tone = kind.tone ?? 'load';
        const color = edge.color ?? kind.color ?? (tone === 'neutral'
            ? theme.edgeNeutral ?? theme.nodeStroke
            : StyleResolver.loadColor(edge.load, theme));
        const base: ResolvedEdgeStyle = {
            color: color,
            width: edge.width ?? kind.width ?? (tone === 'load' ? 1.5 + edge.load * 2.5 : 1.3),
            dash: StyleResolver.dash(edge.dashed ?? kind.dashed ?? null),
            directed: edge.directed ?? kind.directed ?? false,
            label: edge.label,
            opacity: 0.85,
            animated: edge.animatedExplicit ? edge.animated : kind.animated ?? edge.animated
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
            animated: base.animated
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

        return dashed === true ? DEFAULT_DASH : dashed;
    }

    private static unit(v: number): number {
        return Math.min(1, Math.max(0, v));
    }

}
