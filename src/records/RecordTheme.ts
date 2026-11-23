export interface RecordThemeTokens {
    background: string;
    /** Group frame border and title bar. */
    frame: string;
    frameText: string;
    /** Group frame body (usually transparent-ish). */
    frameFill: string;
    card: string;
    cardBorder: string;
    text: string;
    muted: string;
    /** Value column. */
    value: string;
    link: string;
    linkHover: string;
    /** Hovered row. */
    rowHover: string;
    /** Highlighted flow (rows + links). */
    highlight: string;
    highlightText: string;
    /** Rows with a value ≤ 0. */
    alert: string;
    alertText: string;
    shadow: string;
    /** Default header accents, by record order. */
    palette: string[];
}

const PALETTE = ['#7d93c4', '#6e6aa6', '#7aa6a2', '#8fb08c', '#83b3d6', '#b48ead', '#c9a36a', '#6f9fb5'];

/** Built-in looks of the record graph (`'light'` mirrors a clean dashboard, `'dark'` its night mode). */
export class RecordTheme {

    public static readonly light: RecordThemeTokens = {
        background: '#f6f8fa',
        frame: '#232d3a',
        frameText: '#ffffff',
        frameFill: 'rgba(35,45,58,0.02)',
        card: '#ffffff',
        cardBorder: '#c8d2dc',
        text: '#1d2733',
        muted: '#5c6979',
        value: '#1d2733',
        link: '#b9cfda',
        linkHover: '#6f9bb3',
        rowHover: '#eef4f8',
        highlight: '#f2c200',
        highlightText: '#1d2733',
        alert: '#e8175d',
        alertText: '#ffffff',
        shadow: 'rgba(25,45,70,0.16)',
        palette: PALETTE
    };

    public static readonly dark: RecordThemeTokens = {
        background: '#151b23',
        frame: '#8193a8',
        frameText: '#11161d',
        frameFill: 'rgba(129,147,168,0.04)',
        card: '#1f2731',
        cardBorder: '#35414f',
        text: '#e2e8ef',
        muted: '#95a3b4',
        value: '#f1f4f8',
        link: '#3d5262',
        linkHover: '#7ea2ba',
        rowHover: '#28323e',
        highlight: '#f2c200',
        highlightText: '#151b23',
        alert: '#ff3b7a',
        alertText: '#ffffff',
        shadow: 'rgba(0,0,0,0.45)',
        palette: PALETTE
    };

    public static resolve(theme: 'light' | 'dark' | Partial<RecordThemeTokens> | undefined): RecordThemeTokens {
        if (theme === undefined || theme === 'light') {
            return RecordTheme.light;
        }
        if (theme === 'dark') {
            return RecordTheme.dark;
        }

        return {...RecordTheme.light, ...theme};
    }

}
