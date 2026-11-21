import { ThemeTokens } from '../render/Theme';

/** Names of the editor's CSS custom properties, without the `--wf-` prefix. */
export type WorkflowStyleVar =
    | 'bg' | 'grid' | 'node-bg' | 'node-border' | 'text' | 'subtext' | 'edge' | 'accent'
    | 'sel' | 'port-bg' | 'ok' | 'bad' | 'band' | 'note';

/**
 * Default look of the workflow editor, injected once. All rules are
 * zero-specificity `:where()` selectors and every colour is a `--wf-*`
 * custom property, so a host stylesheet restyles anything without !important:
 *
 *     .my-editor .wf-root { --wf-bg: #000; --wf-accent: hotpink; }
 */
export class WorkflowStyles {

    private static injected = false;

    /**
     * `--wf-*` values from an NGraph `ThemeTokens` palette, so a workflow
     * editor and an NGraph on the same page share one look. Pass the result
     * to `WorkflowEditor.setStyleVars`.
     */
    public static varsFromTheme(t: ThemeTokens): Partial<Record<WorkflowStyleVar, string>> {
        return {
            'bg': t.background,
            'grid': t.gridDot,
            'node-bg': t.nodeFill,
            'node-border': t.nodeStroke,
            'text': t.panelText,
            'subtext': t.panelSubtext,
            'edge': t.edgeNeutral ?? t.nodeStroke,
            'sel': t.nodeSelectedStroke,
            'port-bg': t.panelBackground,
            'ok': t.statusOk,
            'bad': t.statusCritical,
            'note': t.statusWarning
        };
    }

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

            // Run status
            ':where(.wf-node.wf-st-running){border-color:var(--wf-sel);animation:wf-glow 1.4s ease-in-out infinite}',
            ':where(.wf-node.wf-st-success){border-color:var(--wf-ok)}',
            ':where(.wf-node.wf-st-error){border-color:var(--wf-bad);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-bad) 25%,transparent)}',
            ':where(.wf-node.wf-st-waiting){border-style:dashed}',
            ':where(.wf-badge){position:absolute;top:-9px;right:-9px;width:18px;height:18px;border-radius:50%;box-sizing:border-box;' +
            'display:grid;place-items:center;font:700 11px/1 system-ui;color:#fff;background:var(--wf-subtext);z-index:2;cursor:default}',
            ':where(.wf-badge[data-wf-status="success"]){background:var(--wf-ok)}',
            ':where(.wf-badge[data-wf-status="error"]){background:var(--wf-bad)}',
            ':where(.wf-badge[data-wf-status="running"]){background:var(--wf-node-bg);border:2.5px solid color-mix(in srgb,var(--wf-sel) 25%,transparent);' +
            'border-top-color:var(--wf-sel);animation:wf-spin .8s linear infinite}',
            ':where(.wf-dim){opacity:.28}',
            ':where(g.wf-conn-g.wf-st-success .wf-conn){stroke:var(--wf-ok)}',
            ':where(g.wf-conn-g.wf-st-error .wf-conn){stroke:var(--wf-bad)}',
            ':where(.wf-dots circle){fill:var(--wf-ok)}',
            ':where(.wf-conn-label){position:absolute;transform:translate(-50%,-150%);padding:1px 7px;border-radius:9px;white-space:nowrap;' +
            'font:600 10.5px/16px system-ui;color:var(--wf-subtext);background:var(--wf-bg);border:1px solid var(--wf-node-border);pointer-events:none}',
            // Document label: under the line (the run-status pill sits above it, the tools on it).
            ':where(.wf-conn-text){position:absolute;transform:translate(-50%,45%);max-width:180px;overflow:hidden;' +
            'text-overflow:ellipsis;padding:1px 7px;border-radius:5px;white-space:nowrap;font:500 11px/16px system-ui;' +
            'color:var(--wf-text);background:var(--wf-bg);border:1px solid transparent;cursor:pointer}',
            ':where(.wf-conn-text.wf-selected){border-color:var(--wf-sel);color:var(--wf-sel)}',
            ':where(.wf-conn-text.wf-off){opacity:.45}',
            ':where(.wf-conn-text-edit){position:absolute;transform:translate(-50%,45%);width:160px;z-index:3;' +
            'padding:1px 7px;border-radius:5px;font:500 11px/16px system-ui;color:var(--wf-text);background:var(--wf-node-bg);' +
            'border:1px solid var(--wf-sel);outline:none}',
            ':where(.wf-conn-label[data-wf-status="success"]){color:var(--wf-ok);border-color:color-mix(in srgb,var(--wf-ok) 50%,transparent)}',
            ':where(.wf-conn-label[data-wf-status="error"]){color:var(--wf-bad);border-color:color-mix(in srgb,var(--wf-bad) 50%,transparent)}',
            '@keyframes wf-spin{to{transform:rotate(360deg)}}',
            '@keyframes wf-glow{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--wf-sel) 0%,transparent)}' +
            '50%{box-shadow:0 0 0 6px color-mix(in srgb,var(--wf-sel) 28%,transparent)}}',
            '@media (prefers-reduced-motion:reduce){:where(.wf-dots){display:none}' +
            ':where(.wf-node.wf-st-running,.wf-badge[data-wf-status="running"]){animation:none}}',

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

            // Groups (sub-workflows): a frame with a header when expanded, a stacked card when collapsed
            ':where(.wf-group){position:absolute;box-sizing:border-box;border-radius:12px;pointer-events:none;' +
            'border:1.5px dashed color-mix(in srgb,var(--wf-group-color,var(--wf-sel)) 55%,transparent);' +
            'background:color-mix(in srgb,var(--wf-group-color,var(--wf-sel)) 6%,transparent)}',
            ':where(.wf-group.wf-selected){border-style:solid;border-color:var(--wf-sel);' +
            'box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-sel) 22%,transparent)}',
            ':where(.wf-group-head){position:absolute;left:0;top:0;right:0;height:32px;box-sizing:border-box;padding:0 10px 0 6px;' +
            'display:flex;align-items:center;gap:6px;pointer-events:auto;cursor:default;' +
            'color:color-mix(in srgb,var(--wf-group-color,var(--wf-sel)) 75%,var(--wf-text))}',
            ':where(.wf-editable .wf-group-head){cursor:grab}',
            ':where(.wf-group-label){font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
            ':where(.wf-group-count){font-size:11px;color:var(--wf-subtext);white-space:nowrap}',
            ':where(.wf-group-toggle){flex:none;width:22px;height:22px;padding:0;border-radius:6px;cursor:pointer;display:grid;' +
            'place-items:center;font:600 12px/1 system-ui;color:inherit;background:transparent;border:1px solid transparent}',
            ':where(.wf-group-toggle:hover){border-color:var(--wf-node-border);background:var(--wf-node-bg)}',
            ':where(.wf-group-edit){position:absolute;width:180px;height:22px;box-sizing:border-box;z-index:3;padding:0 7px;' +
            'border-radius:5px;font:600 13px/20px system-ui;color:var(--wf-text);background:var(--wf-node-bg);' +
            'border:1px solid var(--wf-sel);outline:none}',
            ':where(.wf-node.wf-group-node){--wf-node-color:var(--wf-group-color,var(--wf-sel));border-color:' +
            'color-mix(in srgb,var(--wf-node-color) 55%,var(--wf-node-border));box-shadow:5px 5px 0 -1.5px var(--wf-node-bg),' +
            '5px 5px 0 0 color-mix(in srgb,var(--wf-node-color) 40%,var(--wf-node-border)),0 2px 8px rgba(0,0,0,.18)}',
            ':where(.wf-node.wf-group-node.wf-selected){border-color:var(--wf-sel)}',
            ':where(.wf-group-node .wf-group-toggle){position:absolute;top:4px;right:4px;color:var(--wf-subtext)}',
            ':where(.wf-group-node .wf-port),:where(.wf-editable .wf-group-node .wf-port){cursor:inherit;transform:none}',
            ':where(.wf-editable .wf-group-node .wf-port:hover){transform:none;background:var(--wf-edge);border-color:var(--wf-edge)}',
            ':where(.wf-conn-tools.wf-no-insert [data-wf-tool="insert"]){display:none}',

            // Minimap
            ':where(.wf-minimap){position:absolute;right:12px;bottom:12px;z-index:3;border-radius:8px;cursor:pointer;' +
            'background:color-mix(in srgb,var(--wf-node-bg) 88%,transparent);border:1px solid var(--wf-node-border);' +
            'box-shadow:0 4px 14px rgba(0,0,0,.25)}',

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
