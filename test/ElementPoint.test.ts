// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ElementPoint } from '../src/util/ElementPoint';

/** An element laid out 400×300 but shown at twice the size (a zoomed ancestor). */
const scaled = (): HTMLElement => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', {value: 400});
    Object.defineProperty(el, 'clientHeight', {value: 300});
    el.getBoundingClientRect = () => ({left: 100, top: 50, width: 800, height: 600, right: 900, bottom: 650, x: 100, y: 50,
        toJSON: () => ({})}) as DOMRect;
    return el;
};

describe('ElementPoint.local', () => {
    it('undoes a CSS scale on an ancestor', () => {
        expect(ElementPoint.local(scaled(), 500, 250)).toEqual({x: 200, y: 100});
    });

    it('is a plain offset when the element is not scaled', () => {
        const el = document.createElement('div');
        el.getBoundingClientRect = () => ({left: 10, top: 20, width: 0, height: 0}) as DOMRect;
        expect(ElementPoint.local(el, 15, 30)).toEqual({x: 5, y: 10});
    });
});
