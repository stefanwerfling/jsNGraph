import { EventEmitter } from '../util/EventEmitter';
import { WorkflowEditor } from './WorkflowEditor';
import { WorkflowRun } from './WorkflowRun';
import { WorkflowRunEvent } from './WorkflowTypes';

export interface WorkflowReplayOptions {
    /** Show the built-in control bar at the bottom of the editor (default true). */
    controls?: boolean;
    /** Playback speed factor (default 1). */
    speed?: number;
    /** Start playing right away (default false). */
    autoplay?: boolean;
    /** Start over at the end instead of stopping (default false). */
    loop?: boolean;
}

export interface WorkflowReplayEvents extends Record<string, unknown> {
    /** The replay moved (playing, seeking, stepping) or started/stopped. */
    time: {time: number; duration: number; playing: boolean};
    /** Playback reached the end. */
    end: {duration: number};
    /** The control bar's close button was pressed; the replay is destroyed. */
    close: Record<string, never>;
}

const SPEEDS = [0.5, 1, 2, 4];

/** 12×12 icons (fill = currentColor) — glyphs like ⏮ come out as colour emoji in some fonts. */
const ICONS = {
    prev: 'M2 2h2v8H2zM10 2v8L4.5 6z',
    next: 'M8 2h2v8H8zM2 2v8l5.5-4z',
    play: 'M3 1.5v9l7.5-4.5z',
    pause: 'M2.5 2h2.5v8H2.5zM7 2h2.5v8H7z',
    close: 'M2.5 1.5 6 5l3.5-3.5 1 1L7 6l3.5 3.5-1 1L6 7l-3.5 3.5-1-1L5 6 1.5 2.5z'
};

/**
 * Plays a recorded run back on an editor: it feeds the editor's status API
 * (`setNodeStatus`, `setConnectionStatus`, `setRunPath`) the state the run
 * had at the current replay time, so badges, item counts, travelling dots
 * and the dimmed path appear as they did live. Works in edit and read-only
 * mode; the document is never touched.
 *
 * Record with `editor.startRecording()` / `stopRecording()`, or build the
 * events from the host's own execution log. Built-in controls: play/pause,
 * step to the previous/next event, a scrubber with a mark per event (red
 * where something failed), speed; Space and ←/→ work while the bar has focus.
 */
export class WorkflowReplay {

    private readonly editor: WorkflowEditor;
    private readonly events: WorkflowRunEvent[];
    private readonly stops: number[];
    private readonly total: number;
    private readonly emitter = new EventEmitter<WorkflowReplayEvents>();
    private readonly loop: boolean;
    private bar: ReplayBar | null = null;
    private current = 0;
    /** How many sorted events are applied to the editor. */
    private applied = 0;
    private speedFactor: number;
    private frame: number | null = null;
    private lastTick = 0;
    private destroyed = false;

    public constructor(editor: WorkflowEditor, events: readonly WorkflowRunEvent[], options: WorkflowReplayOptions = {}) {
        this.editor = editor;
        this.events = WorkflowRun.sorted(events);
        this.stops = WorkflowRun.steps(this.events);
        this.total = WorkflowRun.duration(this.events);
        this.loop = options.loop ?? false;
        this.speedFactor = options.speed ?? 1;

        if (options.controls ?? true) {
            this.bar = new ReplayBar(this, editor.element, this.events, this.total);
        }
        this.reset(0);
        if (options.autoplay === true) {
            this.play();
        }
    }

    public get time(): number {
        return this.current;
    }

    public get duration(): number {
        return this.total;
    }

    public get playing(): boolean {
        return this.frame !== null;
    }

    public get speed(): number {
        return this.speedFactor;
    }

    public play(): void {
        if (this.destroyed || this.frame !== null) {
            return;
        }
        if (this.current >= this.total) {
            this.seek(0);
        }
        this.lastTick = WorkflowReplay.now();
        this.frame = requestAnimationFrame(this.tick);
        this.notify();
    }

    public pause(): void {
        if (this.frame !== null) {
            cancelAnimationFrame(this.frame);
            this.frame = null;
            this.notify();
        }
    }

    public toggle(): void {
        if (this.playing) {
            this.pause();
        } else {
            this.play();
        }
    }

    /** Jump to a moment (ms since the run began); playback continues if it was playing. */
    public seek(time: number): void {
        const t = Math.max(0, Math.min(this.total, time));

        if (t >= this.current) {
            this.advance(t);
        } else {
            this.reset(t);
        }
        this.notify();
    }

    /** Pause and jump to the next event time (or the end). */
    public stepForward(): void {
        this.pause();
        this.seek(this.stops.find((s) => s > this.current) ?? this.total);
    }

    /** Pause and jump to the previous event time (or the start). */
    public stepBack(): void {
        this.pause();

        let target = 0;

        for (const s of this.stops) {
            if (s < this.current) {
                target = s;
            }
        }
        this.seek(target);
    }

    public setSpeed(speed: number): void {
        this.speedFactor = speed > 0 ? speed : 1;
        this.notify();
    }

    public on<K extends keyof WorkflowReplayEvents>(event: K, handler: (payload: WorkflowReplayEvents[K]) => void): this {
        this.emitter.on(event, handler);
        return this;
    }

    public off<K extends keyof WorkflowReplayEvents>(event: K, handler: (payload: WorkflowReplayEvents[K]) => void): this {
        this.emitter.off(event, handler);
        return this;
    }

    /** Stop and remove the controls; `clear` also clears the editor's status (default: keep the picture). */
    public destroy(clear = false): void {
        if (this.destroyed) {
            return;
        }
        this.pause();
        this.destroyed = true;
        this.bar?.remove();
        this.bar = null;
        this.emitter.clear();
        if (clear) {
            this.editor.clearStatus();
        }
    }

    /** Close button of the bar. */
    public close(): void {
        this.emitter.emit('close', {});
        this.destroy();
    }

    private readonly tick = (): void => {
        const now = WorkflowReplay.now();
        const next = this.current + (now - this.lastTick) * this.speedFactor;

        this.lastTick = now;

        if (next >= this.total) {
            this.advance(this.total);
            if (this.loop && this.total > 0) {
                this.reset(0);
                this.frame = requestAnimationFrame(this.tick);
                this.notify();
                return;
            }
            this.frame = null;
            this.notify();
            this.emitter.emit('end', {duration: this.total});
            return;
        }

        this.advance(next);
        this.frame = requestAnimationFrame(this.tick);
        this.notify();
    };

    /** Move forward: apply the events in (current, time]. */
    private advance(time: number): void {
        while (this.applied < this.events.length && this.events[this.applied]!.at <= time) {
            this.applyEvent(this.events[this.applied]!);
            this.applied++;
        }
        this.current = time;
    }

    /** Draw the state at `time` from scratch (moving backwards). */
    private reset(time: number): void {
        const state = WorkflowRun.stateAt(this.events, time);

        this.editor.clearStatus();
        for (const [id, s] of state.nodes) {
            this.editor.setNodeStatus(id, s.status, s.message === undefined ? {} : {message: s.message});
        }
        for (const [id, s] of state.connections) {
            this.editor.setConnectionStatus(id, s);
        }
        if (state.runPath !== null) {
            this.editor.setRunPath(state.runPath.nodes, state.runPath.connections);
        }

        this.applied = 0;
        while (this.applied < this.events.length && this.events[this.applied]!.at <= time) {
            this.applied++;
        }
        this.current = time;
    }

    private applyEvent(e: WorkflowRunEvent): void {
        if ('clear' in e) {
            this.editor.clearStatus();
        } else if ('node' in e) {
            this.editor.setNodeStatus(e.node, e.status, e.message === undefined ? {} : {message: e.message});
        } else if ('connection' in e) {
            this.editor.setConnectionStatus(e.connection, e.state);
        } else {
            this.editor.setRunPath(e.runPath?.nodes ?? null, e.runPath?.connections);
        }
    }

    private notify(): void {
        const payload = {time: this.current, duration: this.total, playing: this.playing};

        this.bar?.update(payload.time, payload.playing, this.speedFactor);
        this.emitter.emit('time', payload);
    }

    /** "1.2 s" under a minute, else "m:ss". */
    public static format(ms: number): string {
        if (ms < 60000) {
            return `${(ms / 1000).toFixed(1)} s`;
        }

        const s = Math.floor(ms / 1000);

        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    private static now(): number {
        return typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

}

/** The built-in control bar; lives in the editor's root, keeps its input to itself. */
class ReplayBar {

    private readonly el: HTMLDivElement;
    private readonly playBtn: HTMLButtonElement;
    private readonly speedBtn: HTMLButtonElement;
    private readonly range: HTMLInputElement;
    private readonly fill: HTMLDivElement;
    private readonly timeEl: HTMLSpanElement;
    private readonly total: number;

    public constructor(replay: WorkflowReplay, host: HTMLElement, events: readonly WorkflowRunEvent[], total: number) {
        this.total = total;
        this.el = document.createElement('div');
        this.el.className = 'wf-replay';
        this.el.setAttribute('role', 'group');
        this.el.setAttribute('aria-label', 'Run replay');

        const button = (label: string, title: string, act: () => void): HTMLButtonElement => {
            const b = document.createElement('button');

            b.type = 'button';
            b.className = 'wf-replay-btn';
            if (label in ICONS) {
                ReplayBar.icon(b, label as keyof typeof ICONS);
            } else {
                b.textContent = label;
            }
            b.title = title;
            b.setAttribute('aria-label', title);
            b.addEventListener('click', act);
            this.el.appendChild(b);
            return b;
        };

        button('prev', 'Previous step', () => replay.stepBack());
        this.playBtn = button('play', 'Play', () => replay.toggle());
        button('next', 'Next step', () => replay.stepForward());

        const track = document.createElement('div');
        track.className = 'wf-replay-track';
        this.fill = document.createElement('div');
        this.fill.className = 'wf-replay-fill';
        track.appendChild(this.fill);

        const errors = new Set(WorkflowRun.errorTimes(events));

        for (const at of WorkflowRun.steps(events)) {
            const mark = document.createElement('span');

            mark.className = errors.has(at) ? 'wf-replay-mark wf-replay-error' : 'wf-replay-mark';
            mark.style.left = `${total > 0 ? (at / total) * 100 : 0}%`;
            track.appendChild(mark);
        }

        this.range = document.createElement('input');
        this.range.type = 'range';
        this.range.className = 'wf-replay-range';
        this.range.min = '0';
        this.range.max = String(total);
        this.range.step = '1';
        this.range.setAttribute('aria-label', 'Replay position');
        this.range.addEventListener('input', () => replay.seek(Number(this.range.value)));
        track.appendChild(this.range);
        this.el.appendChild(track);

        this.timeEl = document.createElement('span');
        this.timeEl.className = 'wf-replay-time';
        this.el.appendChild(this.timeEl);

        this.speedBtn = button('1×', 'Speed', () => {
            const i = SPEEDS.indexOf(replay.speed);

            replay.setSpeed(SPEEDS[(i + 1) % SPEEDS.length]!);
        });
        button('close', 'Close replay', () => replay.close());

        // The editor must not pan, select or take keys for what happens here.
        for (const type of ['pointerdown', 'pointerup', 'dblclick', 'wheel', 'pointerover']) {
            this.el.addEventListener(type, (e) => e.stopPropagation());
        }
        this.el.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
                e.preventDefault();
                replay.toggle();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                if (e.key === 'ArrowLeft') {
                    replay.stepBack();
                } else {
                    replay.stepForward();
                }
            }
        });

        host.appendChild(this.el);
    }

    public update(time: number, playing: boolean, speed: number): void {
        ReplayBar.icon(this.playBtn, playing ? 'pause' : 'play');
        this.playBtn.title = playing ? 'Pause' : 'Play';
        this.playBtn.setAttribute('aria-label', this.playBtn.title);
        this.speedBtn.textContent = `${speed}×`;
        this.range.value = String(Math.round(time));
        this.fill.style.width = `${this.total > 0 ? (time / this.total) * 100 : 100}%`;
        this.timeEl.textContent = `${WorkflowReplay.format(time)} / ${WorkflowReplay.format(this.total)}`;
    }

    private static icon(b: HTMLButtonElement, name: keyof typeof ICONS): void {
        if (b.dataset.icon === name) {
            return;
        }
        b.dataset.icon = name;
        b.innerHTML = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="${ICONS[name]}"/></svg>`;
    }

    public remove(): void {
        this.el.remove();
    }

}
