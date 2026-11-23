/** Names of the editor's CSS custom properties, without the `--iso-` prefix. */
export type IsoStyleVar =
    | 'bg' | 'grid' | 'base' | 'base-border' | 'label-bg' | 'label-border' | 'label-text' | 'subtext'
    | 'leader' | 'accent' | 'text' | 'region' | 'line';

/**
 * Default look of the isometric editor, injected once: zero-specificity
 * `:where()` rules over `--iso-*` custom properties, so a host stylesheet
 * restyles anything without !important. `data-iso-theme="light"` on the root
 * switches the palette.
 */
export class IsoStyles {

    private static injected = false;

    public static ensure(): void {
        if (IsoStyles.injected || typeof document === 'undefined') {
            return;
        }

        const style = document.createElement('style');
        style.setAttribute('data-jsngraph', 'iso');
        style.textContent = IsoStyles.css();
        document.head.appendChild(style);
        IsoStyles.injected = true;
    }

    public static css(): string {
        return [
            ':where(.iso-root){--iso-bg:#171b26;--iso-grid:rgba(255,255,255,.07);--iso-base:rgba(139,124,246,.38);' +
            '--iso-base-border:rgba(167,155,255,.75);--iso-label-bg:#232a3a;--iso-label-border:#46506a;--iso-label-text:#eef1f7;' +
            '--iso-subtext:#97a1b6;--iso-leader:#8d97ad;--iso-accent:#ffb020;--iso-text:#c9d0de;--iso-region:#8b7cf6;--iso-line:#9d8cff;' +
            'position:relative;overflow:hidden;width:100%;height:100%;background:var(--iso-bg);' +
            'font:13px system-ui,-apple-system,sans-serif;touch-action:none;user-select:none;cursor:grab}',
            ':where(.iso-root[data-iso-theme="light"]){--iso-bg:#ffffff;--iso-grid:rgba(30,40,70,.1);--iso-base:rgba(139,124,246,.32);' +
            '--iso-base-border:rgba(110,96,220,.7);--iso-label-bg:#ffffff;--iso-label-border:#3d4250;--iso-label-text:#1d2230;' +
            '--iso-subtext:#5d6678;--iso-leader:#2b3040;--iso-accent:#e8590c;--iso-text:#3a4254;--iso-region:#8b7cf6;--iso-line:#8b7cf6}',
            ':where(.iso-root.iso-panning){cursor:grabbing}',
            ':where(.iso-stage){position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0}',
            ':where(.iso-floor){position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible}',
            ':where(.iso-grid){fill:none;stroke:var(--iso-grid);stroke-width:1;vector-effect:non-scaling-stroke}',
            ':where(.iso-region){stroke-width:1.5;vector-effect:non-scaling-stroke;cursor:pointer}',
            ':where(.iso-base){fill:var(--iso-base);stroke:var(--iso-base-border);stroke-width:1;vector-effect:non-scaling-stroke;cursor:pointer}',
            ':where(.iso-base.iso-hover){stroke-width:2}',
            ':where(.iso-base.iso-selected){stroke:var(--iso-accent);stroke-width:2.5}',
            ':where(.iso-floortext){fill:var(--iso-text)}',
            ':where(.iso-conn-line,.iso-conn-sel,.iso-conn-hit){fill:none;vector-effect:non-scaling-stroke;stroke-linecap:round;stroke-linejoin:round}',
            ':where(.iso-conn-sel){stroke:var(--iso-accent);opacity:0}',
            ':where(.iso-conn.iso-selected .iso-conn-sel){opacity:.9}',
            ':where(.iso-conn.iso-hover .iso-conn-line){filter:brightness(1.2)}',
            ':where(.iso-conn-hit){stroke:transparent;pointer-events:stroke;cursor:pointer}',
            ':where(.iso-conn-end){fill:var(--iso-bg);stroke-width:2;vector-effect:non-scaling-stroke}',
            ':where(.iso-conn-label){position:absolute;transform:translate(-50%,-50%);white-space:nowrap;background:var(--iso-label-bg);' +
            'color:var(--iso-label-text);border-radius:5px;padding:3px 9px;font-size:13px;opacity:.92;cursor:pointer}',
            ':where(.iso-conn-label.iso-selected){box-shadow:0 0 0 2px var(--iso-accent)}',
            // the selected connector's handles may sit under its label
            ':where(.iso-root.iso-edit[data-iso-mode="select"] .iso-conn-label.iso-selected){pointer-events:none;opacity:.6}',
            ':where(.iso-items,.iso-labels){position:absolute;left:0;top:0;width:0;height:0}',
            ':where(.iso-item){position:absolute;pointer-events:none}',
            ':where(.iso-item svg){display:block;width:100%;height:100%;overflow:visible}',
            ':where(.iso-item svg *){pointer-events:visiblePainted;cursor:pointer}',
            ':where(.iso-item.iso-hover svg){filter:brightness(1.08) drop-shadow(0 0 6px rgba(255,255,255,.25))}',
            ':where(.iso-item.iso-selected svg){filter:drop-shadow(0 0 2px var(--iso-accent)) drop-shadow(0 0 7px var(--iso-accent))}',
            ':where(.iso-callout){position:absolute;width:0;height:0}',
            ':where(.iso-leader){position:absolute;left:-1px;width:0;border-left:2.5px dotted var(--iso-leader)}',
            ':where(.iso-label){position:absolute;left:0;bottom:0;transform:translateX(-50%);white-space:nowrap;' +
            'background:var(--iso-label-bg);color:var(--iso-label-text);border:1px solid var(--iso-label-border);border-radius:7px;' +
            'padding:7px 14px;font-size:17px;line-height:1.2;text-align:center;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.18)}',
            ':where(.iso-label small){display:block;font-size:12px;color:var(--iso-subtext);margin-top:2px;max-width:220px;white-space:normal}',
            ':where(.iso-label.iso-selected){border-color:var(--iso-accent);box-shadow:0 0 0 2px var(--iso-accent)}',
            ':where(.iso-root:focus){outline:none}',
            ':where(.iso-root.iso-edit[data-iso-mode="connect"],.iso-root.iso-edit[data-iso-mode="region"],' +
            '.iso-root.iso-edit[data-iso-mode="text"]){cursor:crosshair}',
            ':where(.iso-region.iso-selected){stroke:var(--iso-accent);stroke-width:2.5}',
            ':where(.iso-text.iso-selected .iso-floortext){fill:var(--iso-accent)}',
            ':where(.iso-text){cursor:pointer}',
            ':where(.iso-handles){z-index:1000000}',
            ':where(.iso-handle){fill:#ffffff;stroke:var(--iso-accent);stroke-width:3;vector-effect:non-scaling-stroke;cursor:move;' +
            'filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}',
            ':where(.iso-handle-mid){fill:var(--iso-accent);stroke:#ffffff;stroke-width:2;cursor:copy}',
            ':where(.iso-handle-end){fill:var(--iso-accent);stroke:#ffffff;stroke-width:2.5;cursor:crosshair}',
            ':where(.iso-cursor){fill:rgba(255,255,255,.08);stroke:var(--iso-accent);stroke-width:1.5;stroke-dasharray:4 3;' +
            'vector-effect:non-scaling-stroke;pointer-events:none}',
            ':where(.iso-draft){pointer-events:none;vector-effect:non-scaling-stroke}',
            ':where(.iso-draft-line){fill:none;stroke:var(--iso-accent);stroke-width:4;stroke-dasharray:8 6;stroke-linecap:round;' +
            'stroke-linejoin:round}',
            ':where(.iso-draft-region){fill:rgba(255,176,32,.12);stroke:var(--iso-accent);stroke-width:2;stroke-dasharray:6 4}',
            ':where(.iso-band){position:absolute;border:1px dashed var(--iso-accent);background:rgba(255,176,32,.08);pointer-events:none}',
            ':where(.iso-ghost){position:fixed;left:0;top:0;z-index:10000;pointer-events:none;opacity:.75}',
            ':where(.iso-ghost svg){display:block;width:100%;height:100%;overflow:visible}',
            ':where(.iso-input){position:absolute;transform:translate(-50%,-50%);z-index:5;min-width:120px;font:15px system-ui,sans-serif;' +
            'padding:5px 9px;border-radius:6px;border:2px solid var(--iso-accent);background:var(--iso-label-bg);' +
            'color:var(--iso-label-text);outline:none;text-align:center}',
            ':where(.iso-root){--iso-ok:#3ecf6e;--iso-warn:#f5b93b;--iso-down:#ef5350;--iso-idle:#8d97ad}',
            ':where(.iso-wall){position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}',
            ':where(.iso-actor){transition:none}',
            ':where(.iso-actor svg *){pointer-events:none}',
            ':where(.iso-status-ring){fill:none;stroke-width:2.5;vector-effect:non-scaling-stroke;pointer-events:none}',
            ':where(.iso-status-ring.iso-st-ok){stroke:var(--iso-ok);fill:color-mix(in srgb,var(--iso-ok) 16%,transparent)}',
            ':where(.iso-status-ring.iso-st-warn){stroke:var(--iso-warn);fill:color-mix(in srgb,var(--iso-warn) 18%,transparent)}',
            ':where(.iso-status-ring.iso-st-idle){stroke:var(--iso-idle);stroke-dasharray:4 3}',
            ':where(.iso-status-ring.iso-st-down){stroke:var(--iso-down);fill:color-mix(in srgb,var(--iso-down) 24%,transparent);' +
            'animation:iso-pulse 1s ease-in-out infinite}',
            '@keyframes iso-pulse{50%{opacity:.35}}',
            '@media (prefers-reduced-motion:reduce){.iso-status-ring{animation:none!important}}',
            ':where(.iso-st){display:block;font-size:11px;margin-top:3px;color:var(--iso-subtext)}',
            ':where(.iso-st)::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;' +
            'vertical-align:1px;background:var(--iso-idle)}',
            ':where(.iso-st.iso-st-ok)::before{background:var(--iso-ok)}',
            ':where(.iso-st.iso-st-warn)::before{background:var(--iso-warn)}',
            ':where(.iso-st.iso-st-down)::before{background:var(--iso-down)}',
            ':where(.iso-st.iso-st-down){color:var(--iso-down)}',
            ':where(.iso-progress){display:block;height:4px;margin-top:4px;border-radius:2px;background:var(--iso-label-border);overflow:hidden}',
            ':where(.iso-progress b){display:block;height:100%;background:var(--iso-ok)}',
            ':where(.iso-progress.iso-st-warn b){background:var(--iso-warn)}',
            ':where(.iso-progress.iso-st-down b){background:var(--iso-down)}',
            ':where(.iso-progress.iso-st-idle b){background:var(--iso-idle)}',
            ':where(.iso-conn-off .iso-conn-line){opacity:.35}',
            ':where(.iso-conn-off) circle:not(.iso-conn-end){display:none}',
            ':where(.iso-dim){opacity:.22}',
            ':where(.iso-item,.iso-callout,.iso-base,.iso-conn,.iso-conn-label){transition:opacity .2s}'
        ].join('\n');
    }

}
