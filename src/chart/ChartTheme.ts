/** Colours of the chart part (any CSS colours). */
export interface ChartThemeTokens {
    background: string;
    /** Alternate band behind every other x tick interval; '' for none. */
    band: string;
    grid: string;
    axis: string;
    text: string;
    title: string;
    /** Default trace colour. */
    line: string;
    hover: string;
    select: string;
    /** Draggable marker and the slice it cuts through a waterfall. */
    marker: string;
    /** Pill backgrounds (marker label, legend). */
    pill: string;
    pillBorder: string;
}

/** Built-in chart palettes. */
export class ChartTheme {

    public static readonly dark: Readonly<ChartThemeTokens> = Object.freeze({
        background: '#121726',
        band: 'rgba(255,255,255,0.025)',
        grid: 'rgba(255,255,255,0.07)',
        axis: 'rgba(255,255,255,0.22)',
        text: '#9aa6bd',
        title: '#c8d1e2',
        line: '#64bae4',
        hover: '#ffbe93',
        select: '#ffffff',
        marker: '#ff8a42',
        pill: 'rgba(100,186,228,0.16)',
        pillBorder: '#64bae4'
    });

    public static readonly light: Readonly<ChartThemeTokens> = Object.freeze({
        background: '#ffffff',
        band: 'rgba(20,40,80,0.03)',
        grid: 'rgba(20,40,80,0.08)',
        axis: 'rgba(20,40,80,0.3)',
        text: '#5b6678',
        title: '#273142',
        line: '#2f8fc4',
        hover: '#e8743b',
        select: '#111827',
        marker: '#e8590c',
        pill: 'rgba(47,143,196,0.1)',
        pillBorder: '#2f8fc4'
    });

    public static resolve(theme: 'dark' | 'light' | Partial<ChartThemeTokens> | undefined): Readonly<ChartThemeTokens> {
        if (theme === undefined || theme === 'dark') {
            return ChartTheme.dark;
        }
        if (theme === 'light') {
            return ChartTheme.light;
        }

        return {...ChartTheme.dark, ...theme};
    }

}
