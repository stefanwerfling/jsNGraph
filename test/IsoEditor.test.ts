// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IsoEditor } from '../src/iso/IsoEditor';
import { IsoDocument } from '../src/iso/IsoTypes';
import { FakeCanvas } from './support/FakeCanvas';

/*
 * Editor behaviour through its DOM: pointer gestures, keyboard, clipboard,
 * label editor, live status. The camera stays at identity (happy-dom has no
 * layout, so `fit` is a no-op): screen = world, tile (x, y) centre =
 * ((x − y) · 50, (x + y + 1) · 25).
 */

const doc = (): IsoDocument => ({
    items: [
        {id: 'a', icon: 'server', tile: {x: 0, y: 0}, label: 'A', description: 'first'},
        {id: 'b', icon: 'database', tile: {x: 4, y: 0}, label: 'B'}
    ],
    connectors: [{id: 'l', from: {item: 'a'}, to: {item: 'b'}, label: 'link', style: 'dashed', animated: true, arrows: 'both'}],
    regions: [{id: 'r', from: {x: -1, y: -1}, to: {x: 6, y: 3}, label: 'Zone', wall: 2, doors: [{x: 2, y: -1}]}],
    texts: [{id: 't', tile: {x: 0, y: 5}, text: 'note', axis: 'y'}]
});

const centre = (x: number, y: number): {clientX: number; clientY: number} => ({clientX: (x - y) * 50, clientY: (x + y + 1) * 25});

const pointer = (type: string, target: Element, at: {clientX: number; clientY: number}, extra: PointerEventInit = {}): void => {
    target.dispatchEvent(new PointerEvent(type, {bubbles: true, button: 0, pointerId: 1, ...at, ...extra}));
};

const make = (opts: ConstructorParameters<typeof IsoEditor>[1] = {}): IsoEditor => {
    const host = document.body.appendChild(document.createElement('div'));
    const ed = new IsoEditor(host, {document: doc(), ...opts});
    const root = ed.element as HTMLDivElement & {setPointerCapture: unknown; hasPointerCapture: unknown; releasePointerCapture: unknown};

    root.setPointerCapture = (): void => undefined;
    root.hasPointerCapture = (): boolean => false;
    root.releasePointerCapture = (): void => undefined;

    return ed;
};

const q = (ed: IsoEditor, sel: string): HTMLElement => ed.element.querySelector<HTMLElement>(sel)!;

beforeEach(() => {
    FakeCanvas.install();
    if (typeof ResizeObserver === 'undefined') {
        vi.stubGlobal('ResizeObserver', class {
            public observe(): void {}
            public disconnect(): void {}
        });
    }
});

afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});

describe('IsoEditor rendering', () => {
    it('draws items, callouts, bases, regions with walls, texts and connectors', () => {
        const ed = make();
        expect(ed.element.querySelectorAll('.iso-item').length).toBe(2);
        expect(ed.element.querySelectorAll('.iso-label').length).toBe(2);
        expect(ed.element.querySelectorAll('.iso-base').length).toBe(2);
        expect(ed.element.querySelectorAll('.iso-region').length).toBe(1);
        expect(ed.element.querySelectorAll('.iso-wall').length).toBeGreaterThan(0);
        expect(q(ed, '.iso-text').dataset.text).toBe('t');
        expect(q(ed, '.iso-conn').dataset.connector).toBe('l');
        expect(ed.element.querySelectorAll('.iso-conn polygon').length).toBe(2);
        expect(q(ed, '.iso-conn-label').textContent).toBe('link');
        expect(ed.element.dataset.isoMode).toBe('select');
        ed.destroy();
    });

    it('selection shows region corner and connector handles; highlight dims the rest', () => {
        const ed = make();
        ed.select(['r']);
        expect(ed.element.querySelectorAll('.iso-handle').length).toBe(4);
        ed.select(['l']);
        expect(ed.element.querySelectorAll('.iso-handle-end').length).toBe(2);
        expect(q(ed, '.iso-conn').classList.contains('iso-selected')).toBe(true);
        ed.highlight(['a']);
        expect(q(ed, '.iso-item[data-item="b"]').classList.contains('iso-dim')).toBe(true);
        expect(q(ed, '.iso-item[data-item="a"]').classList.contains('iso-dim')).toBe(false);
        expect(q(ed, '.iso-conn').classList.contains('iso-dim')).toBe(true);
        ed.highlight(['a', 'b']);
        expect(q(ed, '.iso-conn').classList.contains('iso-dim')).toBe(false);
        ed.setReadOnly(true);
        expect(ed.element.querySelectorAll('.iso-handle').length).toBe(0);
        expect(ed.element.dataset.isoMode).toBe('view');
        ed.destroy();
    });
});

describe('IsoEditor live state', () => {
    it('item and connector status, actors kept per id', () => {
        const ed = make();
        ed.setItemStatus('a', {state: 'down', message: 'offline', progress: 0.5});
        expect(q(ed, '.iso-status-ring').dataset.status).toBe('a');
        expect(q(ed, '.iso-label[data-item="a"] .iso-st').textContent).toBe('offline');
        expect(q(ed, '.iso-progress b').style.width).toBe('50%');
        ed.setConnectorStatus('l', {active: false, color: 'red'});
        expect(q(ed, '.iso-conn').classList.contains('iso-conn-off')).toBe(true);
        // a re-render keeps the status
        ed.updateItem('b', {label: 'B2'});
        expect(ed.element.querySelectorAll('.iso-status-ring').length).toBe(1);
        expect(q(ed, '.iso-conn').classList.contains('iso-conn-off')).toBe(true);
        ed.clearStatus();
        expect(ed.element.querySelectorAll('.iso-status-ring').length).toBe(0);
        expect(q(ed, '.iso-conn').classList.contains('iso-conn-off')).toBe(false);

        ed.setActors([{id: 'x', icon: 'box', u: 1, v: 1}]);
        const el = q(ed, '[data-actor="x"]');
        ed.setActors([{id: 'x', icon: 'box', u: 2, v: 1}, {id: 'y', icon: 'box', u: 0, v: 0}]);
        expect(q(ed, '[data-actor="x"]')).toBe(el);
        ed.setActors([{id: 'y', icon: 'box', u: 0, v: 0}]);
        expect(ed.element.querySelector('[data-actor="x"]')).toBeNull();
        ed.destroy();
    });
});

describe('IsoEditor gestures', () => {
    it('click selects an item and emits itemClick; floor click clears', () => {
        const ed = make();
        const clicks: string[] = [];
        ed.on('itemClick', (e) => clicks.push(e.item.id));
        const floor: unknown[] = [];
        ed.on('floorClick', (e) => floor.push(e.tile));
        const item = q(ed, '.iso-item[data-item="a"]');
        pointer('pointerdown', item, centre(0, 0));
        pointer('pointerup', item, centre(0, 0));
        expect(clicks).toEqual(['a']);
        expect(ed.getSelection()).toEqual(['a']);
        pointer('pointerdown', ed.element, centre(10, 10));
        pointer('pointerup', ed.element, centre(10, 10));
        expect(ed.getSelection()).toEqual([]);
        expect(floor).toEqual([{x: 10, y: 10}]);
        ed.destroy();
    });

    it('drag moves an item with tile snap as one undo step', () => {
        const ed = make();
        const changes: string[] = [];
        ed.on('change', (c) => changes.push(c.kind));
        const item = q(ed, '.iso-item[data-item="a"]');
        pointer('pointerdown', item, centre(0, 0));
        // the item element is redrawn while dragging; the root keeps receiving the (captured) pointer
        pointer('pointermove', ed.element, centre(1, 0));
        pointer('pointermove', ed.element, centre(2, 1));
        expect(ed.getDocument().items[0]!.tile).toEqual({x: 2, y: 1});
        pointer('pointerup', ed.element, centre(2, 1));
        expect(changes).toEqual(['move']);
        expect(ed.undo()).toBe(true);
        expect(ed.getDocument().items[0]!.tile).toEqual({x: 0, y: 0});
        ed.destroy();
    });

    it('drag on the floor pans the camera', () => {
        const ed = make();
        pointer('pointerdown', ed.element, {clientX: 400, clientY: 400});
        pointer('pointermove', ed.element, {clientX: 420, clientY: 410});
        pointer('pointerup', ed.element, {clientX: 420, clientY: 410});
        expect(ed.getViewport()).toMatchObject({offsetX: 20, offsetY: 10});
        ed.destroy();
    });

    it('shift-drag lassos items', () => {
        const ed = make();
        pointer('pointerdown', ed.element, {clientX: -100, clientY: -100}, {shiftKey: true});
        pointer('pointermove', ed.element, {clientX: 300, clientY: 200}, {shiftKey: true});
        pointer('pointerup', ed.element, {clientX: 300, clientY: 200});
        expect(ed.getSelection().sort()).toEqual(['a', 'b', 'l']);
        ed.destroy();
    });

    it('connect mode: two clicks add a connector; region mode: drag adds a region', () => {
        const ed = make({mode: 'connect'});
        const a = q(ed, '.iso-item[data-item="a"]');
        pointer('pointerdown', a, centre(0, 0));
        pointer('pointerup', a, centre(0, 0));
        pointer('pointermove', ed.element, centre(2, 3));
        expect(ed.element.querySelector('.iso-draft-line')).not.toBeNull();
        pointer('pointerdown', ed.element, centre(2, 3));
        pointer('pointerup', ed.element, centre(2, 3));
        const conns = ed.getDocument().connectors!;
        expect(conns).toHaveLength(2);
        expect(conns[1]).toMatchObject({from: {item: 'a'}, to: {tile: {x: 2, y: 3}}});
        expect(ed.getSelection()).toEqual([conns[1]!.id]);

        ed.setMode('region');
        pointer('pointerdown', ed.element, centre(8, 8));
        pointer('pointermove', ed.element, centre(9, 8));
        pointer('pointermove', ed.element, centre(10, 9));
        expect(ed.element.querySelector('.iso-draft-region')).not.toBeNull();
        pointer('pointerup', ed.element, centre(10, 9));
        const reg = ed.getDocument().regions!;
        expect(reg[1]).toMatchObject({from: {x: 8, y: 8}, to: {x: 10, y: 9}});
        ed.destroy();
    });

    it('dragging a region corner resizes it', () => {
        const ed = make();
        ed.select(['r']);
        const corner = q(ed, '.iso-handle[data-handle="corner|r|2"]');
        // corner 2 is the far one (x1 + 1, y1 + 1); drop it on grid point (9, 5)
        pointer('pointerdown', corner, {clientX: (7 - 4) * 50, clientY: (7 + 4) * 25});
        pointer('pointermove', corner, {clientX: (9 - 5) * 50, clientY: (9 + 5) * 25});
        pointer('pointerup', corner, {clientX: (9 - 5) * 50, clientY: (9 + 5) * 25});
        expect(ed.getDocument().regions![0]).toMatchObject({from: {x: -1, y: -1}, to: {x: 8, y: 4}});
        ed.destroy();
    });

    it('double-click an item opens the label editor; Enter commits', () => {
        const ed = make();
        const dbl: string[] = [];
        ed.on('itemDblClick', (e) => dbl.push(e.item.id));
        q(ed, '.iso-item[data-item="a"]').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
        expect(dbl).toEqual(['a']);
        const input = q(ed, '.iso-input') as HTMLInputElement;
        expect(input.value).toBe('A');
        input.value = 'Alpha';
        input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
        expect(ed.element.querySelector('.iso-input')).toBeNull();
        expect(ed.getDocument().items[0]!.label).toBe('Alpha');
        ed.destroy();
    });

    it('wheel zooms', () => {
        const ed = make();
        const wheel = new WheelEvent('wheel', {clientX: 0, clientY: 0, cancelable: true});
        Object.defineProperties(wheel, {deltaY: {value: -200}, clientX: {value: 0}, clientY: {value: 0}});
        ed.element.dispatchEvent(wheel);
        expect(ed.getViewport().scale).toBeGreaterThan(1);
        ed.destroy();
    });
});

describe('IsoEditor keyboard', () => {
    const key = (ed: IsoEditor, k: string, extra: KeyboardEventInit = {}): void => {
        ed.element.dispatchEvent(new KeyboardEvent('keydown', {key: k, bubbles: true, cancelable: true, ...extra}));
    };

    it('arrows move, Delete removes, Ctrl+Z undoes, letters switch modes, Escape returns to select', () => {
        const ed = make();
        ed.select(['a']);
        key(ed, 'ArrowDown');
        expect(ed.getDocument().items[0]!.tile).toEqual({x: 0, y: 1});
        key(ed, 'z', {ctrlKey: true});
        expect(ed.getDocument().items[0]!.tile).toEqual({x: 0, y: 0});
        key(ed, 'Delete');
        expect(ed.getDocument().items.map((i) => i.id)).toEqual(['b']);
        expect(ed.getDocument().connectors).toEqual([]);
        key(ed, 'y', {ctrlKey: true});
        key(ed, 'z', {ctrlKey: true});
        expect(ed.getDocument().items).toHaveLength(2);
        key(ed, 'c');
        expect(ed.getMode()).toBe('connect');
        key(ed, 'Escape');
        expect(ed.getMode()).toBe('select');
        key(ed, 'a', {ctrlKey: true});
        expect(ed.getSelection()).toHaveLength(5);
        key(ed, 'Escape');
        expect(ed.getSelection()).toEqual([]);
        ed.select(['b']);
        key(ed, 'd', {ctrlKey: true});
        expect(ed.getDocument().items).toHaveLength(3);
        ed.destroy();
    });

    it('read-only ignores editing keys', () => {
        const ed = make({readOnly: true});
        ed.select(['a']);
        key(ed, 'Delete');
        expect(ed.getDocument().items).toHaveLength(2);
        ed.destroy();
    });
});
