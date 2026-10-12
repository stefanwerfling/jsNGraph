import { describe, expect, it } from 'vitest';
import { Granularity, GranFlow, GranModule } from '../src/modelview/Granularity';

// A tiny hierarchy: a decoder "layer" block (level 0) that expands into
// ln1/attn/add1 (level 1), and attn expands further into q/sdpa/o (level 2).
const MODULES: GranModule[] = [
    {id: 'emb', level: 0, parent: null},
    {id: 'layer', level: 0, parent: null},
    {id: 'lnf', level: 0, parent: null},
    {id: 'ln1', level: 1, parent: 'layer'},
    {id: 'attn', level: 1, parent: 'layer'},
    {id: 'add1', level: 1, parent: 'layer'},
    {id: 'q', level: 2, parent: 'attn'},
    {id: 'sdpa', level: 2, parent: 'attn'},
    {id: 'o', level: 2, parent: 'attn'}
];

// Flows authored between the finest leaves, plus one residual.
const FLOWS: GranFlow[] = [
    {source: 'emb', target: 'ln1'},
    {source: 'ln1', target: 'q'},
    {source: 'q', target: 'sdpa'},
    {source: 'sdpa', target: 'o'},
    {source: 'o', target: 'add1'},
    {source: 'add1', target: 'lnf'},
    {source: 'emb', target: 'add1', kind: 'residual', label: 'residual'}
];

function byId(modules: GranModule[]): Map<string, GranModule> {
    return new Map(modules.map((module) => [module.id, module]));
}

function keys(flows: {source: string; target: string}[]): string[] {
    return flows.map((flow) => `${flow.source}->${flow.target}`);
}

describe('Granularity', () => {
    it('reports the deepest authored level', () => {
        expect(Granularity.maxLevel(MODULES)).toBe(2);
    });

    it('shows only the frontier of the revealed tree at each level', () => {
        expect([...Granularity.visible(MODULES, 0)].sort()).toEqual(['emb', 'layer', 'lnf']);
        expect([...Granularity.visible(MODULES, 1)].sort()).toEqual(['add1', 'attn', 'emb', 'ln1', 'lnf']);
        expect([...Granularity.visible(MODULES, 2)].sort())
            .toEqual(['add1', 'emb', 'ln1', 'lnf', 'o', 'q', 'sdpa']);
    });

    it('collapses hidden endpoints onto their visible ancestor at level 0', () => {
        const visible = Granularity.visible(MODULES, 0);
        const resolved = Granularity.resolveFlows(FLOWS, byId(MODULES), visible);

        // All layer internals collapse to `layer`; internal edges drop; the
        // main flow and the residual both become emb->layer, deduped to one.
        expect(keys(resolved)).toEqual(['emb->layer', 'layer->lnf']);
    });

    it('expands one block but keeps deeper blocks collapsed at level 1', () => {
        const visible = Granularity.visible(MODULES, 1);
        const resolved = Granularity.resolveFlows(FLOWS, byId(MODULES), visible);

        // attn internals (q/sdpa/o) collapse to `attn`; the residual stays a
        // distinct edge because add1 is now visible.
        expect(keys(resolved)).toEqual([
            'emb->ln1', 'ln1->attn', 'attn->add1', 'add1->lnf', 'emb->add1'
        ]);
        expect(resolved.find((f) => f.source === 'emb' && f.target === 'add1')?.kind).toBe('residual');
    });

    it('shows every leaf edge at the deepest level', () => {
        const visible = Granularity.visible(MODULES, 2);
        const resolved = Granularity.resolveFlows(FLOWS, byId(MODULES), visible);

        expect(keys(resolved)).toEqual([
            'emb->ln1', 'ln1->q', 'q->sdpa', 'sdpa->o', 'o->add1', 'add1->lnf', 'emb->add1'
        ]);
    });

    it('merges duplicates as animated if any duplicate was animated', () => {
        // At level 1, ln1->q and ln1->sdpa both collapse to ln1->attn; the
        // merged edge is animated because one of the two was.
        const flows: GranFlow[] = [
            {source: 'ln1', target: 'q', animated: false},
            {source: 'ln1', target: 'sdpa', animated: true}
        ];
        const visible = Granularity.visible(MODULES, 1);
        const resolved = Granularity.resolveFlows(flows, byId(MODULES), visible);

        expect(keys(resolved)).toEqual(['ln1->attn']);
        expect(resolved[0]?.animated).toBe(true);
    });
});
