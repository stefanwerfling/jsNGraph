/**
 * Shared CSS keyframes for the opt-in rect-kit animations. Injected once, the
 * first time an animated element is rendered — the kit stays stylesheet-free
 * for static use, and self-contained (no external CSS) when animated.
 */
export class RectAnim {

    private static injected = false;

    public static readonly FLOW = 'rk-flow';
    public static readonly PULSE = 'rk-pulse';
    public static readonly TRAVEL = 'rk-travel';

    /** Ensure the keyframes exist in the document; safe to call repeatedly. */
    public static ensure(): void {
        if (RectAnim.injected || typeof document === 'undefined') {
            return;
        }

        const style = document.createElement('style');
        style.setAttribute('data-rectkit', 'anim');
        style.textContent =
            '@keyframes rk-flow{to{stroke-dashoffset:-16}}' +
            '@keyframes rk-pulse{0%,100%{opacity:.35}50%{opacity:1}}' +
            '@keyframes rk-travel{from{offset-distance:0%}to{offset-distance:100%}}';
        document.head.appendChild(style);
        RectAnim.injected = true;
    }

    private static editInjected = false;

    /**
     * Default look of the editable RectBoard (anchors, resize grip, selection,
     * rubber band, connector handles). Zero-specificity `:where()` rules, so
     * any host stylesheet wins.
     */
    public static ensureEditStyles(): void {
        if (RectAnim.editInjected || typeof document === 'undefined') {
            return;
        }

        const style = document.createElement('style');
        style.setAttribute('data-rectkit', 'edit');
        style.textContent =
            ':where(.rb-viewport.rb-panning){cursor:grabbing}' +
            ':where(.rb-viewport.rb-drafting){cursor:crosshair}' +
            ':where([data-rb-item]){user-select:none}' +
            ':where(.rb-selected){outline:2px solid #7aa2ff;outline-offset:2px}' +
            ':where(.rb-resize){position:absolute;right:0;bottom:0;width:12px;height:12px;cursor:nwse-resize;' +
            'background:linear-gradient(135deg,transparent 50%,rgba(122,162,255,.7) 50%)}' +
            ':where(.rb-anchor){position:absolute;width:10px;height:10px;border-radius:50%;background:#7aa2ff;' +
            'border:2px solid #0e1628;opacity:0;cursor:crosshair;transition:opacity .12s}' +
            ':where([data-rb-item]:hover .rb-anchor,.rb-viewport.rb-drafting .rb-anchor){opacity:1}' +
            ':where(.rb-anchor-top){top:-6px;left:calc(50% - 6px)}' +
            ':where(.rb-anchor-bottom){bottom:-6px;left:calc(50% - 6px)}' +
            ':where(.rb-anchor-left){left:-6px;top:calc(50% - 6px)}' +
            ':where(.rb-anchor-right){right:-6px;top:calc(50% - 6px)}' +
            ':where(.rb-band){border:1px dashed #7aa2ff;background:rgba(122,162,255,.08)}' +
            ':where(.rb-edge-hit){cursor:pointer}' +
            ':where(.rb-edge-handle){fill:#0e1628;stroke:currentColor;stroke-width:2;cursor:move;color:#7aa2ff}' +
            ':where(.rb-edge-draft){stroke:#7aa2ff;stroke-width:1.6;stroke-dasharray:4 3}' +
            ':where(.rb-edge-label-bg){fill:#0e1628;stroke:currentColor;stroke-opacity:.5}';
        document.head.appendChild(style);
        RectAnim.editInjected = true;
    }

}
