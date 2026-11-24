// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HoloTable } from '../src/chart/HoloTable';
import { IsoEditor } from '../src/iso/IsoEditor';
import { ModelInteraction } from '../src/modelview/ModelInteraction';
import { ModelView } from '../src/modelview/ModelView';
import { RectBoard } from '../src/rect/RectBoard';
import { Camera } from '../src/view/Camera';
import { TileCalendar } from '../src/widget/TileCalendar';
import { WorkflowEditor } from '../src/workflow/WorkflowEditor';
import { WorkflowKeyboard } from '../src/workflow/WorkflowKeyboard';
import { FakeCanvas } from './support/FakeCanvas';

beforeAll(() => {
    FakeCanvas.install();
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    proto.setPointerCapture ??= () => undefined;
    proto.releasePointerCapture ??= () => undefined;
    proto.hasPointerCapture ??= () => false;
});

const cleanups: Array<() => void> = [];

afterEach(() => {
    cleanups.splice(0).forEach((c) => c());
    vi.unstubAllGlobals();
});

const host = (): HTMLElement => document.body.appendChild(document.createElement('div'));

/** rAF under test control: `flush` runs the queued frames once. */
const frames = (): {count(): number; flush(): void} => {
    let queue: FrameRequestCallback[] = [];
    let total = 0;

    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        queue.push(cb);
        total++;
        return total;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    return {
        count: () => queue.length,
        flush: () => {
            const run = queue;
            queue = [];
            run.forEach((cb) => cb(performance.now()));
        }
    };
};

describe('ModelView render loop', () => {
    it('idles without animated flows and keeps going with them', () => {
        const raf = frames();
        const view = new ModelView(host());
        cleanups.push(() => view.destroy());

        view.setData({modules: [{id: 'a', label: 'A'}, {id: 'b', label: 'B'}], flows: [{source: 'a', target: 'b'}]});
        raf.flush();
        expect(raf.count()).toBe(0);

        view.setData({modules: [{id: 'a', label: 'A'}, {id: 'b', label: 'B'}], flows: [{source: 'a', target: 'b', animated: true}]});
        raf.flush();
        expect(raf.count()).toBe(1);

        view.setAnimate(false);
        raf.flush();
        expect(raf.count()).toBe(0);
    });
});

describe('ModelInteraction pointercancel', () => {
    it('ends the pan without a click', () => {
        const canvas = host().appendChild(document.createElement('canvas'));
        const onClick = vi.fn();
        const interaction = new ModelInteraction(canvas, new Camera(), () => [], {
            onHover: () => undefined, onClick, onCameraChange: () => undefined
        });
        cleanups.push(() => interaction.destroy());
        const fire = (type: string): boolean => canvas.dispatchEvent(new PointerEvent(type, {clientX: 5, clientY: 5, pointerId: 1}));

        fire('pointerdown');
        fire('pointercancel');
        fire('pointerup');
        expect(onClick).not.toHaveBeenCalled();

        fire('pointerdown');
        fire('pointerup');
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

describe('HoloTable camera', () => {
    it('keeps given start fields through the auto-fit and ignores bad values', () => {
        const table = new HoloTable(host(), {camera: {yaw: 30}});
        cleanups.push(() => table.destroy());
        (table as unknown as {draw(ctx: unknown, now: number): boolean}).draw(document.createElement('canvas').getContext('2d'), 0);

        expect(table.getCamera().yaw).toBe(30);
        expect(table.getCamera().ty).toBeLessThanOrEqual(0);

        table.setCamera({pitch: Number.NaN, distance: 1e9, yaw: Infinity}, {animate: false});
        const cam = table.getCamera();
        expect(cam.yaw).toBe(30);
        expect(Number.isFinite(cam.pitch)).toBe(true);
        expect(cam.distance).toBe(20000);
    });
});

describe('TileCalendar months', () => {
    it('shows at least one month', () => {
        const cal = new TileCalendar(host(), {start: {year: 2026, month: 0}, months: 0});
        cleanups.push(() => cal.destroy());
        const months = (): number => (cal as unknown as {months: number}).months;

        expect(months()).toBe(1);
        cal.setMonths({year: 2026, month: 0}, Number.NaN);
        expect(months()).toBe(1);
        cal.setMonths({year: 2026, month: 0}, 2.7);
        expect(months()).toBe(2);
    });
});

describe('workflow paste', () => {
    it('drops malformed fragment entries', () => {
        expect(WorkflowKeyboard.parseFragment('{"format":"jsngraph-workflow","nodes":[{"id":"x"}],"connections":[{}]}'))
            .toEqual({format: 'jsngraph-workflow', version: 1, nodes: [], connections: [], notes: [], groups: []});

        const ed = new WorkflowEditor(host(), {types: [{type: 't', label: 'T', inputs: [{id: 'in'}], outputs: [{id: 'out'}]}], fitOnLoad: false});
        cleanups.push(() => ed.destroy());
        const added = ed.paste({
            nodes: [{id: 'a', type: 't', x: 0, y: 0}, {id: 'b', type: 't'} as never, null as never],
            connections: [{id: 'c', from: {node: 'a', port: 'out'}} as never],
            notes: [{id: 'n'} as never],
            groups: [{id: 'g'} as never]
        });

        expect(added).toHaveLength(1);
        expect(ed.getDocument().nodes).toHaveLength(1);
        expect(ed.getDocument().connections).toHaveLength(0);
    });
});

describe('IsoEditor ids', () => {
    it('refuses an id that is already taken', () => {
        const ed = new IsoEditor(host());
        cleanups.push(() => ed.destroy());

        ed.addItem({id: 'a', icon: 'server', tile: {x: 0, y: 0}});
        expect(() => ed.addItem({id: 'a', icon: 'server', tile: {x: 2, y: 2}})).toThrow(/already exists/);
        expect(() => ed.addText({x: 3, y: 3}, 'hi', {id: 'a'})).toThrow(/already exists/);
        expect(ed.addItem({icon: 'server', tile: {x: 4, y: 4}})).not.toBe('a');
        expect(ed.getDocument().items).toHaveLength(2);
    });
});

describe('RectBoard story keys', () => {
    it('leave form fields, modifiers and handled keys alone', () => {
        const viewport = host();
        Object.defineProperty(viewport, 'clientWidth', {value: 800});
        const board = new RectBoard(viewport);
        cleanups.push(() => board.destroy());
        const box = document.createElement('div');
        board.add(box, 0, 0, 'one');
        board.add(document.createElement('div'), 400, 0, 'two');
        board.story(['one', 'two']);

        const input = host().appendChild(document.createElement('input'));
        input.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}));
        window.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', ctrlKey: true}));
        expect(board.stepIndex).toBe(-1);

        window.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown'}));
        expect(board.stepIndex).toBe(0);
    });
});
