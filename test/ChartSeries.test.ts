// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BarChart } from '../src/chart/BarChart';
import { LineChart } from '../src/chart/LineChart';
import { FakeCanvas } from './support/FakeCanvas';

beforeAll(() => FakeCanvas.install());

interface Surface {
    element: HTMLElement;
}

const charts: Array<{destroy(): void}> = [];

afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

/** Give the chart a 400×300 box and draw one frame synchronously. */
const layOut = (chart: Surface): void => {
    chart.element.getBoundingClientRect = () => ({left: 0, top: 0, width: 400, height: 300}) as DOMRect;
    const internals = chart as unknown as {resize(): void; frame(t: number): boolean};
    internals.resize();
    internals.frame(0);
};

const host = (): HTMLElement => document.body.appendChild(document.createElement('div'));

describe('LineChart', () => {
    it('appends instead of leaving a hole when setSeriesAt is past the end', () => {
        const chart = new LineChart(host());
        charts.push(chart);
        const hover = vi.fn();
        chart.on('hover', hover);

        chart.setSeriesAt(2, {y: [1, 2, 3]});
        expect(chart.getSeries()).toHaveLength(1);

        layOut(chart);
        expect(() => chart.element.dispatchEvent(new PointerEvent('pointermove', {clientX: 200, clientY: 150}))).not.toThrow();
        expect(hover).toHaveBeenCalled();
    });

    it('maps hover through the drawn x range of all series', () => {
        const chart = new LineChart(host(), {series: [
            {y: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]},              // x 0…10
            {y: Array.from({length: 21}, (_, i) => i)}             // x 0…20
        ]});
        charts.push(chart);
        const hover = vi.fn();
        chart.on('hover', hover);
        layOut(chart);

        const plot = (chart as unknown as {plot: {x: number; y: number; w: number; h: number}}).plot;
        chart.element.dispatchEvent(new PointerEvent('pointermove', {clientX: plot.x + plot.w, clientY: plot.y + plot.h / 2}));

        expect(hover).toHaveBeenLastCalledWith({x: 20});
    });
});

describe('BarChart', () => {
    it('appends a panel instead of leaving a hole', () => {
        const chart = new BarChart(host(), {categories: ['a', 'b']});
        charts.push(chart);
        chart.setSeries([{values: [1, 2]}], 0, false);

        chart.setSeries([{values: [3, 4]}], 3, false);

        expect(chart.getData().panels).toHaveLength(2);
        layOut(chart);
    });
});
