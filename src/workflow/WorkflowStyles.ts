/**
 * Default look of the workflow editor, injected once. All rules are
 * zero-specificity `:where()` selectors and every colour is a `--wf-*`
 * custom property, so a host stylesheet restyles anything without !important:
 *
 *     .my-editor .wf-root { --wf-bg: #000; --wf-accent: hotpink; }
 */
export class WorkflowStyles {

    private static injected = false;

    public static ensure(): void {
        if (WorkflowStyles.injected || typeof document === 'undefined') {
            return;
        }

        const style = document.createElement('style');
        style.setAttribute('data-jsngraph', 'workflow');
        style.textContent = WorkflowStyles.css();
        document.head.appendChild(style);
        WorkflowStyles.injected = true;
    }

    public static css(): string {
        return [
            // Tokens live on the editor root and on the drag ghost (which hangs off <body>).
            ':where(.wf-root,.wf-ghost){--wf-bg:#12151d;--wf-grid:#262b38;--wf-node-bg:#1d2230;--wf-node-border:#363d50;' +
            '--wf-text:#e6eaf2;--wf-subtext:#8c95a8;--wf-edge:#6b7488;--wf-accent:#ff6d5a;--wf-sel:#7aa2ff;' +
            '--wf-port-bg:#2a3142;--wf-ok:#3ecf8e;--wf-bad:#ef5b5b;--wf-band:rgba(122,162,255,.12);--wf-note:#e8b931;' +
            'font:13px system-ui,-apple-system,sans-serif;color:var(--wf-text)}',
            ':where(.wf-root){position:relative;overflow:hidden;width:100%;height:100%;background-color:var(--wf-bg);' +
            'background-image:radial-gradient(circle,var(--wf-grid) 1.2px,transparent 1.3px);' +
            'outline:none;touch-action:none;user-select:none}',

            ':where(.wf-root[data-wf-theme="light"],.wf-ghost[data-wf-theme="light"]){--wf-bg:#f5f6f9;--wf-grid:#d6dae3;--wf-node-bg:#fff;' +
            '--wf-node-border:#cfd5e0;--wf-text:#1f2430;--wf-subtext:#6a7386;--wf-edge:#9aa2b2;--wf-sel:#3a6df0;' +
            '--wf-port-bg:#e9ecf2;--wf-band:rgba(58,109,240,.1)}',

            ':where(.wf-root.wf-panning){cursor:grabbing}',
            ':where(.wf-stage){position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0}',
            ':where(.wf-edges){position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}',

            // Nodes
            ':where(.wf-node){position:absolute;box-sizing:border-box;display:flex;align-items:center;gap:10px;' +
            'padding:0 14px 0 10px;background:var(--wf-node-bg);border:1.5px solid var(--wf-node-border);' +
            'border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.18);cursor:default;isolation:isolate}',
            ':where(.wf-editable .wf-node){cursor:grab}',
            ':where(.wf-node:hover){border-color:color-mix(in srgb,var(--wf-node-color,var(--wf-accent)) 60%,var(--wf-node-border))}',
            ':where(.wf-node.wf-selected){border-color:var(--wf-sel);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-sel) 30%,transparent)}',
            ':where(.wf-node.wf-disabled){opacity:.45;filter:grayscale(1)}',
            ':where(.wf-node.wf-unknown){border-style:dashed}',
            ':where(.wf-node-body){display:flex;align-items:center;gap:10px;min-width:0;flex:1;pointer-events:none}',
            ':where(.wf-node-icon){flex:none;width:36px;height:36px;border-radius:8px;display:grid;place-items:center;' +
            'font-size:18px;font-weight:700;color:var(--wf-node-color,var(--wf-accent));' +
            'background:color-mix(in srgb,var(--wf-node-color,var(--wf-accent)) 16%,transparent)}',
            ':where(.wf-node-text){min-width:0}',
            ':where(.wf-node-label){font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            ':where(.wf-node-sub){font-size:11.5px;color:var(--wf-subtext);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

            // Ports
            ':where(.wf-port){position:absolute;width:12px;height:12px;margin:-7px 0 0 -7px;border-radius:50%;' +
            'background:var(--wf-port-bg);border:1.5px solid var(--wf-edge);box-sizing:content-box;z-index:1;' +
            'transition:transform .1s,background .1s,border-color .1s}',
            ':where(.wf-port[data-wf-dir="in"]){border-radius:3px}',
            ':where(.wf-editable .wf-port){cursor:crosshair}',
            ':where(.wf-editable .wf-port:hover){transform:scale(1.35);border-color:var(--wf-sel);background:var(--wf-sel)}',
            ':where(.wf-port.wf-connected){background:var(--wf-edge)}',
            ':where(.wf-drafting .wf-port){opacity:.35}',
            ':where(.wf-drafting .wf-port.wf-port-valid){opacity:1;border-color:var(--wf-ok);transform:scale(1.25)}',
            ':where(.wf-drafting .wf-port.wf-port-target){background:var(--wf-ok);transform:scale(1.5)}',
            ':where(.wf-port-label){position:absolute;font-size:10.5px;line-height:1;color:var(--wf-subtext);' +
            'white-space:nowrap;pointer-events:none}',

            // Connections
            ':where(.wf-conn){fill:none;stroke:var(--wf-edge);stroke-width:2}',
            ':where(.wf-conn-hit){fill:none;stroke:transparent;stroke-width:14;pointer-events:stroke}',
            ':where(.wf-editable .wf-conn-hit),:where(.wf-conn-hit){cursor:pointer}',
            ':where(g.wf-conn-g:hover .wf-conn){stroke:color-mix(in srgb,var(--wf-sel) 70%,var(--wf-edge))}',
            ':where(g.wf-conn-g.wf-selected .wf-conn){stroke:var(--wf-sel);stroke-width:2.5}',
            ':where(.wf-arrow){fill:var(--wf-edge)}',
            ':where(.wf-conn-draft){fill:none;stroke:var(--wf-sel);stroke-width:2;stroke-dasharray:6 5}',
            ':where(.wf-conn-draft.wf-ok){stroke:var(--wf-ok);stroke-dasharray:none}',

            ':where(g.wf-conn-g.wf-off .wf-conn){stroke-dasharray:5 5;opacity:.5}',

            // "+" on free ports, insert/delete on connections
            ':where(.wf-add){position:absolute;width:20px;height:20px;margin:-10px 0 0 -10px;padding:0;border-radius:6px;' +
            'border:1.5px dashed var(--wf-edge);background:var(--wf-bg);color:var(--wf-subtext);font:600 14px/1 system-ui;' +
            'cursor:pointer;display:grid;place-items:center;opacity:.7}',
            ':where(.wf-add:hover){opacity:1;border-style:solid;border-color:var(--wf-sel);color:var(--wf-sel)}',
            ':where(.wf-port.wf-connected + .wf-add),:where(.wf-root:not(.wf-editable) .wf-add),:where(.wf-drafting .wf-add){display:none}',
            ':where(.wf-conn-tools){position:absolute;display:flex;gap:4px;transform:translate(-50%,-50%);z-index:2}',
            ':where(.wf-conn-tools button){width:22px;height:22px;padding:0;border-radius:6px;cursor:pointer;' +
            'border:1px solid var(--wf-node-border);background:var(--wf-node-bg);color:var(--wf-text);font:600 14px/1 system-ui}',
            ':where(.wf-conn-tools button:hover){border-color:var(--wf-sel);color:var(--wf-sel)}',
            ':where(.wf-conn-tools button[data-wf-tool="delete"]:hover){border-color:var(--wf-bad);color:var(--wf-bad)}',

            // Sticky notes
            ':where(.wf-note){position:absolute;box-sizing:border-box;border-radius:8px;padding:10px 12px;' +
            'background:color-mix(in srgb,var(--wf-note-color,var(--wf-note)) 16%,var(--wf-bg));' +
            'border:1px solid color-mix(in srgb,var(--wf-note-color,var(--wf-note)) 45%,transparent);overflow:hidden}',
            ':where(.wf-editable .wf-note){cursor:grab}',
            ':where(.wf-note.wf-selected){border-color:var(--wf-sel);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-sel) 30%,transparent)}',
            ':where(.wf-note-text){white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.45;height:100%;overflow:hidden}',
            ':where(.wf-editable .wf-note-text:empty)::before{content:"Double-click to write";color:var(--wf-subtext)}',
            ':where(.wf-note-edit){position:absolute;inset:0;box-sizing:border-box;width:100%;height:100%;padding:10px 12px;' +
            'border:0;outline:none;resize:none;background:transparent;color:inherit;font:inherit;line-height:1.45;cursor:text}',
            ':where(.wf-note-resize){position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;display:none;' +
            'background:linear-gradient(135deg,transparent 50%,color-mix(in srgb,var(--wf-note-color,var(--wf-note)) 70%,transparent) 50%)}',
            ':where(.wf-editable .wf-note-resize){display:block}',

            // Palette drag: the ghost node under the cursor, and a connection it would drop into
            ':where(.wf-ghost){position:fixed;left:0;top:0;z-index:10000;pointer-events:none;transform-origin:0 0;opacity:.9}',
            ':where(.wf-ghost .wf-node){position:relative;box-shadow:0 8px 24px rgba(0,0,0,.35)}',
            ':where(.wf-ghost .wf-add){display:none}',
            ':where(.wf-ghost.wf-ghost-out){opacity:.45}',
            ':where(g.wf-conn-g.wf-drop .wf-conn){stroke:var(--wf-ok);stroke-width:3}',

            ':where(.wf-band){position:absolute;border:1px dashed var(--wf-sel);background:var(--wf-band);pointer-events:none}'
        ].join('');
    }

}
