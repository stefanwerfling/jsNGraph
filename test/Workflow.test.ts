import { describe, expect, it } from 'vitest';
import { WorkflowModel } from '../src/workflow/WorkflowModel';
import { WorkflowGeometry as G } from '../src/workflow/WorkflowGeometry';
import { WorkflowNodeType } from '../src/workflow/WorkflowTypes';

const TYPES: WorkflowNodeType[] = [
    {type: 'trigger', label: 'Trigger', outputs: [{id: 'main'}]},
    {type: 'if', label: 'If', inputs: [{id: 'main'}], outputs: [{id: 'true', label: 'true'}, {id: 'false', label: 'false'}]},
    {type: 'single', label: 'Single', inputs: [{id: 'main', max: 1}], outputs: [{id: 'main'}]},
    {type: 'agent', label: 'Agent', inputs: [{id: 'main'}, {id: 'tool', kind: 'tool', side: 'bottom'}], outputs: [{id: 'main'}]},
    {type: 'tool', label: 'Tool', outputs: [{id: 'tool', kind: 'tool', side: 'top'}]}
];

function model(): WorkflowModel {
    const m = new WorkflowModel(TYPES);
    m.addNode({id: 't', type: 'trigger', x: 0, y: 0});
    m.addNode({id: 'if', type: 'if', x: 300, y: 0});
    m.addNode({id: 's', type: 'single', x: 600, y: 0});
    m.addNode({id: 'a', type: 'agent', x: 600, y: 200});
    m.addNode({id: 'tool', type: 'tool', x: 600, y: 400});
    return m;
}

describe('WorkflowModel', () => {
    it('connects outputs to inputs and validates the rules', () => {
        const m = model();
        const c = m.connect({node: 't', port: 'main'}, {node: 'if', port: 'main'});

        expect(c.id).toMatch(/^c\d+$/);
        expect(m.validate({node: 't', port: 'main'}, {node: 'if', port: 'main'})).toBe('already connected');
        expect(m.validate({node: 'if', port: 'main'}, {node: 's', port: 'main'})).toBe('unknown output port');
        expect(m.validate({node: 'if', port: 'true'}, {node: 'if', port: 'main'})).toBe('a node cannot connect to itself');
        expect(m.validate({node: 'tool', port: 'tool'}, {node: 's', port: 'main'})).toBe('port kinds differ');
        expect(m.validate({node: 'tool', port: 'tool'}, {node: 'a', port: 'tool'})).toBeNull();

        m.connect({node: 'if', port: 'true'}, {node: 's', port: 'main'});
        expect(m.validate({node: 'if', port: 'false'}, {node: 's', port: 'main'})).toBe('input port is full');
        expect(() => m.connect({node: 'if', port: 'false'}, {node: 's', port: 'main'})).toThrow(/full/);
    });

    it('lets a rerouted connection ignore itself and honours the host veto', () => {
        const m = model();
        const c = m.connect({node: 'if', port: 'true'}, {node: 's', port: 'main'});

        // Moving the same connection to the other output is fine despite max: 1.
        expect(m.validate({node: 'if', port: 'false'}, {node: 's', port: 'main'}, c.id)).toBeNull();
        m.reconnect(c.id, {node: 'if', port: 'false'}, {node: 's', port: 'main'});
        expect(m.connection(c.id)!.from.port).toBe('false');

        m.setCanConnect((from) => from.node === 't' ? 'no triggers here' : true);
        expect(m.validate({node: 't', port: 'main'}, {node: 'a', port: 'main'})).toBe('no triggers here');
    });

    it('removes nodes with their connections and keeps unknown data', () => {
        const m = model();
        m.connect({node: 't', port: 'main'}, {node: 'if', port: 'main'});
        m.connect({node: 'if', port: 'true'}, {node: 's', port: 'main'});

        expect(m.removeNodes(['if'])).toEqual({removed: ['c1', 'c2'], added: []});
        expect(m.allConnections()).toEqual([]);

        const doc = {
            nodes: [{id: 'x', type: 'unregistered', x: 0, y: 0, meta: {a: 1}}],
            connections: [{id: 'c9', from: {node: 'x', port: 'o'}, to: {node: 'y', port: 'i'}}]
        };
        m.load(doc);
        expect(m.toDocument()).toEqual(doc);
        expect(m.ports('x', 'in')).toEqual([]);
    });

    it('generates free ids and finds the first compatible port', () => {
        const m = model();
        m.addNode({id: 'n1', type: 'trigger', x: 0, y: 0});
        expect(m.addNode({type: 'trigger', x: 0, y: 0}).id).toBe('n2');
        expect(() => m.addNode({id: 't', type: 'trigger', x: 0, y: 0})).toThrow(/exists/);

        expect(m.firstCompatiblePort({node: 'tool', port: 'tool'}, 'out', 'a')).toBe('tool');
        expect(m.firstCompatiblePort({node: 'a', port: 'main'}, 'in', 'if')).toBe('true');
    });
});

describe('WorkflowModel editing helpers', () => {
    function chain(): WorkflowModel {
        // t → s1 → s2 → s3, plus s1 → if (s1 fans out to two successors)
        const m = new WorkflowModel(TYPES);
        m.addNode({id: 't', type: 'trigger', x: 0, y: 0});
        for (const id of ['s1', 's2', 's3']) {
            m.addNode({id, type: 'single', x: 0, y: 0});
        }
        m.addNode({id: 'if', type: 'if', x: 0, y: 0});
        m.connect({node: 't', port: 'main'}, {node: 's1', port: 'main'}, 'a');
        m.connect({node: 's1', port: 'main'}, {node: 's2', port: 'main'}, 'b');
        m.connect({node: 's2', port: 'main'}, {node: 's3', port: 'main'}, 'c');
        m.connect({node: 's1', port: 'main'}, {node: 'if', port: 'main'}, 'd');
        return m;
    }
    const pairs = (m: WorkflowModel): string[] => m.allConnections().map((c) => `${c.from.node}>${c.to.node}`).sort();

    it('bridges a deleted node to all its successors', () => {
        const m = chain();
        const r = m.removeNodes(['s1'], true);

        expect(r.removed.sort()).toEqual(['a', 'b', 'd']);
        expect(r.added.length).toBe(2);
        expect(pairs(m)).toEqual(['s2>s3', 't>if', 't>s2']);
    });

    it('bridges across a deleted run and reports only lasting connections', () => {
        const m = chain();
        const r = m.removeNodes(['s1', 's2'], true);

        expect(pairs(m)).toEqual(['t>if', 't>s3']);
        // The temporary t>s2 bridge is neither "removed" nor "added".
        expect(r.removed.sort()).toEqual(['a', 'b', 'c', 'd']);
        expect(r.added.length).toBe(2);
        expect(r.added.every((id) => m.connection(id) !== undefined)).toBe(true);
    });

    it('does not bridge without reconnect or with several inputs', () => {
        const m = chain();
        m.removeNodes(['s2']);
        expect(pairs(m)).toEqual(['s1>if', 't>s1']);

        const merge = new WorkflowModel([...TYPES, {type: 'm', label: 'M', inputs: [{id: 'main'}], outputs: [{id: 'main'}]}]);
        merge.addNode({id: 'x', type: 'trigger', x: 0, y: 0});
        merge.addNode({id: 'y', type: 'trigger', x: 0, y: 0});
        merge.addNode({id: 'mm', type: 'm', x: 0, y: 0});
        merge.addNode({id: 'z', type: 'single', x: 0, y: 0});
        merge.connect({node: 'x', port: 'main'}, {node: 'mm', port: 'main'});
        merge.connect({node: 'y', port: 'main'}, {node: 'mm', port: 'main'});
        merge.connect({node: 'mm', port: 'main'}, {node: 'z', port: 'main'});
        merge.removeNodes(['mm'], true);
        expect(merge.allConnections()).toEqual([]);
    });

    it('copies a fragment with its inner connections and pastes it under new ids', () => {
        const m = chain();
        const frag = m.fragment(['s1', 's2', 'missing']);

        expect(frag.nodes.map((n) => n.id)).toEqual(['s1', 's2']);
        expect(frag.connections.map((c) => c.id)).toEqual(['b']);

        const added = m.paste(frag, 40, 40);
        expect(added.nodes.length).toBe(2);
        expect(added.nodes.every((id) => !['s1', 's2'].includes(id))).toBe(true);
        expect(added.connections.length).toBe(1);
        const c = m.connection(added.connections[0]!)!;
        expect(added.nodes).toEqual([c.from.node, c.to.node]);
        expect(m.node(added.nodes[0]!)).toMatchObject({type: 'single', x: 40, y: 40});
    });

    it('toggles disabled and lists picker types by port kind', () => {
        const m = chain();
        expect(m.setDisabled(['s1', 's2'], true)).toEqual(['s1', 's2']);
        expect(m.setDisabled(['s1', 's3'], true)).toEqual(['s3']);

        const mm = model();
        expect(mm.typesFor({node: 't', port: 'main'}, 'out').map((t) => t.type)).toEqual(['if', 'single', 'agent']);
        expect(mm.typesFor({node: 'a', port: 'tool'}, 'in').map((t) => t.type)).toEqual(['tool']);
        expect(mm.typesFor({node: 't', port: 'nope'}, 'out')).toEqual([]);
    });
});

describe('WorkflowModel notes and insertion', () => {
    it('keeps notes in the document, shares the id space and omits an empty list', () => {
        const m = model();
        expect(m.toDocument().notes).toBeUndefined();

        const note = m.addNote({x: 10, y: 20, text: 'hello'});
        expect(note).toMatchObject({w: 240, h: 160, text: 'hello'});
        expect(() => m.addNote({id: 't', x: 0, y: 0})).toThrow(/exists/);
        expect(() => m.addNode({id: note.id, type: 'trigger', x: 0, y: 0})).toThrow(/exists/);

        m.updateNote(note.id, {text: 'bye', w: 300});
        expect(m.toDocument().notes).toEqual([{...note, text: 'bye', w: 300}]);

        const copy = new WorkflowModel(TYPES, m.toDocument());
        expect(copy.allNotes().length).toBe(1);
        expect(copy.removeNotes([note.id, 'nope'])).toEqual([note.id]);
        expect(copy.toDocument().notes).toBeUndefined();
    });

    it('copies and pastes notes with the nodes', () => {
        const m = model();
        const note = m.addNote({x: 100, y: 100, text: 'n'});
        const frag = m.fragment(['t', note.id]);

        expect(frag.notes?.map((n) => n.id)).toEqual([note.id]);
        const added = m.paste(frag, 40, 0);
        expect(added.notes.length).toBe(1);
        expect(m.note(added.notes[0]!)).toMatchObject({x: 140, y: 100, text: 'n'});
    });

    it('lists the connections inside an executed path', () => {
        const m = model();
        m.connect({node: 't', port: 'main'}, {node: 'if', port: 'main'}, 'p1');
        m.connect({node: 'if', port: 'true'}, {node: 's', port: 'main'}, 'p2');
        m.connect({node: 'if', port: 'false'}, {node: 'a', port: 'main'}, 'p3');

        expect(m.connectionsWithin(['t', 'if', 's']).map((c) => c.id)).toEqual(['p1', 'p2']);
        expect(m.connectionsWithin([])).toEqual([]);
    });

    it('knows which node types fit into a connection', () => {
        const m = model();
        const main = m.connect({node: 't', port: 'main'}, {node: 'if', port: 'main'});
        const tool = m.connect({node: 'tool', port: 'tool'}, {node: 'a', port: 'tool'});

        expect(m.canInsert('single', main.id)).toBe(true);
        expect(m.canInsert('trigger', main.id)).toBe(false);   // no input
        expect(m.canInsert('single', tool.id)).toBe(false);    // kinds differ
        expect(m.canInsert('nope', main.id)).toBe(false);
    });
});

describe('WorkflowGeometry', () => {
    it('places a new node beside a port, clear of other nodes', () => {
        const size = {w: 200, h: 64};
        expect(G.placeNear({x: 300, y: 132, side: 'right'}, size, [], 20)).toEqual({x: 380, y: 100});
        expect(G.placeNear({x: 100, y: 64, side: 'bottom'}, size, [], 20)).toEqual({x: 0, y: 140});

        // A node sits exactly there: move down by height + 40 until free.
        const blocker = {x: 380, y: 100, w: 200, h: 64};
        expect(G.placeNear({x: 300, y: 132, side: 'right'}, size, [blocker], 20)).toEqual({x: 380, y: 200});
        expect(G.placeNear({x: 300, y: 132, side: 'right'}, size, [blocker, {...blocker, y: 200}], 20)).toEqual({x: 380, y: 300});
    });

    it('sizes nodes for their ports and spreads ports along each side', () => {
        const ifType = TYPES[1]!;
        expect(G.nodeSize(ifType)).toEqual({w: 200, h: 72});
        expect(G.nodeSize(undefined)).toEqual({w: 200, h: 64});

        const places = G.placePorts(ifType, {x: 100, y: 100, w: 200, h: 90});
        expect(places.get('in:main')).toMatchObject({x: 100, y: 145, side: 'left', dir: 'in'});
        expect(places.get('out:true')).toMatchObject({x: 300, y: 130, side: 'right'});
        expect(places.get('out:false')).toMatchObject({x: 300, y: 160, side: 'right'});

        const agent = G.placePorts(TYPES[3]!, {x: 0, y: 0, w: 200, h: 64});
        expect(agent.get('in:tool')).toMatchObject({x: 100, y: 64, side: 'bottom'});
    });

    it('curves forward connections and detours backward ones around the nodes', () => {
        const forward = G.connectionPath({x: 0, y: 0, side: 'right'}, {x: 200, y: 0, side: 'left'});
        expect(forward.d.startsWith('M 0 0 C')).toBe(true);
        expect(forward.mid).toEqual({x: 100, y: 0});

        // Target behind the source, same row: the path runs under both nodes.
        const aRect = {x: 300, y: 0, w: 200, h: 64};
        const bRect = {x: 0, y: 0, w: 200, h: 64};
        const back = G.connectionPath({x: 500, y: 32, side: 'right'}, {x: 0, y: 32, side: 'left'}, aRect, bRect);
        expect(back.d).not.toContain('C');
        expect(back.mid.y).toBeGreaterThan(64);
        expect(back.mid.x).toBe(250);

        // Target behind and clearly below: the path runs between the rows.
        const below = G.connectionPath({x: 500, y: 32, side: 'right'}, {x: 0, y: 332, side: 'left'}, aRect, {...bRect, y: 300});
        expect(below.mid.y).toBe(182);
    });

    it('labels item counts', () => {
        expect(G.itemsLabel(0)).toBe('0 items');
        expect(G.itemsLabel(1)).toBe('1 item');
        expect(G.itemsLabel(12)).toBe('12 items');
    });

    it('rounds polyline corners without overshooting short segments', () => {
        expect(G.roundedPath([{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 100}], 10))
            .toBe('M 0 0 L 90 0 Q 100 0 100 10 L 100 100');
        expect(G.roundedPath([{x: 0, y: 0}, {x: 4, y: 0}, {x: 4, y: 100}], 10))
            .toBe('M 0 0 L 2 0 Q 4 0 4 2 L 4 100');
    });
});
