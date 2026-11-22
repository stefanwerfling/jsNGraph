import { describe, expect, it } from 'vitest';
import { WorkflowRun } from '../src/workflow/WorkflowRun';
import { WorkflowRunEvent } from '../src/workflow/WorkflowTypes';

const RUN: WorkflowRunEvent[] = [
    {at: 0, clear: true},
    {at: 0, node: 't', status: 'waiting'},
    {at: 10, node: 't', status: 'running'},
    {at: 500, node: 't', status: 'success'},
    {at: 500, connection: 'c1', state: {items: 3, active: true}},
    {at: 500, node: 'a', status: 'waiting'},
    {at: 520, node: 'a', status: 'running'},
    {at: 9000, node: 'a', status: 'error', message: 'timeout'},
    {at: 9000, connection: 'c1', state: {items: 3, status: 'success'}},
    {at: 9000, runPath: {nodes: ['t', 'a'], connections: ['c1']}}
];

describe('WorkflowRun', () => {
    it('sorts by time, keeping the recorded order of equal times', () => {
        const shuffled = [RUN[3]!, RUN[1]!, RUN[0]!, RUN[4]!];

        expect(WorkflowRun.sorted(shuffled)).toEqual([RUN[1], RUN[0], RUN[3], RUN[4]]);   // both at 0: given order
        expect(WorkflowRun.duration(RUN)).toBe(9000);
        expect(WorkflowRun.duration([])).toBe(0);
        expect(WorkflowRun.steps(RUN)).toEqual([0, 10, 500, 520, 9000]);
        expect(WorkflowRun.errorTimes(RUN)).toEqual([9000]);
    });

    it('computes the state at a moment', () => {
        const mid = WorkflowRun.stateAt(RUN, 510);

        expect(mid.nodes.get('t')).toEqual({status: 'success'});
        expect(mid.nodes.get('a')).toEqual({status: 'waiting'});
        expect(mid.connections.get('c1')).toEqual({items: 3, active: true});
        expect(mid.runPath).toBeNull();

        const end = WorkflowRun.stateAt(RUN, 9000);

        expect(end.nodes.get('a')).toEqual({status: 'error', message: 'timeout'});
        expect(end.connections.get('c1')).toEqual({items: 3, status: 'success'});
        expect(end.runPath).toEqual({nodes: ['t', 'a'], connections: ['c1']});
        expect(WorkflowRun.stateAt(RUN, -1).nodes.size).toBe(0);
    });

    it('treats idle, null and clear as removal', () => {
        const s = WorkflowRun.stateAt([
            ...RUN,
            {at: 9100, node: 't', status: 'idle'},
            {at: 9100, connection: 'c1', state: null},
            {at: 9100, runPath: null}
        ], 9100);

        expect(s.nodes.has('t')).toBe(false);
        expect(s.connections.size).toBe(0);
        expect(s.runPath).toBeNull();
        expect(WorkflowRun.stateAt([...RUN, {at: 9500, clear: true}], 9500).nodes.size).toBe(0);
    });

    it('squeezes long pauses but keeps order and short gaps', () => {
        const c = WorkflowRun.compress(RUN.map((e) => ({...e, at: e.at + 1000})), 1000);

        expect(c.map((e) => e.at)).toEqual([0, 0, 10, 500, 500, 500, 520, 1520, 1520, 1520]);
    });
});
