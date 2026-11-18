export interface ThemeTokens {
    background: string;
    gridDot: string;
    nodeFill: string;
    nodeStroke: string;
    nodeIcon: string;
    nodeLabel: string;
    nodeHoverStroke: string;
    nodeSelectedStroke: string;
    /** Edge color at load 0 / 0.5 / 1 — interpolated between for intermediate loads. */
    edgeLow: string;
    edgeMid: string;
    edgeHigh: string;
    trafficDot: string;
    statusOk: string;
    statusWarning: string;
    statusCritical: string;
    statusDown: string;
    panelBackground: string;
    panelBorder: string;
    panelText: string;
    panelSubtext: string;
    panelBar: string;
    /** Color of edges whose kind uses tone 'neutral'. Default: nodeStroke. */
    edgeNeutral?: string;
    /** Edge label text. Default: nodeLabel. */
    edgeLabel?: string;
    /** Stroke of highlighted nodes (search hits, `highlight()`). Default: statusWarning. */
    highlightStroke?: string;
    /** Opacity of nodes/edges outside a highlight with dimOthers. Default 0.15. */
    dimOpacity?: number;
    /** Categorical colors for `node.group` (folders, communities). */
    palette?: string[];
}

/** Anything that can answer CSS custom-property lookups (a CSSStyleDeclaration does). */
export interface CssVarSource {
    getPropertyValue(name: string): string;
}

export interface CssVarThemeOptions {
    /** Start from these tokens; CSS variables override field by field. Default Theme.dark. */
    base?: ThemeTokens;
    /** Prefix of the default variable names: `${prefix}node-fill` etc. Default '--jsng-'. */
    prefix?: string;
    /** Extra variable names per token, tried in order after the prefixed default
     *  (map a host design system: `{background: ['--bg'], nodeLabel: ['--text-muted']}`). */
    map?: Partial<Record<keyof ThemeTokens, string | string[]>>;
}

const DEFAULT_PALETTE = [
    '#5b8def', '#e8a33d', '#4bb38a', '#d9617a', '#9a7be0',
    '#3fb5c9', '#c9a227', '#e07b4f', '#6f9d3a', '#b565b0'
];

const DARK: ThemeTokens = {
    background: '#0f1420',
    gridDot: '#1c2436',
    nodeFill: '#1a2236',
    nodeStroke: '#3a4a68',
    nodeIcon: '#c9d6ec',
    nodeLabel: '#aab6cc',
    nodeHoverStroke: '#7aa2ff',
    nodeSelectedStroke: '#9fc0ff',
    edgeLow: '#2ecc71',
    edgeMid: '#f1c40f',
    edgeHigh: '#e74c3c',
    trafficDot: '#eaf2ff',
    statusOk: '#2ecc71',
    statusWarning: '#f1c40f',
    statusCritical: '#e74c3c',
    statusDown: '#5b6478',
    panelBackground: '#161d2e',
    panelBorder: '#2c3750',
    panelText: '#e7edf8',
    panelSubtext: '#8b96ad',
    panelBar: '#4d7dff'
};

const LIGHT: ThemeTokens = {
    background: '#f4f6fb',
    gridDot: '#e2e7f2',
    nodeFill: '#ffffff',
    nodeStroke: '#c4cde0',
    nodeIcon: '#33405c',
    nodeLabel: '#4b5570',
    nodeHoverStroke: '#3a6df0',
    nodeSelectedStroke: '#1f4fd6',
    edgeLow: '#27ae60',
    edgeMid: '#e1ad01',
    edgeHigh: '#d63031',
    trafficDot: '#1f2937',
    statusOk: '#27ae60',
    statusWarning: '#e1ad01',
    statusCritical: '#d63031',
    statusDown: '#98a2b3',
    panelBackground: '#ffffff',
    panelBorder: '#d7deec',
    panelText: '#1f2937',
    panelSubtext: '#667085',
    panelBar: '#3a6df0'
};

/**
 * Built-in dark/light palettes. Pass a custom ThemeTokens object to NGraph
 * for full control instead.
 */
export class Theme {
    public static readonly dark: ThemeTokens = DARK;
    public static readonly light: ThemeTokens = LIGHT;
    public static readonly palette: ReadonlyArray<string> = DEFAULT_PALETTE;

    /**
     * Build tokens from CSS custom properties, so a graph follows the host's
     * design system and its light/dark switch. Each token reads
     * `--jsng-<kebab-name>` (e.g. `--jsng-node-fill`), then any names from
     * `options.map`; unset variables keep the base value. The palette reads
     * `--jsng-palette-1` … `--jsng-palette-12`.
     *
     * Call it again after the host switches theme and pass the result to
     * `NGraph.setTheme`.
     */
    public static fromCssVars(source: Element | CssVarSource, options: CssVarThemeOptions = {}): ThemeTokens {
        const style: CssVarSource = 'getPropertyValue' in source ? source : getComputedStyle(source);
        const prefix = options.prefix ?? '--jsng-';
        const base = options.base ?? DARK;
        const out: ThemeTokens = {...base};
        const read = (name: string): string | null => {
            const value = style.getPropertyValue(name).trim();

            return value.length > 0 ? value : null;
        };
        const keys = new Set<keyof ThemeTokens>([
            ...(Object.keys(DARK) as (keyof ThemeTokens)[]),
            'edgeNeutral', 'edgeLabel', 'highlightStroke', 'dimOpacity'
        ]);

        for (const key of keys) {
            const extra = options.map?.[key];
            const names = [prefix + Theme.kebab(key), ...(extra === undefined ? [] : Array.isArray(extra) ? extra : [extra])];
            let value: string | null = null;

            for (const name of names) {
                value = read(name);

                if (value !== null) {
                    break;
                }
            }

            if (value === null) {
                continue;
            }

            if (key === 'dimOpacity') {
                const n = parseFloat(value);

                if (!Number.isNaN(n)) {
                    out.dimOpacity = n;
                }

                continue;
            }

            (out as unknown as Record<string, string>)[key] = value;
        }

        const palette: string[] = [];

        for (let i = 1; i <= 12; i++) {
            const value = read(`${prefix}palette-${i}`);

            if (value !== null) {
                palette.push(value);
            }
        }

        if (palette.length > 0) {
            out.palette = palette;
        }

        return out;
    }

    private static kebab(key: string): string {
        return key.replace(/[A-Z]/g, (ch) => '-' + ch.toLowerCase());
    }
}
