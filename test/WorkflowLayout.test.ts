import { describe, expect, it } from 'vitest';
import { WorkflowModel } from '../src/workflow/WorkflowModel';
import { WorkflowLayout } from '../src/workflow/WorkflowLayout';
import { WorkflowNodeType } from '../src/workflow/WorkflowTypes';
import { WorkflowMinimap } from '../src/workflow/WorkflowMinimap';
import { WorkflowStyles } from '../src/workflow/WorkflowStyles';
import { Theme } from '../src/render/Theme';

const TYPES: WorkflowNodeType[] = [
    {type: 'trigger', label: 'Trigger', outputs: [{id: 'main'}]},
    {type: 'step', label: 'Step', inputs: [{id: 'main'}], outputs: [{id: 'main'}]},
    {type: 'if', label: 'If', inputs: [{id: 'main'}], outputs: [{id: 'true'}, {id: 'false'}]},
    {type: 'agent', label: 'Agent', inputs: [{id: 'main'}, {id: 'model', kind: 'model', side: 'bottom'},
        {id: 'tool', kind: 'tool', side: 'bottom'}], outputs: [{id: 'main'}]},
    {type: 'llm', label: 'LLM', outputs: [{id: 'model', kind: 'model', side: 'top'}]},
    {type: 'tool', label: 'Tool', outputs: [{id: 'tool', kind: 'tool', side: 'top'}]}
];

function build(nodes: [string, string, number, number][], conns: [string, string, string, string][]): WorkflowModel {
    const m = new WorkflowModel(TYPES);
    for (const [id, type, x, y] of nodes) {
        m.addNode({id, type, x, y});
    }
    for (const [a, ap, b, bp] of conns) {
        m.connect({node: a, port: ap}, {node: b, port: bp});
    }
    return m;
}

describe('WorkflowLayout', () => {
    it('lines a chain up left to right on one row, keeping the old top-left corner', () => {
        const m = build(
            [['t', 'trigger', 100, 300], ['a', 'step', 0, 0], ['b', 'step', 900, 700]],
            [['t', 'main', 'a', 'main'], ['a', 'main', 'b', 'main']]
        );
        const p = WorkflowLayout.compute(m, {gapX: 100, grid: 20});

        expect(p.get('t')!.x).toBeLessThan(p.get('a')!.x);
        expect(p.get('a')!.x).toBeLessThan(p.get('b')!.x);
        expect(new Set([...p.values()].map((q) => q.y)).size).toBe(1);
        expect(Math.min(...[...p.values()].map((q) => q.x))).toBe(0);
        expect(Math.min(...[...p.values()].map((q) => q.y))).toBe(0);
        // Columns do not overlap: 200 wide + 100 gap.
        expect(p.get('a')!.x - p.get('t')!.x).toBe(300);
    });

    it('orders an If\'s branches by output port and puts the join after the longest path', () => {
        const m = build(
            [['t', 'trigger', 0, 0], ['if', 'if', 0, 0], ['no', 'step', 0, -500], ['yes', 'step', 0, 500],
                ['yes2', 'step', 0, 0], ['join', 'step', 0, 0]],
            [['t', 'main', 'if', 'main'], ['if', 'true', 'yes', 'main'], ['if', 'false', 'no', 'main'],
                ['yes', 'main', 'yes2', 'main'], ['yes2', 'main', 'join', 'main'], ['no', 'main', 'join', 'main']]
        );
        const p = WorkflowLayout.compute(m);

        // 'true' is the first output, so its branch goes above although it started below.
        expect(p.get('yes')!.y).toBeLessThan(p.get('no')!.y);
        expect(p.get('yes')!.x).toBe(p.get('no')!.x);
        expect(p.get('join')!.x).toBeGreaterThan(p.get('yes2')!.x);
    });

    it('ignores loops for ranking and terminates', () => {
        const m = build(
            [['t', 'trigger', 0, 0], ['a', 'step', 0, 0], ['b', 'step', 0, 0]],
            [['t', 'main', 'a', 'main'], ['a', 'main', 'b', 'main'], ['b', 'main', 'a', 'main']]
        );
        const p = WorkflowLayout.compute(m);

        expect(p.get('t')!.x).toBeLessThan(p.get('a')!.x);
        expect(p.get('a')!.x).toBeLessThan(p.get('b')!.x);
    });

    it('puts sub-nodes in a row under their agent, in socket order', () => {
        const m = build(
            [['t', 'trigger', 0, 0], ['ag', 'agent', 0, 0], ['tool', 'tool', -400, 0], ['llm', 'llm', 400, 0]],
            [['t', 'main', 'ag', 'main'], ['llm', 'model', 'ag', 'model'], ['tool', 'tool', 'ag', 'tool']]
        );
        const p = WorkflowLayout.compute(m, {subGap: 80, grid: 0});
        const ag = p.get('ag')!;

        expect(p.get('llm')!.y).toBe(ag.y + 64 + 80);
        expect(p.get('tool')!.y).toBe(p.get('llm')!.y);
        expect(p.get('llm')!.x).toBeLessThan(p.get('tool')!.x);   // model socket comes first
        // The agent's column is wide enough for the sub-row, so nothing overlaps.
        expect(p.get('t')!.x + 200).toBeLessThanOrEqual(Math.min(p.get('llm')!.x, ag.x));
    });

    it('stacks disconnected parts top to bottom without overlap', () => {
        const m = build(
            [['a', 'trigger', 0, 0], ['b', 'step', 0, 0], ['c', 'trigger', 0, 400], ['solo', 'step', 0, 800]],
            [['a', 'main', 'b', 'main']]
        );
        const p = WorkflowLayout.compute(m, {componentGap: 100, grid: 0});

        expect(p.get('c')!.y).toBeGreaterThanOrEqual(p.get('a')!.y + 64 + 100);
        expect(p.get('solo')!.y).toBeGreaterThanOrEqual(p.get('c')!.y + 64 + 100);
        expect(WorkflowLayout.compute(new WorkflowModel(TYPES)).size).toBe(0);
    });
});

describe('WorkflowMinimap', () => {
    it('fits the world into the map with padding, centring the slack, and maps back', () => {
        // 1000×500 world into a 200×132 map with 8 px padding: width limits (184/1000).
        const f = WorkflowMinimap.fit({x: -100, y: 50, w: 1000, h: 500}, 200, 132, 8);
        expect(f.scale).toBeCloseTo(0.184);
        expect(-100 * f.scale + f.offsetX).toBeCloseTo(8);              // left edge at the padding
        const top = 50 * f.scale + f.offsetY;
        const bottom = 550 * f.scale + f.offsetY;
        expect(top + bottom).toBeCloseTo(132);                           // vertically centred
        const back = WorkflowMinimap.toWorld(f, 100, 66);
        expect(back.x).toBeCloseTo(400);
        expect(back.y).toBeCloseTo(300);
    });
});

describe('WorkflowStyles', () => {
    it('maps an NGraph theme onto the editor variables', () => {
        const v = WorkflowStyles.varsFromTheme(Theme.light);
        expect(v.bg).toBe(Theme.light.background);
        expect(v['node-bg']).toBe(Theme.light.nodeFill);
        expect(v.edge).toBe(Theme.light.nodeStroke);     // no edgeNeutral in the light palette
        expect(v.bad).toBe(Theme.light.statusCritical);
        expect(WorkflowStyles.css()).toContain('.wf-minimap');
    });
});
