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
}

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
}
