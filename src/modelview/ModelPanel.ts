import { ModelNode } from './ModelNode';
import { ThemeTokens } from '../render/Theme';

/**
 * DOM-overlay detail panel shown on module click: label, class sublabel, a
 * kind badge in the module's accent color, an optional repeat count, and the
 * caller-supplied detail rows (shape, dtype, params, …). Plain DOM/CSS, same
 * approach as NGraph's NodePanel — crisp text, no dependency.
 */
export class ModelPanel {

    private readonly el: HTMLDivElement;
    private theme: ThemeTokens;
    private onCloseCb: (() => void) | null = null;

    public constructor(private readonly container: HTMLElement, theme: ThemeTokens) {
        this.theme = theme;
        this.el = document.createElement('div');
        this.el.style.display = 'none';
        container.appendChild(this.el);
    }

    public onClose(cb: () => void): void {
        this.onCloseCb = cb;
    }

    public setTheme(theme: ThemeTokens): void {
        this.theme = theme;
    }

    public show(node: ModelNode, accent: string, clientX: number, clientY: number): void {
        const t = this.theme;
        const containerRect = this.container.getBoundingClientRect();
        const left = clientX - containerRect.left + 16;
        const top = clientY - containerRect.top - 10;

        this.el.style.cssText = `
            position: absolute;
            left: ${left}px;
            top: ${top}px;
            min-width: 210px;
            max-width: 320px;
            padding: 12px 14px;
            border-radius: 10px;
            background: ${t.panelBackground};
            border: 1px solid ${t.panelBorder};
            color: ${t.panelText};
            font: 13px system-ui, sans-serif;
            box-shadow: 0 8px 24px rgba(0,0,0,0.35);
            z-index: 20;
        `;

        this.el.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; gap:12px;">
                <strong style="font-size:14px;">${ModelPanel.escape(node.label)}</strong>
                <button type="button" data-close style="
                    background:none; border:none; cursor:pointer; color:${t.panelSubtext};
                    font-size:14px; line-height:1; padding:2px;
                ">✕</button>
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:${node.detail !== null ? '10px' : '2px'};">
                <span style="
                    display:inline-flex; align-items:center; gap:6px;
                    border-radius:999px; padding:2px 10px; font-size:11px;
                    color:#fff; background:${accent};
                ">${ModelPanel.escape(node.kind)}</span>
                ${node.repeat > 1 ? `<span style="font-size:11px; color:${t.panelSubtext};">×${node.repeat}</span>` : ''}
                ${node.sublabel !== null ? `<span style="font-size:11px; color:${t.panelSubtext};">${ModelPanel.escape(node.sublabel)}</span>` : ''}
            </div>
            ${ModelPanel.rows(node, t)}
        `;

        this.el.querySelector('[data-close]')?.addEventListener('click', () => this.hide());
        this.el.style.display = 'block';
    }

    public hide(): void {
        if (this.el.style.display === 'none') {
            return;
        }

        this.el.style.display = 'none';
        this.onCloseCb?.();
    }

    public destroy(): void {
        this.el.remove();
    }

    private static rows(node: ModelNode, t: ThemeTokens): string {
        if (node.detail === null) {
            return '';
        }

        const rows = Object.entries(node.detail).map(([key, value]) => `
            <div style="display:flex; justify-content:space-between; gap:16px; padding:3px 0;
                border-bottom:1px solid ${t.panelBorder}; font-size:12px;">
                <span style="color:${t.panelSubtext};">${ModelPanel.escape(key)}</span>
                <span style="text-align:right;">${ModelPanel.escape(String(value))}</span>
            </div>
        `).join('');

        return `<div style="margin-top:2px;">${rows}</div>`;
    }

    private static escape(value: string): string {
        const div = document.createElement('div');
        div.textContent = value;
        return div.innerHTML;
    }

}
