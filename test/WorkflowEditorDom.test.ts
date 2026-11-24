// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkflowEditor } from '../src/workflow/WorkflowEditor';
import { WorkflowDocument } from '../src/workflow/WorkflowTypes';
import { FakeCanvas } from './support/FakeCanvas';

/*
 * The editor through its DOM: rendering, pointer gestures, keys, inline
 * editors, run status and groups — the parts that live in the editor's
 * internal collaborators.
 */

const doc: WorkflowDocument = {
    nodes: [
        {id: 'n1', type: 't', x: 0, y: 0},
        {id: 'n2', type: 't', x: 400, y: 0}
    ],
    connections: [{id: 'c1', from: {node: 'n1', port: 'out'}, to: {node: 'n2', port: 'in'}}]
};

const editors: WorkflowEditor[] = [];

const editor = (): WorkflowEditor => {
    const ed = new WorkflowEditor(document.body.appendChild(document.createElement('div')), {
        types: [{type: 't', label: 'T', inputs: [{id: 'in'}], outputs: [{id: 'out'}]}],
        document: structuredClone(doc),
        fitOnLoad: false,
        minimap: true
    });
    const root = ed.element as HTMLElement & {setPointerCapture: unknown; hasPointerCapture: unknown};

    root.setPointerCapture = (): void => undefined;     // happy-dom has no pointer capture
    root.hasPointerCapture = (): boolean => false;
    editors.push(ed);

    return ed;
};

const q = (ed: WorkflowEditor, selector: string): HTMLElement | null => ed.element.querySelector<HTMLElement>(selector);

const pointer = (el: Element, type: string, x: number, y: number, init: PointerEventInit = {}): void => {
    el.dispatchEvent(new PointerEvent(type, {bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1, ...init}));
};

const key = (el: Element, k: string, init: KeyboardEventInit = {}): void => {
    el.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key: k, ...init}));
};

beforeAll(() => FakeCanvas.install());

afterEach(() => {
    editors.splice(0).forEach((ed) => ed.destroy());
});

describe('WorkflowEditor DOM', () => {
    it('renders nodes, ports and the connection', () => {
        const ed = editor();

        expect(ed.element.querySelectorAll('[data-wf-node]').length).toBe(2);
        expect(q(ed, '[data-wf-conn="c1"] path.wf-conn')?.getAttribute('d')).toMatch(/^M/);
        expect(ed.element.querySelectorAll('.wf-port.wf-connected').length).toBe(2);
    });

    it('drags a node with grid snap as one move, clicks select', () => {
        const ed = editor();
        const changes = vi.fn();
        const body = q(ed, '[data-wf-node="n1"] .wf-node-body')!;

        ed.on('change', changes);
        pointer(body, 'pointerdown', 10, 10);
        expect(ed.getSelection().nodes).toEqual(['n1']);
        expect(q(ed, '[data-wf-node="n1"]')!.classList.contains('wf-selected')).toBe(true);
        pointer(ed.element, 'pointermove', 50, 10);
        pointer(ed.element, 'pointermove', 113, 47);
        pointer(ed.element, 'pointerup', 113, 47);

        expect(ed.getNode('n1')).toMatchObject({x: 100, y: 40});
        expect(changes.mock.calls.map((c) => c[0])).toEqual([{kind: 'move', nodes: ['n1'], connections: []}]);
        expect(ed.undo()).toBe(true);
        expect(ed.getNode('n1')).toMatchObject({x: 0, y: 0});
    });

    it('Escape during a drag puts the node back without a change', () => {
        const ed = editor();
        const changes = vi.fn();

        ed.on('change', changes);
        pointer(q(ed, '[data-wf-node="n2"] .wf-node-body')!, 'pointerdown', 0, 0);
        pointer(ed.element, 'pointermove', 80, 80);
        expect(ed.getNode('n2')).toMatchObject({x: 480, y: 80});
        key(ed.element, 'Escape');
        pointer(ed.element, 'pointerup', 80, 80);

        expect(ed.getNode('n2')).toMatchObject({x: 400, y: 0});
        expect(changes).not.toHaveBeenCalled();
    });

    it('a background click clears the selection and reports world coordinates', () => {
        const ed = editor();
        const clicks = vi.fn();

        ed.select(['n1']);
        ed.on('backgroundClick', clicks);
        pointer(ed.element, 'pointerdown', 30, 40);
        pointer(ed.element, 'pointerup', 30, 40);

        expect(ed.getSelection().nodes).toEqual([]);
        expect(clicks.mock.calls[0]![0]).toMatchObject({x: 30, y: 40});
    });

    it('keys: select all, delete with bridging, undo, redo, disable', () => {
        const ed = editor();

        key(ed.element, 'a', {ctrlKey: true});
        expect(ed.getSelection().nodes.sort()).toEqual(['n1', 'n2']);

        ed.select(['n2']);
        key(ed.element, 'd');
        expect(ed.getNode('n2')?.disabled).toBe(true);
        expect(q(ed, '[data-wf-conn="c1"]')!.classList.contains('wf-off')).toBe(true);

        key(ed.element, 'Delete');
        expect(ed.getNode('n2')).toBeUndefined();
        expect(q(ed, '[data-wf-conn="c1"]')).toBeNull();

        key(ed.element, 'z', {ctrlKey: true});
        expect(ed.getNode('n2')).toBeDefined();
        key(ed.element, 'y', {ctrlKey: true});
        expect(ed.getNode('n2')).toBeUndefined();
    });

    it('the viewer ignores editing keys', () => {
        const ed = editor();

        ed.setReadOnly(true);
        ed.select(['n1']);
        key(ed.element, 'Delete');
        expect(ed.getNode('n1')).toBeDefined();
        expect(ed.element.classList.contains('wf-editable')).toBe(false);
    });

    it('copy and paste through the API offset the copy and select it', () => {
        const ed = editor();

        ed.select(['n1', 'n2']);
        const fragment = ed.copySelection()!;
        const added = ed.paste(WorkflowEditor.parseFragment(JSON.stringify(fragment))!);

        expect(added.length).toBe(2);
        expect(ed.getSelection().nodes.sort()).toEqual([...added].sort());
        expect(added.map((id) => ed.getNode(id)!.x).sort((a, b) => a - b)).toEqual([40, 440]);
        expect(ed.getDocument().connections.length).toBe(2);
        expect(WorkflowEditor.parseFragment('not json')).toBeNull();
    });

    it('edits a connection label and a note text in place', () => {
        const ed = editor();
        const changes = vi.fn();

        ed.on('change', changes);
        ed.editConnectionLabel('c1');
        const input = q(ed, 'input.wf-conn-text-edit') as HTMLInputElement;
        input.value = 'yes';
        key(input, 'Enter');

        expect(q(ed, 'input.wf-conn-text-edit')).toBeNull();
        expect(q(ed, '.wf-conn-text')?.textContent).toBe('yes');
        expect(ed.getDocument().connections[0]!.label).toBe('yes');

        const note = ed.addNote({x: -300, y: 0});
        ed.editNote(note.id);
        const area = q(ed, 'textarea.wf-note-edit') as HTMLTextAreaElement;
        area.value = 'hello';
        key(area, 'Enter', {ctrlKey: true});

        expect(ed.getNote(note.id)?.text).toBe('hello');
        expect(changes.mock.calls.map((c) => c[0].kind)).toEqual(['updateConnection', 'addNote', 'updateNote']);
    });

    it('run status, run path and recording', () => {
        const ed = editor();

        ed.startRecording();
        ed.setNodeStatus('n1', 'error', {message: 'boom'});
        ed.setConnectionStatus('c1', {items: 3, active: true});
        ed.setRunPath(['n1']);

        const n1 = q(ed, '[data-wf-node="n1"]')!;
        expect(n1.classList.contains('wf-st-error')).toBe(true);
        expect(n1.querySelector('.wf-badge')?.getAttribute('title')).toBe('boom');
        expect(q(ed, '[data-wf-node="n2"]')!.classList.contains('wf-dim')).toBe(true);
        expect(q(ed, '[data-wf-conn="c1"]')!.classList.contains('wf-dim')).toBe(true);
        expect(q(ed, '.wf-conn-label')?.textContent).toBeTruthy();
        expect(q(ed, '[data-wf-conn="c1"] .wf-dots')).not.toBeNull();

        ed.clearStatus();
        expect(n1.classList.contains('wf-st-error')).toBe(false);
        expect(q(ed, '[data-wf-node="n2"]')!.classList.contains('wf-dim')).toBe(false);
        expect(ed.getNodeStatus('n1')).toBe('idle');

        const events = ed.stopRecording();
        expect(events.map((e) => Object.keys(e).filter((k) => k !== 'at')[0])).toEqual(['node', 'connection', 'runPath', 'clear']);
        expect(ed.isRecording).toBe(false);
    });

    it('groups collapse into one node and expand again', () => {
        const ed = editor();
        const group = ed.group(['n1', 'n2'])!;

        expect(q(ed, `[data-wf-group-frame="${group.id}"]`)).not.toBeNull();
        expect(ed.setGroupCollapsed(group.id, true)).toBe(true);
        expect(q(ed, '[data-wf-node="n1"]')).toBeNull();
        expect(q(ed, `[data-wf-group="${group.id}"]`)).not.toBeNull();
        expect(q(ed, '[data-wf-conn="c1"]')).toBeNull();     // internal to the collapsed group

        ed.setNodeStatus('n1', 'running');
        expect(q(ed, `[data-wf-group="${group.id}"]`)!.classList.contains('wf-st-running')).toBe(true);

        expect(ed.toggleGroup(group.id)).toBe(true);
        expect(q(ed, '[data-wf-node="n1"]')).not.toBeNull();
        expect(q(ed, '[data-wf-conn="c1"]')).not.toBeNull();
        expect(ed.undo()).toBe(true);
        expect(ed.getGroup(group.id)?.collapsed).toBe(true);
    });

    it('insertNode splits a connection and makes room', () => {
        const ed = editor();
        const node = ed.insertNode('c1', {type: 't'})!;
        const conns = ed.getDocument().connections;

        expect(conns.some((c) => c.from.node === 'n1' && c.to.node === node.id)).toBe(true);
        expect(conns.some((c) => c.from.node === node.id && c.to.node === 'n2')).toBe(true);
        expect(ed.getSelection().nodes).toEqual([node.id]);
        expect(ed.element.querySelectorAll('[data-wf-node]').length).toBe(3);
    });
});
