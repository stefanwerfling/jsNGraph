import { describe, expect, it } from 'vitest';
import { WorkflowModel } from '../src/workflow/WorkflowModel';
import { WorkflowGroups } from '../src/workflow/WorkflowGroups';
import { WorkflowLayout } from '../src/workflow/WorkflowLayout';
import { WorkflowNodeType } from '../src/workflow/WorkflowTypes';

const TYPES: WorkflowNodeType[] = [
    {type: 'trigger', label: 'Trigger', outputs: [{id: 'main'}]},
    {type: 'step', label: 'Step', inputs: [{id: 'main'}], outputs: [{id: 'main'}]},
    {type: 'if', label: 'If', inputs: [{id: 'main'}], outputs: [{id: 'true', label: 'true'}, {id: 'false', label: 'false'}]},
    {type: 'agent', label: 'Agent', inputs: [{id: 'main'}, {id: 'model', kind: 'model', side: 'bottom'}], outputs: [{id: 'main'}]},
    {type: 'llm', label: 'LLM', outputs: [{id: 'model', kind: 'model', side: 'top'}]}
];

/** t → a → if ─true→ b → end
 *              └false→ c */
function build(): WorkflowModel {
    const m = new WorkflowModel(TYPES);
    m.addNode({id: 't', type: 'trigger', x: 0, y: 0});
    m.addNode({id: 'a', type: 'step', x: 300, y: 0});
    m.addNode({id: 'if', type: 'if', x: 600, y: 0, label: 'Check'});
    m.addNode({id: 'b', type: 'step', x: 900, y: -100});
    m.addNode({id: 'c', type: 'step', x: 900, y: 100});
    m.addNode({id: 'end', type: 'step', x: 1200, y: 0});
    m.connect({node: 't', port: 'main'}, {node: 'a', port: 'main'}, 'c1');
    m.connect({node: 'a', port: 'main'}, {node: 'if', port: 'main'}, 'c2');
    m.connect({node: 'if', port: 'true'}, {node: 'b', port: 'main'}, 'c3');
    m.connect({node: 'if', port: 'false'}, {node: 'c', port: 'main'}, 'c4');
    m.connect({node: 'b', port: 'main'}, {node: 'end', port: 'main'}, 'c5');
    return m;
}

describe('WorkflowModel groups', () => {
    it('adds, round-trips and dissolves a group', () => {
        const m = build();
        const g = m.addGroup({nodes: ['a', 'if', 'zz'], label: ' Enrich '});

        expect(g.nodes).toEqual(['a', 'if']);           // unknown ids are dropped
        expect(m.groupOf('if')?.id).toBe(g.id);
        expect(m.toDocument().groups).toHaveLength(1);
        expect(new WorkflowModel(TYPES, m.toDocument()).group(g.id)?.nodes).toEqual(['a', 'if']);

        m.updateGroup(g.id, {label: '  ', collapsed: true});
        expect(m.group(g.id)!.label).toBeUndefined();   // blank → default
        expect(m.group(g.id)!.collapsed).toBe(true);
        m.updateGroup(g.id, {collapsed: false});
        expect('collapsed' in m.group(g.id)!).toBe(false);

        expect(m.removeGroups([g.id])).toEqual([g.id]);
        expect(m.toDocument().groups).toBeUndefined();
        expect(m.node('a')).toBeDefined();
    });

    it('keeps a node in one group only, and drops groups that lose all nodes', () => {
        const m = build();
        const g1 = m.addGroup({nodes: ['a', 'if']});
        const g2 = m.addGroup({nodes: ['if', 'b']});

        expect(m.group(g1.id)!.nodes).toEqual(['a']);
        expect(m.groupOf('if')?.id).toBe(g2.id);

        m.removeNodes(['a']);
        expect(m.group(g1.id)).toBeUndefined();
        expect(() => m.addGroup({nodes: ['nope']})).toThrow();
        expect(() => m.addNode({id: g2.id, type: 'step', x: 0, y: 0})).toThrow();
        expect(m.nextId('g')).not.toBe(g2.id);
    });

    it('copies a group with its members and pastes it under new ids', () => {
        const m = build();
        const g = m.addGroup({nodes: ['b', 'c'], label: 'Branches', collapsed: true});
        const frag = m.fragment([g.id]);

        expect(frag.nodes.map((n) => n.id).sort()).toEqual(['b', 'c']);
        expect(frag.groups).toEqual([{id: g.id, label: 'Branches', collapsed: true, nodes: ['b', 'c']}]);

        const added = m.paste(frag, 40, 40);
        const copy = m.group(added.groups[0]!)!;

        expect(copy.id).not.toBe(g.id);
        expect(copy.nodes.sort()).toEqual([...added.nodes].sort());
        expect(copy.collapsed).toBe(true);
        expect(m.expandGroups([copy.id, 't'])).toEqual([...copy.nodes, 't']);
    });
});

describe('WorkflowGroups', () => {
    it('frames the members with padding and a header', () => {
        expect(WorkflowGroups.frame([{x: 100, y: 100, w: 200, h: 64}, {x: 400, y: 200, w: 200, h: 64}])).toEqual({
            x: 100 - WorkflowGroups.PAD,
            y: 100 - WorkflowGroups.PAD - WorkflowGroups.HEADER,
            w: 500 + 2 * WorkflowGroups.PAD,
            h: 164 + 2 * WorkflowGroups.PAD + WorkflowGroups.HEADER
        });
        expect(WorkflowGroups.frame([])).toBeNull();
    });

    it('gives a collapsed group one port per member port with traffic across the border', () => {
        const m = build();
        const g = m.addGroup({nodes: ['a', 'if', 'c'], collapsed: true});
        m.connect({node: 't', port: 'main'}, {node: 'if', port: 'main'}, 'c6');   // a second way in
        const type = WorkflowGroups.collapsedType(m, g);

        // In: a.main (from t) and if.main (from t); c2 (a → if) and c4 (if → c) stay inside.
        expect(type.inputs!.map((p) => p.id)).toEqual(['a:main', 'if:main']);
        expect(type.inputs!.map((p) => p.label)).toEqual(['Step', 'Check']);
        // Out: only if.true (to b); one output → no label.
        expect(type.outputs).toEqual([{id: 'if:true', kind: 'main', side: 'right'}]);

        const rect = WorkflowGroups.collapsedRect(m, g, type)!;
        expect(rect).toMatchObject({x: 300, y: 0, w: WorkflowGroups.BOX_WIDTH});
    });

    it('labels several outputs with node and port name, and keeps socket sides', () => {
        const m = build();
        m.addNode({id: 'ag', type: 'agent', x: 1500, y: 0});
        m.addNode({id: 'llm', type: 'llm', x: 1500, y: 200});
        m.connect({node: 'llm', port: 'model'}, {node: 'ag', port: 'model'});
        m.connect({node: 'c', port: 'main'}, {node: 'end', port: 'main'});
        const g = m.addGroup({nodes: ['if', 'b', 'c', 'ag']});
        const proxies = WorkflowGroups.proxies(m, g);

        expect(proxies.filter((p) => p.dir === 'out').map((p) => p.spec.label)).toEqual(['Step', 'Step']);
        expect(proxies.find((p) => p.ref.node === 'ag')!.spec).toMatchObject({kind: 'model', side: 'bottom'});
    });

    it('substitutes collapsed groups for layout, mapping border connections onto proxies', () => {
        const m = build();
        const g = m.addGroup({nodes: ['a', 'if'], collapsed: true});
        const drawn = WorkflowGroups.substitute(m);

        expect(drawn.node('a')).toBeUndefined();
        expect(drawn.node(g.id)).toMatchObject({x: 300, y: 0});
        expect(drawn.connection('c2')).toBeUndefined();                 // inside
        expect(drawn.connection('c1')!.to).toEqual({node: g.id, port: 'a:main'});
        expect(drawn.connection('c3')!.from).toEqual({node: g.id, port: 'if:true'});

        // The layout treats the group as one column: t | group | b,c | end.
        const p = WorkflowLayout.compute(drawn, {grid: 0});
        expect(p.get(g.id)!.x).toBeGreaterThan(p.get('t')!.x);
        expect(p.get('b')!.x).toBeGreaterThan(p.get(g.id)!.x);
        expect(p.get('end')!.x).toBeGreaterThan(p.get('b')!.x);
    });

    it('maps drawn ends and spots internal connections', () => {
        const hidden = new Map([['a', 'g1'], ['if', 'g1']]);

        expect(WorkflowGroups.drawnEnd({node: 'a', port: 'main'}, hidden)).toEqual({node: 'g1', port: 'a:main'});
        expect(WorkflowGroups.drawnEnd({node: 't', port: 'main'}, hidden)).toEqual({node: 't', port: 'main'});
        expect(WorkflowGroups.isInternal({id: 'x', from: {node: 'a', port: 'main'}, to: {node: 'if', port: 'main'}}, hidden)).toBe(true);
        expect(WorkflowGroups.isInternal({id: 'y', from: {node: 't', port: 'main'}, to: {node: 'a', port: 'main'}}, hidden)).toBe(false);
    });
});
