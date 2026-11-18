import { GraphEdge } from '../model/GraphEdge';
import { GraphNode } from '../model/GraphNode';

/**
 * No simulation: nodes stay exactly where `x`/`y`, setPositions or a drag
 * put them. For hosts that compute the layout elsewhere (a server, a
 * worker, a saved arrangement) and only want rendering and interaction.
 */
export class StaticLayout {

    public reheat(_alpha = 1): void {
        // nothing to warm up
    }

    public tick(_nodes: GraphNode[], _edges: GraphEdge[], _width: number, _height: number): void {
        // positions are owned by the host
    }

}
