// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowEditor } from '../src/workflow/WorkflowEditor';
import { WorkflowDocument } from '../src/workflow/WorkflowTypes';

/** rAF under test control: frames run only when `step` is called. */
let frames: Array<FrameRequestCallback | null> = [];
let now = 0;
const step = (ms: number): void => {
    now += ms;
    const run = frames;
    frames = [];
    run.forEach((cb) => cb?.(now));
};

beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', (h: number) => {
        frames[h - 1] = null;
    });
});

afterEach(() => vi.unstubAllGlobals());

const doc: WorkflowDocument = {
    nodes: [
        {id: 'n1', type: 't', x: 600, y: 400},
        {id: 'n2', type: 't', x: 0, y: 0}
    ],
    connections: [{id: 'c1', from: {node: 'n1', port: 'out'}, to: {node: 'n2', port: 'in'}}]
};

const editor = (): WorkflowEditor => new WorkflowEditor(document.body.appendChild(document.createElement('div')), {
    types: [{type: 't', label: 'T', inputs: [{id: 'in'}], outputs: [{id: 'out'}]}],
    document: structuredClone(doc),
    fitOnLoad: false
});

const positions = (ed: WorkflowEditor): string =>
    ed.getDocument().nodes.map((n) => `${n.id}:${n.x},${n.y}`).join(' ');

describe('WorkflowEditor tidy-up animation', () => {
    it('undo during the animation takes the tidy-up back and is not overwritten', () => {
        const ed = editor();
        const before = positions(ed);

        ed.tidyUp();
        step(16);
        step(100);                     // mid-animation
        expect(ed.undo()).toBe(true);
        step(16);
        step(400);                     // any frame left over must not move anything

        expect(positions(ed)).toBe(before);
        expect(ed.redo()).toBe(true);
        expect(positions(ed)).not.toBe(before);
        ed.destroy();
    });

    it('a new document during the animation is left alone', () => {
        const ed = editor();
        const changes = vi.fn();
        ed.on('change', changes);

        ed.tidyUp();
        step(16);
        step(100);
        ed.setDocument(structuredClone(doc));
        const loaded = positions(ed);
        step(16);
        step(400);

        expect(positions(ed)).toBe(loaded);
        expect(changes.mock.calls.map((c) => c[0].kind)).toEqual(['load']);
        ed.destroy();
    });

    it('deleting a node during the animation does not crash the remaining frames', () => {
        const ed = editor();

        ed.tidyUp();
        step(16);
        step(100);
        ed.removeNodes(['n2']);

        expect(() => {
            step(16);
            step(400);
        }).not.toThrow();
        expect(ed.getDocument().nodes.map((n) => n.id)).toEqual(['n1']);
        ed.destroy();
    });
});
