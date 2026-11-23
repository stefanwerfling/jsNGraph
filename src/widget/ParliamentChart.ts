import { ParliamentGeometry, Seat } from './ParliamentGeometry';
import { paletteColor, svgEl, Widget, WidgetOptions } from './WidgetBase';

/** A party (or bloc) and its seats, filled into the hemicycle in the given order (left → right). */
export interface ParliamentParty {
    id: string;
    label: string;
    seats: number;
    /** Any CSS colour (default: the palette). */
    color?: string;
}

export interface ParliamentChartOptions extends WidgetOptions {
    parties?: ParliamentParty[];
    /** Total seats (default: the sum; more leaves empty seats). */
    total?: number;
    /** Inner radius as a share of the outer one (default 0.4). */
    inner?: number;
    /** Fixed number of rows (default: as many as needed). */
    rows?: number;
    /** Seats needed for a majority shown in the centre: a number, true = more than half (default), false = none. */
    majority?: number | boolean;
    /** Big centre text (default: the total); '' hides it. */
    centerLabel?: string;
    /** Legend under the chart with seat counts (default true). */
    legend?: boolean;
}

export interface ParliamentChartEvents extends Record<string, unknown> {
    partyHover: {party: ParliamentParty; index: number} | null;
    partyClick: {party: ParliamentParty; index: number; originalEvent: MouseEvent};
}

const R = 100;

/**
 * Parliament chart: seats on a hemicycle, coloured by party in wedges from
 * left to right, with the majority in the centre and a legend with seat
 * counts. Hover a party (seats or legend) to pick it out; new results sweep
 * the colours across the seats. SVG, zero dependencies.
 */
export class ParliamentChart extends Widget<ParliamentChartEvents> {

    private parties: ParliamentParty[] = [];
    private total: number | undefined;
    private readonly inner: number;
    private readonly rows: number | undefined;
    private majority: number | boolean;
    private centerLabel: string | undefined;
    private readonly svg: SVGSVGElement;
    private readonly seatLayer: SVGGElement;
    private readonly center: SVGTextElement;
    private readonly sub: SVGTextElement;
    private readonly legendBox: HTMLDivElement | null;
    private circles: SVGCircleElement[] = [];
    private owners: number[] = [];
    private focus = -1;
    private builtFor = -1;

    public constructor(container: HTMLElement, options: ParliamentChartOptions = {}) {
        super(container, 'wg-parl', options);
        this.total = options.total;
        this.inner = options.inner ?? 0.4;
        this.rows = options.rows;
        this.majority = options.majority ?? true;
        this.centerLabel = options.centerLabel;

        this.svg = svgEl('svg', {class: 'wg-svg', viewBox: `${-R - 4} ${-R - 4} ${2 * R + 8} ${R + 8}`, role: 'img'});
        this.seatLayer = svgEl('g');
        this.center = svgEl('text', {class: 'wg-text wg-parl-total', x: 0, y: -14});
        this.sub = svgEl('text', {class: 'wg-muted wg-parl-sub', x: 0, y: -2});
        this.svg.append(this.seatLayer, this.center, this.sub);
        this.root.appendChild(this.svg);

        if (options.legend ?? true) {
            this.legendBox = document.createElement('div');
            this.legendBox.className = 'wg-parl-legend';
            this.root.appendChild(this.legendBox);
        } else {
            this.legendBox = null;
        }

        this.seatLayer.addEventListener('pointerover', this.onOver);
        this.seatLayer.addEventListener('pointerout', this.onOut);
        this.seatLayer.addEventListener('click', this.onClick);
        this.setParties(options.parties ?? []);
    }

    /** New results; seat colours sweep from left to right. */
    public setParties(parties: ParliamentParty[], total = this.total): void {
        this.parties = parties.map((p) => ({...p, seats: Math.max(0, Math.round(p.seats))}));
        this.total = total;

        const sum = this.parties.reduce((a, p) => a + p.seats, 0);
        const seats = Math.max(sum, total ?? 0);

        if (seats !== this.builtFor) {
            this.build(seats);
        }
        this.owners = ParliamentGeometry.assign(this.parties.map((p) => p.seats), seats);
        this.paint();
        this.buildLegend();
        this.updateCenter(seats);
    }

    public getParties(): ReadonlyArray<ParliamentParty> {
        return this.parties;
    }

    public setMajority(majority: number | boolean): void {
        this.majority = majority;
        this.updateCenter(this.builtFor);
    }

    public setCenterLabel(label: string | undefined): void {
        this.centerLabel = label;
        this.updateCenter(this.builtFor);
    }

    /** Sweep the colours in again from empty seats. */
    public replay(): void {
        for (const c of this.circles) {
            c.style.transition = 'none';
            c.style.fill = 'var(--wg-track)';
        }
        void this.seatLayer.getBoundingClientRect();
        this.paint();
    }

    /** Pick out one party (by id), null for none. */
    public highlight(id: string | null): void {
        this.focus = id === null ? -1 : this.parties.findIndex((p) => p.id === id);
        this.applyFocus();
    }

    public override destroy(): void {
        this.seatLayer.removeEventListener('pointerover', this.onOver);
        this.seatLayer.removeEventListener('pointerout', this.onOut);
        this.seatLayer.removeEventListener('click', this.onClick);
        super.destroy();
    }

    private color(i: number): string {
        return this.parties[i]?.color ?? paletteColor(i);
    }

    private build(total: number): void {
        const {seats, radius} = ParliamentGeometry.seats(total, {inner: this.inner, rows: this.rows});

        this.builtFor = total;
        this.seatLayer.replaceChildren();
        this.circles = seats.map((s: Seat, i) => {
            const c = svgEl('circle', {
                class: 'wg-parl-seat', cx: (s.x * R).toFixed(2), cy: (-s.y * R).toFixed(2), r: (radius * R).toFixed(2)
            });

            c.dataset['seat'] = String(i);
            c.style.fill = 'var(--wg-track)';
            this.seatLayer.appendChild(c);
            return c;
        });
        // commit the empty seats so the first colouring sweeps in
        void this.seatLayer.getBoundingClientRect();
    }

    private paint(): void {
        const n = this.circles.length;
        const sweep = this.animate && typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;

        this.circles.forEach((c, i) => {
            const owner = this.owners[i] ?? -1;
            const fill = owner < 0 ? 'var(--wg-track)' : this.color(owner);

            c.style.transition = sweep
                ? `fill 260ms ease ${Math.round(i / Math.max(1, n) * this.duration)}ms, opacity 150ms`
                : 'opacity 150ms';
            c.style.fill = fill;
            c.dataset['party'] = String(owner);
        });
        this.applyFocus();
    }

    private updateCenter(total: number): void {
        const majority = this.majority === true ? Math.floor(total / 2) + 1 : this.majority === false ? 0 : this.majority;

        this.center.textContent = this.centerLabel ?? String(total);
        this.sub.textContent = majority > 0 ? `${majority} for a majority` : '';
    }

    private buildLegend(): void {
        const box = this.legendBox;

        if (box === null) {
            return;
        }

        box.replaceChildren();
        this.parties.forEach((p, i) => {
            const item = document.createElement('div');
            const dot = document.createElement('span');
            const text = document.createElement('span');

            item.className = 'wg-parl-item';
            dot.className = 'wg-parl-swatch';
            dot.style.background = this.color(i);
            text.textContent = `${p.label} (${p.seats})`;
            item.append(dot, text);
            item.addEventListener('pointerenter', () => this.setFocus(i));
            item.addEventListener('pointerleave', () => this.setFocus(-1));
            box.appendChild(item);
        });
        this.applyFocus();
    }

    private setFocus(index: number): void {
        if (index === this.focus) {
            return;
        }
        this.focus = index;
        this.applyFocus();

        const party = this.parties[index];

        this.events.emit('partyHover', party === undefined ? null : {party, index});
    }

    private applyFocus(): void {
        const f = this.focus;

        for (const c of this.circles) {
            c.style.opacity = f < 0 || c.dataset['party'] === String(f) ? '1' : '0.25';
        }
        if (this.legendBox !== null) {
            Array.from(this.legendBox.children).forEach((el, i) => {
                (el as HTMLElement).style.opacity = f < 0 || i === f ? '1' : '0.45';
            });
        }
    }

    private partyAt(target: EventTarget | null): number {
        const seat = target instanceof Element ? target.closest<SVGCircleElement>('.wg-parl-seat') : null;

        return seat === null ? -1 : Number(seat.dataset['party'] ?? -1);
    }

    private readonly onOver = (e: PointerEvent): void => {
        this.setFocus(this.partyAt(e.target));
    };

    private readonly onOut = (e: PointerEvent): void => {
        if (this.partyAt(e.relatedTarget) < 0) {
            this.setFocus(-1);
        }
    };

    private readonly onClick = (e: MouseEvent): void => {
        const index = this.partyAt(e.target);
        const party = this.parties[index];

        if (party !== undefined) {
            this.events.emit('partyClick', {party, index, originalEvent: e});
        }
    };

}
