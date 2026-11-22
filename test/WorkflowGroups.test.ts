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

describe('WorkflowModel nested groups', () => {
    it('nests a group in a new one and lists members through the levels', () => {
        const m = build();
        const inner = m.addGroup({nodes: ['b', 'c'], label: 'Branches'});
        const outer = m.addGroup({nodes: ['if'], groups: [inner.id], label: 'Route'});

        expect(m.group(inner.id)!.parent).toBe(outer.id);
        expect(m.members(outer.id).sort()).toEqual(['b', 'c', 'if']);
        expect(m.ancestors('b')).toEqual([inner.id, outer.id]);
        expect(m.depth(inner.id)).toBe(1);
        expect(m.descendantGroups(outer.id)).toEqual([outer.id, inner.id]);
        expect(m.commonParent(['b', 'c'])).toBe(inner.id);
        expect(m.commonParent(['b', 'if'])).toBe(outer.id);
        expect(m.commonParent(['b', 't'])).toBeUndefined();
        expect(m.expandGroups([outer.id]).sort()).toEqual(['b', 'c', 'if']);

        // A sub-group inside the inner one keeps its place in the tree.
        const sub = m.addGroup({nodes: ['b'], parent: m.commonParent(['b'])});
        expect(m.group(sub.id)!.parent).toBe(inner.id);
        expect(m.group(inner.id)!.nodes).toEqual(['c']);
        expect(() => m.addGroup({nodes: ['a'], groups: [outer.id], parent: inner.id})).toThrow();
    });

    it('moves content up one level when a group is dissolved, and prunes empty ones', () => {
        const m = build();
        const inner = m.addGroup({nodes: ['b', 'c']});
        const outer = m.addGroup({nodes: ['if'], groups: [inner.id]});
        const mid = m.addGroup({nodes: ['b'], parent: inner.id});

        m.removeGroups([inner.id]);
        expect(m.group(outer.id)!.nodes.sort()).toEqual(['c', 'if']);
        expect(m.group(mid.id)!.parent).toBe(outer.id);

        m.removeNodes(['b']);
        expect(m.group(mid.id)).toBeUndefined();          // emptied
        m.removeNodes(['c', 'if']);
        expect(m.allGroups()).toEqual([]);                // the outer one went too
    });

    it('keeps the outer group when its only nodes move into a sub-group', () => {
        const m = build();
        const outer = m.addGroup({nodes: ['a', 'if']});
        const inner = m.addGroup({nodes: ['a', 'if'], parent: outer.id});

        expect(m.group(outer.id)).toBeDefined();
        expect(m.group(outer.id)!.nodes).toEqual([]);
        expect(m.members(outer.id).sort()).toEqual(['a', 'if']);
        expect(m.group(inner.id)!.parent).toBe(outer.id);
    });

    it('repairs missing and cyclic parents on load', () => {
        const m = new WorkflowModel(TYPES, {
            nodes: [{id: 'a', type: 'step', x: 0, y: 0}, {id: 'b', type: 'step', x: 0, y: 100}],
            connections: [],
            groups: [
                {id: 'g1', nodes: ['a'], parent: 'g2'},
                {id: 'g2', nodes: ['b'], parent: 'g1'},
                {id: 'g3', nodes: [], parent: 'nope'}
            ]
        });

        expect(m.group('g3')!.parent).toBeUndefined();
        expect([m.group('g1')!.parent, m.group('g2')!.parent].filter((p) => p !== undefined)).toHaveLength(1);
    });

    it('copies a group with its sub-groups and pastes the tree under new ids', () => {
        const m = build();
        const inner = m.addGroup({nodes: ['b', 'c'], collapsed: true});
        const outer = m.addGroup({nodes: ['if'], groups: [inner.id], label: 'Route'});
        const frag = m.fragment([outer.id]);

        expect(frag.groups!.map((g) => g.id)).toEqual([outer.id, inner.id]);

        const added = m.paste(frag, 0, 400);
        const [newOuter, newInner] = [added.groups.find((g) => m.group(g)!.label === 'Route')!, added.groups.find((g) => m.group(g)!.label === undefined)!];

        expect(added.groups).toHaveLength(2);
        expect(m.group(newInner)!.parent).toBe(newOuter);
        expect(m.group(newInner)!.collapsed).toBe(true);
        expect(m.members(newOuter)).toHaveLength(3);

        // Copying only the inner group: it lands at the top level.
        expect(m.fragment([inner.id]).groups![0]!.parent).toBeUndefined();
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

    it('hides nested content behind the outermost collapsed group', () => {
        const m = build();
        const inner = m.addGroup({nodes: ['b', 'c'], collapsed: true});
        const outer = m.addGroup({nodes: ['if'], groups: [inner.id]});

        let hidden = WorkflowGroups.hidden(m);
        expect(hidden.get('b')).toBe(inner.id);
        expect(hidden.has('if')).toBe(false);
        expect(hidden.has(inner.id)).toBe(false);

        // The outer frame wraps the inner box (collapsed) and its own node.
        const frame = WorkflowGroups.frameOf(m, m.group(outer.id)!)!;
        const box = WorkflowGroups.collapsedRect(m, m.group(inner.id)!)!;
        expect(frame.x).toBeLessThanOrEqual(box.x - WorkflowGroups.PAD);
        expect(frame.y + frame.h).toBeGreaterThanOrEqual(box.y + box.h + WorkflowGroups.PAD);

        m.updateGroup(outer.id, {collapsed: true});
        hidden = WorkflowGroups.hidden(m);
        expect(hidden.get('b')).toBe(outer.id);
        expect(hidden.get(inner.id)).toBe(outer.id);

        const drawn = WorkflowGroups.substitute(m);
        expect(drawn.node(outer.id)).toBeDefined();
        expect(drawn.node(inner.id)).toBeUndefined();
        expect(drawn.connection('c5')!.from).toEqual({node: outer.id, port: 'b:main'});

        // Expanded outer, expanded inner: the inner frame (with header) sits inside the outer one.
        m.updateGroup(outer.id, {collapsed: false});
        m.updateGroup(inner.id, {collapsed: false});
        const o = WorkflowGroups.frameOf(m, m.group(outer.id)!)!;
        const i = WorkflowGroups.frameOf(m, m.group(inner.id)!)!;
        expect(i.y - o.y).toBeGreaterThanOrEqual(WorkflowGroups.HEADER + WorkflowGroups.PAD);
    });

    it('maps drawn ends and spots internal connections', () => {
        const hidden = new Map([['a', 'g1'], ['if', 'g1']]);

        expect(WorkflowGroups.drawnEnd({node: 'a', port: 'main'}, hidden)).toEqual({node: 'g1', port: 'a:main'});
        expect(WorkflowGroups.drawnEnd({node: 't', port: 'main'}, hidden)).toEqual({node: 't', port: 'main'});
        expect(WorkflowGroups.isInternal({id: 'x', from: {node: 'a', port: 'main'}, to: {node: 'if', port: 'main'}}, hidden)).toBe(true);
        expect(WorkflowGroups.isInternal({id: 'y', from: {node: 't', port: 'main'}, to: {node: 'a', port: 'main'}}, hidden)).toBe(false);
    });
});

describe('Groups around collapsed nodes', () => {
    it('the frame shrinks with a collapsed member', () => {
        const types: WorkflowNodeType[] = [{type: 'big', label: 'Big', height: 300, inputs: [{id: 'in'}], outputs: [{id: 'out'}]}];
        const m = new WorkflowModel(types);

        m.addNode({id: 'a', type: 'big', x: 0, y: 0});
        m.addNode({id: 'b', type: 'big', x: 300, y: 0});

        const g = m.addGroup({nodes: ['a', 'b']});
        const open = WorkflowGroups.frameOf(m, m.group(g.id)!)!;

        m.setCollapsed(['a', 'b'], true);

        const shut = WorkflowGroups.frameOf(m, m.group(g.id)!)!;
        expect(shut.h).toBeLessThan(open.h - 200);
        expect(shut.w).toBe(open.w);
    });
});

describe('WorkflowModel.addToGroup', () => {
    it('moves a node into a group and out of its old one', () => {
        const types: WorkflowNodeType[] = [{type: 'n', label: 'N', inputs: [{id: 'in'}], outputs: [{id: 'out'}]}];
        const m = new WorkflowModel(types);

        for (const id of ['a', 'b', 'c']) {
            m.addNode({id, type: 'n', x: 0, y: 0});
        }

        const g1 = m.addGroup({nodes: ['a']});
        const g2 = m.addGroup({nodes: ['b']});

        expect(m.addToGroup(g2.id, 'a')).toBe(true);
        expect(m.group(g2.id)!.nodes).toEqual(['b', 'a']);
        expect(m.group(g1.id)?.nodes ?? []).toEqual([]);
        expect(m.addToGroup('nope', 'c')).toBe(false);
        expect(m.addToGroup(g2.id, 'nope')).toBe(false);
    });
});
