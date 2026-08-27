import { ThemeTokens } from '../render/Theme';

/**
 * A small DOM-overlay tooltip shown while hovering a node.
 */
export class Tooltip {

    private readonly el: HTMLDivElement;

    public constructor(container: HTMLElement, theme: ThemeTokens) {
        this.el = document.createElement('div');
        this.el.style.cssText = Tooltip.style(theme);
        container.appendChild(this.el);
    }

    public setTheme(theme: ThemeTokens): void {
        const display = this.el.style.display;
        this.el.style.cssText = Tooltip.style(theme);
        this.el.style.display = display;
    }

    public show(text: string, x: number, y: number): void {
        this.el.textContent = text;
        this.el.style.left = `${x + 14}px`;
        this.el.style.top = `${y + 14}px`;
        this.el.style.display = 'block';
    }

    public hide(): void {
        this.el.style.display = 'none';
    }

    public destroy(): void {
        this.el.remove();
    }

    private static style(theme: ThemeTokens): string {
        return `
            position: absolute;
            display: none;
            pointer-events: none;
            padding: 4px 8px;
            border-radius: 6px;
            font: 12px system-ui, sans-serif;
            background: ${theme.panelBackground};
            color: ${theme.panelText};
            border: 1px solid ${theme.panelBorder};
            box-shadow: 0 4px 12px rgba(0,0,0,0.25);
            z-index: 10;
            white-space: nowrap;
        `;
    }

}
