import { GraphNode } from '../model/GraphNode';
import { ThemeTokens } from '../render/Theme';

/**
 * DOM-overlay detail panel shown on node click: name, IP, status badge and a
 * load bar. Deliberately plain DOM/CSS (not canvas-drawn) — crisper text,
 * no extra chart dependency needed for a single bar.
 */
export class NodePanel {

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

    public show(node: GraphNode, x: number, y: number): void {
        const t = this.theme;
        const containerRect = this.container.getBoundingClientRect();
        const left = x - containerRect.left + 16;
        const top = y - containerRect.top - 10;

        this.el.style.cssText = `
            position: absolute;
            left: ${left}px;
            top: ${top}px;
            min-width: 200px;
            padding: 12px 14px;
            border-radius: 10px;
            background: ${t.panelBackground};
            border: 1px solid ${t.panelBorder};
            color: ${t.panelText};
            font: 13px system-ui, sans-serif;
            box-shadow: 0 8px 24px rgba(0,0,0,0.35);
            z-index: 20;
        `;

        const statusColor = NodePanel.statusColor(node.status, t);

        this.el.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                <strong style="font-size:14px;">${NodePanel.escape(node.label)}</strong>
                <button type="button" data-close style="
                    background:none; border:none; cursor:pointer; color:${t.panelSubtext};
                    font-size:14px; line-height:1; padding:2px;
                ">✕</button>
            </div>
            <div style="color:${t.panelSubtext}; margin-bottom:8px;">
                ${node.ip !== null ? NodePanel.escape(node.ip) : 'no IP'}
                &nbsp;·&nbsp;
                <span style="color:${statusColor};">${node.status}</span>
            </div>
            <div style="font-size:11px; color:${t.panelSubtext}; margin-bottom:4px;">load</div>
            <div style="background:${t.panelBorder}; border-radius:4px; height:8px; overflow:hidden;">
                <div style="
                    width:${Math.round(node.load * 100)}%; height:100%;
                    background:${t.panelBar}; transition: width 0.3s ease;
                "></div>
            </div>
            <div style="text-align:right; font-size:11px; color:${t.panelSubtext}; margin-top:2px;">
                ${Math.round(node.load * 100)}%
            </div>
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

    private static statusColor(status: GraphNode['status'], t: ThemeTokens): string {
        switch (status) {
            case 'warning':
                return t.statusWarning;
            case 'critical':
                return t.statusCritical;
            case 'down':
                return t.statusDown;
            default:
                return t.statusOk;
        }
    }

    private static escape(value: string): string {
        const div = document.createElement('div');
        div.textContent = value;
        return div.innerHTML;
    }

}
