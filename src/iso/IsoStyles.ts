/** Names of the editor's CSS custom properties, without the `--iso-` prefix. */
export type IsoStyleVar =
    | 'bg' | 'grid' | 'base' | 'base-border' | 'label-bg' | 'label-border' | 'label-text' | 'subtext'
    | 'leader' | 'accent' | 'text' | 'region';

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
            '--iso-subtext:#97a1b6;--iso-leader:#8d97ad;--iso-accent:#ffb020;--iso-text:#c9d0de;--iso-region:#8b7cf6;' +
            'position:relative;overflow:hidden;width:100%;height:100%;background:var(--iso-bg);' +
            'font:13px system-ui,-apple-system,sans-serif;touch-action:none;user-select:none;cursor:grab}',
            ':where(.iso-root[data-iso-theme="light"]){--iso-bg:#ffffff;--iso-grid:rgba(30,40,70,.1);--iso-base:rgba(139,124,246,.32);' +
            '--iso-base-border:rgba(110,96,220,.7);--iso-label-bg:#ffffff;--iso-label-border:#3d4250;--iso-label-text:#1d2230;' +
            '--iso-subtext:#5d6678;--iso-leader:#2b3040;--iso-accent:#e8590c;--iso-text:#3a4254;--iso-region:#8b7cf6}',
            ':where(.iso-root.iso-panning){cursor:grabbing}',
            ':where(.iso-stage){position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0}',
            ':where(.iso-floor){position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible}',
            ':where(.iso-grid){fill:none;stroke:var(--iso-grid);stroke-width:1;vector-effect:non-scaling-stroke}',
            ':where(.iso-region){stroke-width:1.5;vector-effect:non-scaling-stroke;cursor:pointer}',
            ':where(.iso-base){fill:var(--iso-base);stroke:var(--iso-base-border);stroke-width:1;vector-effect:non-scaling-stroke;cursor:pointer}',
            ':where(.iso-base.iso-hover){stroke-width:2}',
            ':where(.iso-base.iso-selected){stroke:var(--iso-accent);stroke-width:2.5}',
            ':where(.iso-floortext){fill:var(--iso-text)}',
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
            ':where(.iso-dim){opacity:.22}',
            ':where(.iso-item,.iso-callout,.iso-base){transition:opacity .2s}'
        ].join('\n');
    }

}
