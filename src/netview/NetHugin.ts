import { NetModel, NetToken, NetTrace, NetTraceBlock } from './NetTypes';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

/**
 * Outputs of the Hugin forward tools for one prompt, as returned by its MCP
 * server — every field optional; the trace gets what is there. Hugin's
 * `trace` tool returns all of it from one forward, in exactly this shape:
 *
 *     trace             {text}                    everything below + model
 *
 * or the single tools, combined by the caller:
 *
 *     logit_lens        {text, top_k}
 *     activations       {text, values: true}     (or without values: top_dims only)
 *     attention_pattern {text, block}             one result per block
 *     expert_usage      {text}                    MoE models
 *     tokenize          {text}
 */
export interface HuginOutputs {
    prompt?: string;
    /** Sizes from `trace`: architecture, d_model, blocks, heads, kv_heads, experts, experts_per_token, block_kinds. */
    model?: Json;
    /** What `trace` could not capture (e.g. attention stages of an architecture). */
    notes?: string[];
    model_info?: Json;
    tokenize?: Json;
    next_token?: Json;
    logit_lens?: Json;
    activations?: Json;
    attention_pattern?: Json[];
    expert_usage?: Json;
}

/** Turns Hugin tool outputs into a NetView model and trace. */
export class NetHugin {

    /** The model sizes the outputs reveal; `override` fills what they do not (e.g. heads of a model without an attention call). */
    public static model(out: HuginOutputs, override: Partial<NetModel> = {}): NetModel {
        const blockIds = [
            ...(out.logit_lens?.blocks ?? []).map((b: Json) => b.block),
            ...(out.activations?.blocks ?? []).map((b: Json) => b.block),
            ...(out.expert_usage?.blocks ?? []).map((b: Json) => b.block),
            ...(out.attention_pattern ?? []).map((a: Json) => a.block)
        ].filter((b) => typeof b === 'number');
        const attention = out.attention_pattern?.[0];
        const m = out.model ?? {};
        const model: NetModel = {
            hidden: m.d_model ?? out.activations?.d_model ?? 0,
            blocks: m.blocks ?? (blockIds.length === 0 ? 0 : Math.max(...blockIds) + 1),
            heads: m.heads ?? attention?.heads ?? 0
        };
        const name = m.name ?? out.model_info?.path?.split('/').pop();
        const architecture = m.architecture ?? out.model_info?.architecture;
        const kvHeads = m.kv_heads ?? attention?.kv_heads;
        const experts = m.experts || out.expert_usage?.experts;
        const perToken = m.experts_per_token || out.expert_usage?.blocks?.[0]?.k;

        if (name !== undefined) model.name = name;
        if (architecture !== undefined) model.architecture = architecture;
        if (kvHeads !== undefined) model.kvHeads = kvHeads;
        if (experts) model.experts = experts;
        if (perToken) model.expertsPerToken = perToken;
        if (Array.isArray(m.block_kinds)) model.blockKinds = m.block_kinds.map(String);

        return {...model, ...override};
    }

    public static trace(out: HuginOutputs): NetTrace {
        const byBlock = new Map<number, NetTraceBlock>();
        const at = (b: number): NetTraceBlock => {
            let block = byBlock.get(b);

            if (block === undefined) {
                block = {block: b};
                byBlock.set(b, block);
            }
            return block;
        };
        const token = (t: Json): NetToken => ({piece: String(t.piece ?? ''), prob: Number(t.prob ?? 0), ...(t.id === undefined ? {} : {id: t.id})});

        for (const b of out.logit_lens?.blocks ?? []) {
            at(b.block).lens = {
                top: (b.top ?? []).map(token),
                entropy: b.entropy,
                finalProb: b.final_token_prob,
                finalRank: b.final_token_rank
            };
        }
        for (const b of out.activations?.blocks ?? []) {
            const block = at(b.block);

            block.l2 = b.l2;
            block.update = b.update_l2;
            block.cosine = b.cos_prev_block;
            if (Array.isArray(b.values)) {
                block.values = b.values;
            }
            if (Array.isArray(b.top_dims)) {
                block.topDims = b.top_dims.map((d: Json) => ({dim: d.dim, value: d.value}));
            }
        }
        for (const a of out.attention_pattern ?? []) {
            at(a.block).heads = (a.per_head ?? []).map((h: Json) => ({
                head: h.head,
                entropy: h.entropy,
                top: (h.top ?? []).map((t: Json) => ({pos: t.pos, token: String(t.token ?? ''), weight: t.weight}))
            }));
        }
        for (const b of out.expert_usage?.blocks ?? []) {
            const block = at(b.block);

            if (Array.isArray(b.picks_at_position)) {
                block.experts = b.picks_at_position.map((p: Json) => ({expert: p.expert, weight: p.weight}));
            }
            if (Array.isArray(b.top_by_count)) {
                block.expertLoad = b.top_by_count.map((p: Json) => ({expert: p.expert, tokens: p.tokens}));
            }
        }

        const final = out.logit_lens?.final_prediction;
        const position = out.logit_lens?.position ?? out.activations?.position ?? out.expert_usage?.position;
        const trace: NetTrace = {blocks: [...byBlock.values()].sort((a, b) => a.block - b.block)};

        if (out.prompt !== undefined) {
            trace.prompt = out.prompt;
        }
        if (Array.isArray(out.tokenize?.pieces)) {
            trace.tokens = out.tokenize.pieces.map(String);
        }
        if (typeof position === 'number') {
            trace.position = position;
        }
        if (final !== undefined) {
            trace.prediction = token(final);
        }
        if (Array.isArray(out.next_token?.top)) {
            trace.top = out.next_token.top.map(token);
        }

        return trace;
    }

}
