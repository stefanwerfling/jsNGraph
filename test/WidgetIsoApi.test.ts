// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DayClock } from '../src/widget/DayClock';
import { DAY_MINUTES, DayClockGeometry } from '../src/widget/DayClockGeometry';
import { RingGauge } from '../src/widget/RingGauge';
import { WorldMap } from '../src/widget/WorldMap';
import { paletteColor, Widget, WidgetDom } from '../src/widget/WidgetBase';
import { IsoEditor } from '../src/iso/IsoEditor';
import { WorkflowEditor } from '../src/workflow/WorkflowEditor';
import { WORKFLOW_CURVE, WorkflowGeometry } from '../src/workflow/WorkflowGeometry';
import { FakeCanvas } from './support/FakeCanvas';

const host = (): HTMLDivElement => document.body.appendChild(document.createElement('div'));

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

describe('widget statics and deprecated aliases', () => {
    it('paletteColor is a static on Widget, the free export delegates', () => {
        expect(Widget.paletteColor(0)).toBe('var(--wg-c1)');
        expect(Widget.paletteColor(7)).toBe('var(--wg-c2)');
        expect(paletteColor(7)).toBe(Widget.paletteColor(7));
    });

    it('WidgetDom creates SVG elements and rounds numeric attributes', () => {
        const c = WidgetDom.svg('circle', {r: 3, class: 'x'});
        expect(c.namespaceURI).toBe('http://www.w3.org/2000/svg');
        expect(c.getAttribute('r')).toBe('3');
        WidgetDom.setAttrs(c, {cx: 1.23456, fill: 'red'});
        expect(c.getAttribute('cx')).toBe('1.23');
        expect(c.getAttribute('fill')).toBe('red');
    });

    it('module constants moved onto their classes keep their old exports', () => {
        expect(DayClockGeometry.DAY_MINUTES).toBe(1440);
        expect(DAY_MINUTES).toBe(DayClockGeometry.DAY_MINUTES);
        expect(WORKFLOW_CURVE).toEqual({factor: 0.5, min: 40, max: 220});
        expect(WORKFLOW_CURVE).toBe(WorkflowGeometry.CURVE);
    });
});

describe('DayClock on the Widget shell', () => {
    const now = new Date(2026, 10, 24, 12, 0);
    const item = {id: 'a', start: new Date(2026, 10, 24, 9), end: new Date(2026, 10, 24, 10), label: 'Visit'};

    it('keeps its dc-root class, data-dc-theme and --dc-* variables', () => {
        const clock = new DayClock(host(), {now, theme: 'dark'});

        expect(clock).toBeInstanceOf(Widget);
        expect(clock.element.className).toBe('dc-root');
        expect(clock.element.getAttribute('data-dc-theme')).toBe('dark');
        expect(clock.element.hasAttribute('data-wg-theme')).toBe(false);
        // the accessible name stays on the dial, not on the root
        expect(clock.element.hasAttribute('aria-label')).toBe(false);
        expect(clock.element.querySelector('svg')?.getAttribute('aria-label')).toMatch(/^Day clock/);

        clock.setTheme('light');
        expect(clock.element.getAttribute('data-dc-theme')).toBe('light');
        clock.setStyleVars({running: '#00ff00'});
        expect(clock.element.style.getPropertyValue('--dc-running')).toBe('#00ff00');
        clock.setStyleVars({running: null});
        expect(clock.element.style.getPropertyValue('--dc-running')).toBe('');
    });

    it('on/off chain and toggle the clickable class; destroy removes the root', () => {
        const clock = new DayClock(host(), {now});
        const fn = (): void => undefined;

        expect(clock.on('itemClick', fn)).toBe(clock);
        expect(clock.element.classList.contains('dc-clickable')).toBe(true);
        expect(clock.off('itemClick', fn)).toBe(clock);
        expect(clock.element.classList.contains('dc-clickable')).toBe(false);
        const el = clock.element;
        clock.destroy();
        expect(el.isConnected).toBe(false);
    });

    it('copies "now" and the items on the way in and out', () => {
        const fixed = new Date(now.getTime());
        const clock = new DayClock(host(), {now: fixed});

        fixed.setHours(3);
        expect(clock.now.getHours()).toBe(12);
        clock.now.setHours(5);
        expect(clock.now.getHours()).toBe(12);

        const items = [{...item}];
        clock.setItems(items);
        items[0]!.label = 'Changed';
        clock.render();
        expect(clock.element.querySelector('title')?.textContent).toContain('Visit');
    });
});

describe('widget getters hand out copies', () => {
    it('RingGauge.getRings / WorldMap.getMarkers', () => {
        const gauge = new RingGauge(host(), {rings: [{value: 3, max: 10, label: 'a'}], animate: false});
        (gauge.getRings()[0] as {value: number}).value = 99;
        expect(gauge.getRings()[0]!.value).toBe(3);

        const markers = [{lon: 10, lat: 50, label: 'x'}];
        const map = new WorldMap(host(), {markers});
        markers[0]!.label = 'changed';
        expect(map.getMarkers()[0]!.label).toBe('x');
        (map.getMarkers()[0] as {label: string}).label = 'y';
        expect(map.getMarkers()[0]!.label).toBe('x');
    });
});

describe('IsoEditor API', () => {
    const iso = (): IsoEditor => new IsoEditor(host(), {document: {items: [
        {id: 'a', icon: 'server', tile: {x: 0, y: 0}},
        {id: 'b', icon: 'server', tile: {x: 4, y: 0}}
    ]}});

    it('readOnly is a getter; isReadOnly stays as a deprecated delegate', () => {
        const ed = iso();
        expect(ed.readOnly).toBe(false);
        ed.setReadOnly(true);
        expect(ed.readOnly).toBe(true);
        expect(ed.isReadOnly()).toBe(true);
        ed.destroy();
    });

    it('on/off return the editor', () => {
        const ed = iso();
        const fn = (): void => undefined;
        expect(ed.on('change', fn)).toBe(ed);
        expect(ed.off('change', fn)).toBe(ed);
        ed.destroy();
    });

    it('setStyleVars sets typed --iso-* overrides and null removes them', () => {
        const ed = iso();
        ed.setStyleVars({bg: '#000000', ok: 'lime'});
        expect(ed.element.style.getPropertyValue('--iso-bg')).toBe('#000000');
        expect(ed.element.style.getPropertyValue('--iso-ok')).toBe('lime');
        ed.setStyleVars({bg: null});
        expect(ed.element.style.getPropertyValue('--iso-bg')).toBe('');
        ed.destroy();
    });

    it('getIconTypes returns copies; registered types are copied on the way in', () => {
        const ed = iso();
        const mine = {id: 'mine', label: 'Mine', color: '#123456', render: (): string => ''};
        ed.registerIcons([mine]);
        mine.label = 'changed';
        const got = ed.getIconTypes().find((t) => t.id === 'mine')!;
        expect(got.label).toBe('Mine');
        expect(got.render).toBe(mine.render);
        got.label = 'again';
        expect(ed.getIconTypes().find((t) => t.id === 'mine')!.label).toBe('Mine');
        ed.destroy();
    });

    it('addConnector / addText copy the caller objects; getRoute returns copies', () => {
        const ed = iso();
        const from = {tile: {x: 0, y: 2}};
        const to = {item: 'b'};
        const via = [{x: 2, y: 2}];
        const id = ed.addConnector(from, to, {via});
        from.tile.x = 9;
        via[0]!.x = 9;
        const conn = ed.getDocument().connectors!.find((c) => c.id === id)!;
        expect(conn.from).toEqual({tile: {x: 0, y: 2}});
        expect(conn.via).toEqual([{x: 2, y: 2}]);

        const route = ed.getRoute(id);
        expect(route.length).toBeGreaterThan(0);
        route[0]!.x = 1000;
        expect(ed.getRoute(id)[0]!.x).not.toBe(1000);

        const tile = {x: 6, y: 6};
        const t = ed.addText(tile, 'hi', {});
        tile.x = 0;
        expect(ed.getDocument().texts!.find((x) => x.id === t)!.tile).toEqual({x: 6, y: 6});
        ed.destroy();
    });

    it('copy() hands out a copy of the clipboard fragment', () => {
        const ed = iso();
        ed.select(['a']);
        const f = ed.copy()!;
        f.items[0]!.tile.x = 50;
        const ids = ed.paste(undefined, {x: 10, y: 10});
        expect(ids).toHaveLength(1);
        expect(ed.getDocument().items.find((i) => i.id === ids[0])!.tile).toEqual({x: 10, y: 10});
        ed.destroy();
    });
});

describe('WorkflowEditor.getType', () => {
    it('returns a copy; registerType copies the caller object', () => {
        const type = {type: 't', label: 'T', inputs: [{id: 'in'}], outputs: [{id: 'out'}]};
        const ed = new WorkflowEditor(host(), {types: [type], fitOnLoad: false});

        type.label = 'changed';
        type.inputs[0]!.id = 'x';
        expect(ed.getType('t')!.label).toBe('T');
        const got = ed.getType('t')!;
        got.label = 'again';
        got.outputs![0]!.id = 'y';
        expect(ed.getType('t')!.label).toBe('T');
        expect(ed.getType('t')!.outputs![0]!.id).toBe('out');
        ed.destroy();
    });
});
