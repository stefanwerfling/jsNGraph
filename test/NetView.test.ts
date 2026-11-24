/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { NetCompress } from '../src/netview/NetCompress';
import { NetHugin } from '../src/netview/NetHugin';
import { NetLayout } from '../src/netview/NetLayout';
import kolibriTrace from '../examples/data/hugin-trace-kolibri1.js?raw';
import { NetTrace } from '../src/netview/NetTypes';

describe('NetCompress.bins', () => {
    it('keeps the signed value of the strongest dimension per bin', () => {
        const bins = NetCompress.bins([0.1, -3, 0.2, 0.5, 2, -1, 0, 0], 4);

        expect(Array.from(bins)).toEqual([-3, 0.5, 2, 0]);
    });

    it('handles more bins than dimensions and skips non-finite values', () => {
        expect(Array.from(NetCompress.bins([1, NaN], 4))).toEqual([1, 1, 0, 0]);
        expect(NetCompress.bins([], 3).length).toBe(3);
    });

    it('places top dimensions into their bins', () => {
        const bins = NetCompress.binsFromTop([{dim: 0, value: 2}, {dim: 99, value: -5}, {dim: 50, value: 1}, {dim: 120, value: 9}], 100, 4);

        expect(Array.from(bins)).toEqual([2, 0, 1, -5]);
    });
});

describe('NetCompress.normalize / strongest', () => {
    it('maps the typical bin to 0 and saturates outliers', () => {
        // median |v| = 1, 95th percentile = 3 -> 2 maps to 0.5, 400 saturates.
        const raw = new Float32Array([1, -2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 400]);
        const n = NetCompress.normalize(raw);

        expect(n[19]).toBe(1);
        expect(n[18]).toBe(1);
        expect(n[1]).toBeCloseTo(-0.5);
        expect(n[0]).toBe(0);
    });

    it('handles flat and all-zero vectors', () => {
        expect(Array.from(NetCompress.normalize(new Float32Array(3)))).toEqual([0, 0, 0]);
        expect(Array.from(NetCompress.normalize(new Float32Array([2, -2, 2])))).toEqual([1, -1, 1]);
    });

    it('orders strongest bins by magnitude, ignoring zeros', () => {
        expect(NetCompress.strongest(new Float32Array([0.1, -0.9, 0, 0.5]), 3)).toEqual([1, 3, 0]);
        expect(NetCompress.strongest(new Float32Array([0, 0]), 2)).toEqual([]);
    });
});

describe('NetCompress.focus', () => {
    it('maps entropy to 1 (one token) .. 0 (even spread)', () => {
        expect(NetCompress.focus({head: 0, entropy: 0}, 8)).toBe(1);
        expect(NetCompress.focus({head: 0, entropy: Math.log(8)}, 8)).toBeCloseTo(0);
        expect(NetCompress.focus({head: 0, top: [{pos: 1, token: 'a', weight: 0.7}]}, 8)).toBe(0.7);
    });
});

describe('NetCompress.measure', () => {
    const lens = (piece: string, prob: number, entropy: number) => ({top: [{piece, prob}, {piece: 'x', prob: 0.01}], entropy});
    const trace: NetTrace = {
        tokens: ['The', ' capital', ' is'],
        prediction: {piece: ' Paris', prob: 0.9},
        blocks: [
            {block: 0, lens: lens(',', 0.1, 5), l2: 10, update: 2},
            {block: 1, lens: {top: [{piece: ' the', prob: 0.2}, {piece: ' Paris', prob: 0.1}], entropy: 4}, l2: 20, update: 9, experts: [{expert: 3}, {expert: 7}]},
            {block: 2, lens: lens(' Paris', 0.4, 2), l2: 30, update: 4, experts: [{expert: 3}]},
            {block: 3, lens: lens(' Paris', 0.9, 0.5), l2: 50, update: 3, heads: [{head: 0, entropy: 0}, {head: 1, entropy: Math.log(3)}]}
        ]
    };

    it('finds where the answer appears and settles', () => {
        const m = NetCompress.measure(trace);

        expect(m.firstSeenBlock).toBe(1);
        expect(m.settleBlock).toBe(2);
        expect(m.peakUpdateBlock).toBe(1);
        expect(m.entropyStart).toBe(5);
        expect(m.entropyEnd).toBe(0.5);
        expect(m.normGrowth).toBe(5);
        expect(m.meanFocus).toBeCloseTo(0.5);
        expect(m.distinctExperts).toBe(2);
    });

    it('does not settle when the last block disagrees', () => {
        const m = NetCompress.measure({...trace, prediction: {piece: ' Rome', prob: 0.5}});

        expect(m.settleBlock).toBeNull();
        expect(m.firstSeenBlock).toBeNull();
    });

    it('reports nulls for missing data', () => {
        const m = NetCompress.measure({blocks: [{block: 0}]});

        expect(m).toMatchObject({settleBlock: null, peakUpdateBlock: null, normGrowth: null, meanFocus: null, distinctExperts: null});
    });
});

describe('NetLayout', () => {
    const layout = new NetLayout({hidden: 4096, blocks: 10, heads: 8, experts: 64}, {bins: 32}, 5);

    it('stacks bins, heads and experts in one column', () => {
        expect(layout.headTop).toBeGreaterThan(layout.binRect(0, 31).y);
        expect(layout.expertTop).toBeGreaterThan(layout.headRect(0, 7).y);
        expect(layout.lensTop).toBeGreaterThan(layout.expertRect(0, 63).y);
        expect(layout.columnX(1) - layout.columnX(0)).toBe(layout.spacing);
    });

    it('hits the part under the pointer', () => {
        const bin = layout.binRect(3, 5);
        const head = layout.headRect(2, 6);
        const ex = layout.expertRect(4, 17);
        const inp = layout.inputRect(2);

        expect(layout.hit(bin.x + 2, bin.y + 2)).toEqual({kind: 'bin', block: 3, index: 5});
        expect(layout.hit(head.x + 1, head.y + 1)).toEqual({kind: 'head', block: 2, index: 6});
        expect(layout.hit(ex.x + 1, ex.y + 1)).toEqual({kind: 'expert', block: 4, index: 17});
        expect(layout.hit(inp.x + 5, inp.y + 5)).toEqual({kind: 'input', index: 2});
        expect(layout.hit(layout.columnX(1) + 5, layout.lensTop + 5)).toEqual({kind: 'block', block: 1});
        expect(layout.hit(layout.columnX(1) + 50, 10)).toBeNull();
    });

    it('maps bins back to their dimension range', () => {
        expect(layout.binDims(0)).toEqual([0, 128]);
        expect(layout.binDims(31)).toEqual([3968, 4096]);
    });

    it('drops the head and expert sections for a model without them', () => {
        const dense = new NetLayout({hidden: 64, blocks: 2, heads: 0});

        expect(dense.headRows).toBe(0);
        expect(dense.expertTop).toBe(dense.headTop);
        expect(dense.lensTop).toBe(dense.expertTop);
    });
});

describe('NetHugin', () => {
    const outputs = {
        prompt: 'The capital of France is',
        tokenize: {ids: [1, 2, 3], pieces: ['The', ' capital', ' is']},
        logit_lens: {
            position: 2,
            final_prediction: {id: 9, piece: ' Paris', prob: 0.8},
            blocks: [{block: 0, entropy: 3, final_token_prob: 0.01, final_token_rank: 40, top: [{id: 5, piece: ',', prob: 0.2}]},
                {block: 1, entropy: 1, final_token_prob: 0.8, final_token_rank: 0, top: [{id: 9, piece: ' Paris', prob: 0.8}]}]
        },
        activations: {d_model: 8, position: 2, blocks: [{block: 0, l2: 3, top_dims: [{dim: 1, value: 2}]},
            {block: 1, l2: 6, update_l2: 4, cos_prev_block: 0.7, values: [1, 2, 3, 4, 5, 6, 7, 8]}]},
        attention_pattern: [{block: 1, heads: 4, kv_heads: 2, per_head: [{head: 0, entropy: 0.2, top: [{pos: 0, token: 'The', weight: 0.9}]}]}],
        expert_usage: {experts: 16, blocks: [{block: 1, k: 2, top_by_count: [{expert: 3, tokens: 2}], picks_at_position: [{expert: 3, weight: 0.6}]}]}
    };

    it('prefers the model section of a trace output', () => {
        const fromTrace = NetHugin.model({...outputs, model: {architecture: 'qwen35moe', d_model: 16, blocks: 3, heads: 8, kv_heads: 2,
            experts: 0, experts_per_token: 0, block_kinds: ['linear', 'linear', 'full']}});

        expect(fromTrace).toMatchObject({architecture: 'qwen35moe', hidden: 16, blocks: 3, heads: 8, kvHeads: 2, experts: 16, blockKinds: ['linear', 'linear', 'full']});
        expect(NetHugin.model({model: {d_model: 4, blocks: 2, heads: 2, experts: 0}}).experts).toBeUndefined();
    });

    it('reads the model sizes from the tool outputs', () => {
        expect(NetHugin.model(outputs)).toMatchObject({hidden: 8, blocks: 2, heads: 4, kvHeads: 2, experts: 16, expertsPerToken: 2});
        expect(NetHugin.model(outputs, {heads: 32}).heads).toBe(32);
    });

    it('merges every tool into one trace block per block', () => {
        const t = NetHugin.trace(outputs);

        expect(t.tokens).toEqual(['The', ' capital', ' is']);
        expect(t.position).toBe(2);
        expect(t.prediction).toEqual({id: 9, piece: ' Paris', prob: 0.8});
        expect(t.blocks).toHaveLength(2);
        expect(t.blocks[0]).toMatchObject({block: 0, l2: 3, topDims: [{dim: 1, value: 2}], lens: {finalRank: 40}});
        expect(t.blocks[1]).toMatchObject({block: 1, update: 4, cosine: 0.7, experts: [{expert: 3, weight: 0.6}], expertLoad: [{expert: 3, tokens: 2}]});
        expect(t.blocks[1]!.heads![0]!.top![0]!.token).toBe('The');
        expect(t.blocks[1]!.values).toHaveLength(8);
        expect(NetCompress.measure(t).settleBlock).toBe(1);
    });
});

describe('NetHugin on a real trace (examples/data/hugin-trace-kolibri1.js)', () => {
    const win: {HUGIN_SAMPLES?: {id: string; prompt: string; outputs: never}[]} = {};
    new Function('window', kolibriTrace)(win);
    const samples = win.HUGIN_SAMPLES ?? [];

    it('holds the German and the English Kolibri-1 trace', () => {
        expect(samples.map((x) => x.id)).toEqual(['kolibri1-de', 'kolibri1-en']);
    });

    it('turns each into a full 50-block model and trace', () => {
        for (const sample of samples) {
            const model = NetHugin.model(sample.outputs);
            const trace = NetHugin.trace(sample.outputs);

            expect(model).toMatchObject({architecture: 'kolibri1', hidden: 2560, blocks: 50, heads: 48, kvHeads: 4, experts: 384, expertsPerToken: 6});
            expect(model.blockKinds).toHaveLength(50);
            expect(trace.blocks).toHaveLength(50);
            for (const b of trace.blocks) {
                expect(b.values).toHaveLength(2560);
                expect(b.heads).toHaveLength(48);
                expect(b.experts).toHaveLength(6);
                expect(b.lens?.top.length).toBeGreaterThan(0);
            }
        }
        const en = NetHugin.trace(samples[1]!.outputs);
        expect(en.top?.[0]?.piece).toBe('ĠParis');
        expect(NetCompress.measure(en).settleBlock).toBeLessThan(50);
    });
});
