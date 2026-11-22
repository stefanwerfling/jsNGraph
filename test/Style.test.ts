import { describe, expect, it } from 'vitest';
import { GraphEdge } from '../src/model/GraphEdge';
import { GraphNode } from '../src/model/GraphNode';
import { GraphQuery } from '../src/model/GraphQuery';
import { EdgeKindPresets, StyleResolver } from '../src/render/StyleResolver';
import { Theme } from '../src/render/Theme';
import { Color } from '../src/util/Color';

const node = (id: string, extra: Partial<ConstructorParameters<typeof GraphNode>[0]> = {}): GraphNode =>
    new GraphNode({id: id, label: id, ...extra}, 0, 0);

describe('Color', () => {
    it('parses hex, short hex, rgb() and rgba() in both syntaxes', () => {
        expect(Color.parse('#0f1420')).toEqual({r: 15, g: 20, b: 32, a: 1});
        expect(Color.parse('#abc')).toEqual({r: 170, g: 187, b: 204, a: 1});
        expect(Color.parse('#ff000080')?.a).toBeCloseTo(0.502, 2);
        expect(Color.parse('rgb(1, 2, 3)')).toEqual({r: 1, g: 2, b: 3, a: 1});
        expect(Color.parse('rgba(1,2,3,0.5)')).toEqual({r: 1, g: 2, b: 3, a: 0.5});
        expect(Color.parse('rgb(10 20 30 / 25%)')).toEqual({r: 10, g: 20, b: 30, a: 0.25});
        expect(Color.parse('not-a-color')).toBeNull();
    });

    it('lerps between formats and keeps the endpoint on t=0/1', () => {
        expect(Color.lerp('#000000', 'rgb(255, 255, 255)', 0.5)).toBe('rgb(128, 128, 128)');
        expect(Color.lerp('#2ecc71', '#e74c3c', 0)).toBe('rgb(46, 204, 113)');
        expect(Color.lerp('bogus', '#ffffff', 0.5)).toBe('#ffffff');
    });

    it('withAlpha multiplies alpha', () => {
        expect(Color.withAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    });

    it('fromPalette is stable per key', () => {
        const palette = ['a', 'b', 'c', 'd'];

        expect(Color.fromPalette('Projects/alpha', palette)).toBe(Color.fromPalette('Projects/alpha', palette));
        expect(Color.fromPalette('x', [])).toBeNull();
    });
});

describe('StyleResolver', () => {
    it('a node without style fields renders as before (device circle)', () => {
        const styles = new StyleResolver(Theme.dark);
        const s = styles.node(node('a', {kind: 'router'}));

        expect(s.shape).toBe('circle');
        expect(s.icon).toBe('router');
        expect(s.fill).toBe(Theme.dark.nodeFill);
        expect(s.stroke).toBe(Theme.dark.nodeStroke);
        expect(s.radius).toBe(22);
    });

    it('dot nodes: color is the fill, group picks a palette color, size sets the radius', () => {
        const styles = new StyleResolver({...Theme.dark, palette: ['#111111', '#222222']});
        const colored = styles.node(node('a', {shape: 'dot', color: '#ff0000', size: 4}));
        const grouped = styles.node(node('b', {shape: 'dot', group: 'Projects'}));

        expect(colored.fill).toBe('#ff0000');
        expect(colored.radius).toBe(4);
        expect(colored.icon).toBeNull();
        expect(['#111111', '#222222']).toContain(grouped.fill);
        expect(styles.node(node('c', {shape: 'dot', group: 'Projects'})).fill).toBe(grouped.fill);
    });

    it('the styleNode callback wins over data', () => {
        const styles = new StyleResolver(Theme.dark, {}, (n) => n.id === 'a' ? {radius: 40, opacity: 0.5, label: 'A!'} : null);

        expect(styles.node(node('a')).radius).toBe(40);
        expect(styles.node(node('a')).opacity).toBe(0.5);
        expect(styles.node(node('a')).label).toBe('A!');
        expect(styles.node(node('b')).radius).toBe(22);
    });

    it('image, badge and label pill: data → resolved style, callback can override', () => {
        const plain = new StyleResolver(Theme.dark);
        const avatar = node('a', {image: 'a.png', badge: 17});

        expect(plain.node(avatar).image).toBe('a.png');
        expect(plain.node(avatar).badge).toBe('17');
        expect(plain.node(avatar).badgeColor).toBe(Theme.dark.statusOk);
        expect(plain.node(avatar).labelBackground).toBeNull();
        expect(plain.node(node('b', {badge: 0})).badge).toBeNull();
        expect(plain.node(node('c', {shape: 'dot', image: 'c.png'})).image).toBeNull();

        const pill = new StyleResolver(Theme.dark, {}, (n) => n.id === 'a' ? {labelBackground: '#fff', badge: null} : null, null, 'pill');

        expect(pill.node(node('b')).labelBackground).not.toBeNull();
        expect(pill.node(avatar).labelBackground).toBe('#fff');
        expect(pill.node(avatar).badge).toBeNull();
    });

    it('fill, icon colour, badges and label size: data first, callback wins', () => {
        const styles = new StyleResolver(Theme.light, {}, (n) => n.id === 'b' ? {badges: null, labelSize: 14, iconColor: '#000'} : null);
        const flag = {image: 'de.png', position: 'bottom-left' as const};
        const a = styles.node(node('a', {fill: '#0b4aa2', iconColor: '#fff', badges: [flag]}));

        expect(a.fill).toBe('#0b4aa2');
        expect(a.stroke).toBe('#0b4aa2');
        expect(a.iconColor).toBe('#fff');
        expect(a.badges).toEqual([flag]);
        expect(a.labelSize).toBe(11);
        expect(styles.node(node('big', {size: 42})).labelSize).toBeGreaterThan(13);

        const b = styles.node(node('b', {badges: [flag]}));

        expect(b.badges).toEqual([]);
        expect(b.labelSize).toBe(14);
        expect(b.iconColor).toBe('#000');
    });

    it('updateNode patches image and badge; empty values clear them', () => {
        const n = node('a', {image: 'a.png', badge: '3'});

        n.updateFrom({badge: 5, badgeColor: '#f00'});
        expect(n.badge).toBe('5');
        expect(n.badgeColor).toBe('#f00');
        n.updateFrom({image: '', badge: ''});
        expect(n.image).toBeNull();
        expect(n.badge).toBeNull();
    });

    it('edges keep load coloring by default, kinds switch to the neutral tone', () => {
        const styles = new StyleResolver(Theme.dark, EdgeKindPresets.knowledge);
        const a = node('a');
        const b = node('b');
        const legacy = styles.edge(new GraphEdge({id: 'e1', source: 'a', target: 'b', load: 0}, a, b));
        const typed = styles.edge(new GraphEdge({id: 'e2', source: 'a', target: 'b', kind: 'supersedes'}, a, b));
        const tag = styles.edge(new GraphEdge({id: 'e3', source: 'a', target: 'b', kind: 'tag', dashed: false}, a, b));

        expect(legacy.color).toBe('rgb(46, 204, 113)');
        expect(legacy.animated).toBe(true);
        expect(typed.color).toBe(Theme.dark.nodeStroke);
        expect(typed.directed).toBe(true);
        expect(typed.dash).toEqual([6, 4]);
        expect(typed.animated).toBe(false);
        expect(tag.dash).toBeNull();
    });

    it('edge data overrides the kind, an explicit animated flag wins too', () => {
        const styles = new StyleResolver(Theme.dark, EdgeKindPresets.knowledge);
        const e = new GraphEdge({id: 'e', source: 'a', target: 'b', kind: 'wikilink', color: '#123456', animated: true, label: 'x'}, node('a'), node('b'));
        const s = styles.edge(e);

        expect(s.color).toBe('#123456');
        expect(s.animated).toBe(true);
        expect(s.label).toBe('x');
    });
});

describe('Theme.fromCssVars', () => {
    const source = (vars: Record<string, string>) => ({getPropertyValue: (name: string) => vars[name] ?? ''});

    it('reads --jsng-* variables over the base and leaves the rest alone', () => {
        const theme = Theme.fromCssVars(source({
            '--jsng-background': ' #000000 ',
            '--jsng-node-fill': 'rgb(1, 2, 3)',
            '--jsng-dim-opacity': '0.3',
            '--jsng-palette-1': '#aa0000',
            '--jsng-palette-2': '#00aa00'
        }), {base: Theme.light});

        expect(theme.background).toBe('#000000');
        expect(theme.nodeFill).toBe('rgb(1, 2, 3)');
        expect(theme.dimOpacity).toBe(0.3);
        expect(theme.palette).toEqual(['#aa0000', '#00aa00']);
        expect(theme.nodeStroke).toBe(Theme.light.nodeStroke);
    });

    it('maps host design-system variables, prefixed ones first', () => {
        const theme = Theme.fromCssVars(source({'--bg': '#101010', '--text': '#eeeeee', '--jsng-node-label': '#ffffff'}), {
            map: {background: '--bg', nodeLabel: ['--text']}
        });

        expect(theme.background).toBe('#101010');
        expect(theme.nodeLabel).toBe('#ffffff');
    });
});

describe('GraphQuery', () => {
    const edges = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['x', 'a']].map(([s, t]) => ({source: {id: s as string}, target: {id: t as string}}));

    it('neighborhood walks hops in both directions by default', () => {
        expect([...GraphQuery.neighborhood('a', edges, 1)].sort()).toEqual(['a', 'b', 'x']);
        expect([...GraphQuery.neighborhood('a', edges, 2)].sort()).toEqual(['a', 'b', 'c', 'x']);
        expect([...GraphQuery.neighborhood('a', edges, 0)]).toEqual(['a']);
    });

    it('neighborhood respects direction and unknown ids', () => {
        expect([...GraphQuery.neighborhood('a', edges, 5, 'out')].sort()).toEqual(['a', 'b', 'c', 'd']);
        expect([...GraphQuery.neighborhood('a', edges, 5, 'in')].sort()).toEqual(['a', 'x']);
        expect(GraphQuery.neighborhood('zzz', edges, 1, 'both', new Set(['a'])).size).toBe(0);
    });

    it('hopDistances gives BFS depth', () => {
        const d = GraphQuery.hopDistances('a', edges, 2);

        expect(d.get('a')).toBe(0);
        expect(d.get('x')).toBe(1);
        expect(d.get('c')).toBe(2);
        expect(d.has('d')).toBe(false);
    });
});
