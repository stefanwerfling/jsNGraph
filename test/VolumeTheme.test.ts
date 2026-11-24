// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { VolumeView } from '../src/chart/VolumeView';
import { FakeCanvas } from './support/FakeCanvas';

beforeAll(() => FakeCanvas.install());

interface Internals {
    theme: {background: string; text: string};
    backdrop: string | null;
}

const view = (theme?: 'dark' | 'light' | {background?: string; text?: string}): {v: VolumeView; i: Internals} => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const v = new VolumeView(host, theme === undefined ? {} : {theme: theme});
    return {v: v, i: v as unknown as Internals};
};

describe('VolumeView theme', () => {
    it('keeps the base canvas (over the volume) transparent for any theme', () => {
        for (const theme of [undefined, 'dark', 'light', {background: '#223344'}] as const) {
            const {v, i} = view(theme);
            expect(i.theme.background).toBe('rgba(0,0,0,0)');
            v.destroy();
        }
    });

    it('moves the theme background to the floor', () => {
        const {v, i} = view('light');
        expect(i.backdrop).toBe('#ffffff');
        expect(i.theme.text).not.toBe('#8b97b5');

        v.setTheme('dark');
        expect(i.backdrop).toBeNull();
        expect(i.theme.background).toBe('rgba(0,0,0,0)');

        v.setTheme({text: '#000'});
        expect(i.backdrop).toBeNull();
        v.destroy();
    });
});
