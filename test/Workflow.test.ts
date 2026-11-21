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

        expect(m.removeNodes(['if']).length).toBe(2);
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

describe('WorkflowGeometry', () => {
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

    it('rounds polyline corners without overshooting short segments', () => {
        expect(G.roundedPath([{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 100}], 10))
            .toBe('M 0 0 L 90 0 Q 100 0 100 10 L 100 100');
        expect(G.roundedPath([{x: 0, y: 0}, {x: 4, y: 0}, {x: 4, y: 100}], 10))
            .toBe('M 0 0 L 2 0 Q 4 0 4 2 L 4 100');
    });
});
