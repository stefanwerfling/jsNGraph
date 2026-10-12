import { FlowKind, ModelFlowData } from './ModelTypes';
import { ModelNode } from './ModelNode';

/**
 * Runtime flow edge: resolved source/target module references plus the style
 * hints the renderer needs. `phase` is a fixed per-edge offset so animated
 * dots on parallel edges don't march in lockstep.
 */
export class ModelEdge {

    public readonly id: string;
    public readonly source: ModelNode;
    public readonly target: ModelNode;
    public label: string | null;
    public kind: FlowKind;
    public animated: boolean;
    public readonly phase: number;

    public constructor(data: ModelFlowData, source: ModelNode, target: ModelNode, phase: number) {
        this.id = data.id ?? `${data.source}->${data.target}`;
        this.source = source;
        this.target = target;
        this.label = data.label ?? null;
        this.kind = data.kind ?? 'flow';
        this.animated = data.animated ?? false;
        this.phase = phase;
    }

}
