import { FlowKind } from './ModelTypes';

export interface GranModule {
    id: string;
    level: number;
    parent: string | null;
}

export interface GranFlow {
    source: string;
    target: string;
    kind?: FlowKind;
    animated?: boolean;
    label?: string | null;
}

export interface ResolvedFlow {
    source: string;
    target: string;
    kind: FlowKind;
    animated: boolean;
    label: string | null;
}

/**
 * Derives a single granularity level from a containment forest of modules.
 *
 * Modules form a tree via `parent`; each has a `level` = the granularity at
 * which it is revealed. At granularity G a module is VISIBLE when it is
 * revealed (level ≤ G) and not expanded (no direct child is also revealed) —
 * i.e. it sits on the frontier of the revealed tree. Flows are authored
 * between the finest leaves; here each endpoint is remapped UP to its nearest
 * visible ancestor, flows that collapse onto a single module are dropped as
 * internal, and duplicates are merged. Pure data in / data out, no DOM — so
 * the collapse rules are unit-testable (see test/Granularity.test.ts).
 */
export class Granularity {

    public static maxLevel(modules: GranModule[]): number {
        return modules.reduce((max, module) => Math.max(max, module.level), 0);
    }

    /** Ids visible at granularity `g`. */
    public static visible(modules: GranModule[], g: number): Set<string> {
        const revealedChild = new Set<string>();

        for (const module of modules) {
            if (module.level <= g && module.parent !== null) {
                revealedChild.add(module.parent);
            }
        }

        const result = new Set<string>();

        for (const module of modules) {
            if (module.level <= g && !revealedChild.has(module.id)) {
                result.add(module.id);
            }
        }

        return result;
    }

    /**
     * Visible representative of a module: itself when visible, else the nearest
     * ancestor that is visible. Returns null if the chain has none (e.g. a leaf
     * whose whole branch is above the current level with no revealed ancestor).
     */
    public static representative(id: string, byId: Map<string, GranModule>, visible: Set<string>): string | null {
        let current: GranModule | undefined = byId.get(id);

        while (current !== undefined) {
            if (visible.has(current.id)) {
                return current.id;
            }

            current = current.parent !== null ? byId.get(current.parent) : undefined;
        }

        return null;
    }

    /**
     * Remap every flow's endpoints to their visible representative, drop flows
     * that become internal to one module, and merge duplicates (animated if any
     * duplicate was; first flow's kind/label wins). Input order is preserved.
     */
    public static resolveFlows(flows: GranFlow[], byId: Map<string, GranModule>, visible: Set<string>): ResolvedFlow[] {
        const result: ResolvedFlow[] = [];
        const index = new Map<string, ResolvedFlow>();

        for (const flow of flows) {
            const source = Granularity.representative(flow.source, byId, visible);
            const target = Granularity.representative(flow.target, byId, visible);

            if (source === null || target === null || source === target) {
                continue;
            }

            const key = `${source}->${target}`;
            const existing = index.get(key);

            if (existing !== undefined) {
                existing.animated = existing.animated || (flow.animated ?? false);
                continue;
            }

            const resolved: ResolvedFlow = {
                source: source,
                target: target,
                kind: flow.kind ?? 'flow',
                animated: flow.animated ?? false,
                label: flow.label ?? null
            };

            index.set(key, resolved);
            result.push(resolved);
        }

        return result;
    }

}
