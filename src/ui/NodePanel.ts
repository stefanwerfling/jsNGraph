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
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; gap:12px;">
                <strong style="font-size:14px;">${NodePanel.escape(node.label)}</strong>
                <button type="button" data-close style="
                    background:none; border:none; cursor:pointer; color:${t.panelSubtext};
                    font-size:14px; line-height:1; padding:2px;
                ">✕</button>
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                <span style="
                    display:inline-flex; align-items:center; gap:6px;
                    border:1px solid ${t.panelBorder}; border-radius:999px; padding:2px 10px;
                    font-size:11px; color:${statusColor};
                "><span style="width:6px;height:6px;border-radius:50%;background:${statusColor};"></span>${node.status}</span>
                <span style="font-size:11px; color:${t.panelSubtext};">${NodePanel.escape(node.kind)}</span>
            </div>
            ${node.sublabel !== null ? `
                <div style="font-size:12px; color:${t.panelSubtext}; margin-bottom:8px;">${NodePanel.escape(node.sublabel)}</div>
            ` : ''}
            ${NodePanel.rows(node, t)}
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

    /**
     * The body rows: generic meta key/values when provided (agents, services,
     * anything non-device); otherwise the classic device block — an IP row
     * only when an IP exists, plus the load bar.
     */
    private static rows(node: GraphNode, t: ThemeTokens): string {
        if (node.meta !== null) {
            const rows = Object.entries(node.meta).map(([key, value]) => `
                <div style="display:flex; justify-content:space-between; gap:16px; padding:3px 0;
                    border-bottom:1px solid ${t.panelBorder}; font-size:12px;">
                    <span style="color:${t.panelSubtext};">${NodePanel.escape(key)}</span>
                    <span style="text-align:right;">${NodePanel.escape(value)}</span>
                </div>
            `).join('');

            return `<div style="margin-top:2px;">${rows}</div>`;
        }

        return `
            ${node.ip !== null ? `
                <div style="display:flex; justify-content:space-between; gap:16px; padding:3px 0; font-size:12px;">
                    <span style="color:${t.panelSubtext};">IP</span><span>${NodePanel.escape(node.ip)}</span>
                </div>
            ` : ''}
            <div style="font-size:11px; color:${t.panelSubtext}; margin:6px 0 4px;">load</div>
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
