/**
 * The shape of a transformer as NetView draws it: a stack of blocks over one
 * residual stream. Only sizes — no weights; the view compresses everything
 * into bins and cells the browser can draw at once.
 */
export interface NetModel {
    name?: string;
    architecture?: string;
    /** Width of the residual stream (d_model). */
    hidden: number;
    /** Number of transformer blocks. */
    blocks: number;
    /** Attention heads per block. */
    heads: number;
    kvHeads?: number;
    /** Routed experts per MoE block; 0 / undefined = dense. */
    experts?: number;
    /** Experts picked per token (top-k). */
    expertsPerToken?: number;
    /** Per block, e.g. 'full' | 'linear' | 'sliding' for hybrid models (drawn as a mark on the column). */
    blockKinds?: string[];
}

/** A token with its probability (and id, when known). */
export interface NetToken {
    piece: string;
    prob: number;
    id?: number;
}

/** Logit lens at one block: the residual read out through the final norm + lm_head. */
export interface NetLens {
    top: NetToken[];
    entropy?: number;
    /** Probability of the model's final prediction at this block. */
    finalProb?: number;
    /** Rank of the final prediction at this block (0 = top-1). */
    finalRank?: number;
}

/** One attention head at the traced position. */
export interface NetHead {
    head: number;
    /** Attention entropy over the context (low = focused). */
    entropy?: number;
    /** Strongest attended positions. */
    top?: {pos: number; token: string; weight: number}[];
}

/** What one block did at the traced position. */
export interface NetTraceBlock {
    block: number;
    /** Raw residual after the block (length = hidden). Best input for the bins. */
    values?: ArrayLike<number>;
    /** Strongest dimensions, when the raw vector is not available. */
    topDims?: {dim: number; value: number}[];
    /** L2 norm of the residual. */
    l2?: number;
    /** L2 of the change against the previous block. */
    update?: number;
    /** Cosine to the previous block's residual. */
    cosine?: number;
    lens?: NetLens;
    heads?: NetHead[];
    /** Experts picked at the traced position (MoE). */
    experts?: {expert: number; weight?: number}[];
    /** Expert load over the whole prompt (MoE). */
    expertLoad?: {expert: number; tokens: number}[];
}

/** One prompt run through the model, measured at one position (default: the last token). */
export interface NetTrace {
    prompt?: string;
    /** The prompt's token pieces. */
    tokens?: string[];
    /** Index of the traced token in `tokens`. */
    position?: number;
    /** The model's final next-token prediction. */
    prediction?: NetToken;
    /** Final top-k, for the output column. */
    top?: NetToken[];
    blocks: NetTraceBlock[];
}

/** Summary numbers of a trace (see `NetCompress.measure`). */
export interface NetMeasurements {
    blocks: number;
    /** First block from which on the lens top-1 is the final prediction (null: never settles). */
    settleBlock: number | null;
    /** First block where the final prediction shows up in the lens top-k. */
    firstSeenBlock: number | null;
    /** Block with the largest residual update. */
    peakUpdateBlock: number | null;
    /** Lens entropy at the first and at the last block. */
    entropyStart: number | null;
    entropyEnd: number | null;
    /** Residual L2 of the last block / of the first block. */
    normGrowth: number | null;
    /** Mean attention focus over all heads (0 = spread evenly, 1 = one token). */
    meanFocus: number | null;
    /** Distinct experts picked at the traced position, over all blocks. */
    distinctExperts: number | null;
}
