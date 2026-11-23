import { RecordGraphData, RecordLink, RecordPort } from './RecordTypes';

export interface RecordLineage {
    /** Row keys (`RecordQuery.key`). */
    rows: Set<string>;
    /** Link ids (`RecordQuery.linkId`). */
    links: Set<string>;
}

/**
 * Pure queries on a record graph: the flow through a row (everything up-
 * and downstream, following links only — never spilling into sibling
 * branches) and the stock arithmetic of producing one unit.
 */
export class RecordQuery {

    public static key(p: RecordPort): string {
        return `${p.node}\u0000${p.row}`;
    }

    /** The id the layout and the chart use for a link (its own id, else `link<index>`). */
    public static linkId(link: RecordLink, index: number): string {
        return link.id ?? `link${index}`;
    }

    /** Everything that flows into `start` (transitively) and everything it flows into. */
    public static lineage(start: RecordPort, links: ReadonlyArray<RecordLink>): RecordLineage {
        const out: RecordLineage = {rows: new Set([RecordQuery.key(start)]), links: new Set()};

        RecordQuery.walk(start, links, 'down', out);
        RecordQuery.walk(start, links, 'up', out);

        return out;
    }

    /** The flow through one link: upstream of its source, downstream of its target, and the link. */
    public static linkLineage(index: number, links: ReadonlyArray<RecordLink>): RecordLineage {
        const link = links[index];
        const out: RecordLineage = {rows: new Set(), links: new Set()};

        if (link === undefined) {
            return out;
        }

        out.rows.add(RecordQuery.key(link.from));
        out.rows.add(RecordQuery.key(link.to));
        out.links.add(RecordQuery.linkId(link, index));
        RecordQuery.walk(link.from, links, 'up', out);
        RecordQuery.walk(link.to, links, 'down', out);

        return out;
    }

    /**
     * Produce one unit of `port`: its value +1, every row linked into it −1.
     * Refuses (false, nothing changes) when an input is not a number above 0.
     * Mutates the rows of `data`.
     */
    public static produce(data: RecordGraphData, port: RecordPort): boolean {
        const row = (p: RecordPort) => data.nodes.find((n) => n.id === p.node)?.rows.find((r) => r.id === p.row);
        const target = row(port);

        if (target === undefined || (target.value !== undefined && typeof target.value !== 'number')) {
            return false;
        }

        const inputs = data.links
            .filter((l) => l.to.node === port.node && l.to.row === port.row && !(l.from.node === port.node && l.from.row === port.row))
            .map((l) => row(l.from));

        if (inputs.some((r) => r === undefined || typeof r.value !== 'number' || r.value <= 0)) {
            return false;
        }

        for (const r of new Set(inputs)) {
            r!.value = (r!.value as number) - 1;
        }
        target.value = (target.value ?? 0) + 1;

        return true;
    }

    private static walk(start: RecordPort, links: ReadonlyArray<RecordLink>, dir: 'up' | 'down', out: RecordLineage): void {
        const seen = new Set([RecordQuery.key(start)]);
        let frontier = [RecordQuery.key(start)];

        while (frontier.length > 0) {
            const next: string[] = [];

            links.forEach((l, i) => {
                const here = RecordQuery.key(dir === 'down' ? l.from : l.to);
                const there = RecordQuery.key(dir === 'down' ? l.to : l.from);

                if (frontier.includes(here)) {
                    out.links.add(RecordQuery.linkId(l, i));
                    out.rows.add(there);
                    if (!seen.has(there)) {
                        seen.add(there);
                        next.push(there);
                    }
                }
            });
            frontier = next;
        }
    }

}
