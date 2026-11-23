import { Color } from '../util/Color';
import { ChartSurface } from './ChartSurface';
import { ChartThemeTokens } from './ChartTheme';
import { Mat4, Vec3, VolumeMath } from './VolumeMath';

/** One channel of the volume (up to four: R, G, B, A of the 3D texture). */
export interface VolumeChannel {
    name: string;
    color: string;
    visible?: boolean;
    /** Multiplier on the channel's values (default 1). */
    gain?: number;
}

export interface VolumeAxis {
    label: string;
    /** Tick positions 0 … 1 along the axis. */
    ticks?: {at: number; label: string}[];
}

export type VolumeMode = 'glow' | 'mip' | 'iso';

export interface VolumeCamera {
    yaw: number;
    pitch: number;
    distance: number;
}

export interface VolumeHit {
    /** Texture position 0 … 1 per axis. */
    u: number;
    v: number;
    w: number;
    /** Channel values 0 … 1 there (before gain). */
    values: number[];
}

export interface VolumeViewOptions {
    /** RGBA bytes, x fastest, then y, then z (see `VolumeMath.splat`). */
    data?: Uint8Array;
    dims?: Vec3;
    /** World proportions of the box (default: the dims). */
    size?: Vec3;
    channels?: VolumeChannel[];
    /** 'glow' = emission/absorption, 'mip' = brightest sample, 'iso' = shaded surface at `threshold`. */
    mode?: VolumeMode;
    /** Values below this are empty (glow) or the surface level (iso), 0 … 1 (default 0.1). */
    threshold?: number;
    /** Opacity per unit length in glow mode (default 1). */
    density?: number;
    /** Visible part of the box, texture coords 0 … 1. */
    clip?: {min: Vec3; max: Vec3};
    axes?: {x?: VolumeAxis; y?: VolumeAxis; z?: VolumeAxis};
    /** Draw on the floor of the box (under the volume): `at(u, v)` gives screen px. */
    floor?: (ctx: CanvasRenderingContext2D, at: (u: number, v: number) => {x: number; y: number}) => void;
    camera?: Partial<VolumeCamera>;
    /** Degrees per second while nobody drags (default 0). */
    autoRotate?: number;
    /** Tooltip lines for a hit (default: channel values). */
    format?: (hit: VolumeHit, channels: VolumeChannel[]) => string[];
    /** Ray-march samples across the box (default 280). */
    quality?: number;
    theme?: 'dark' | 'light' | Partial<ChartThemeTokens>;
}

export interface VolumeViewEvents extends Record<string, unknown> {
    hover: VolumeHit | null;
    click: VolumeHit | null;
    viewChange: VolumeCamera;
}

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler3D uVol;
uniform mat4 uInv;
uniform vec3 uEye, uMin, uMax, uBoxMin, uBoxSize;
uniform vec4 uW;
uniform vec3 uC0, uC1, uC2, uC3;
uniform float uThr, uDensity, uStep;
uniform int uMode;
in vec2 vNdc;
out vec4 o;
float field(vec3 t) { return dot(texture(uVol, t), uW); }
void main() {
    vec4 f4 = uInv * vec4(vNdc, 1.0, 1.0);
    vec3 ro = uEye;
    vec3 rd = normalize(f4.xyz / f4.w - ro);
    vec3 inv = 1.0 / rd;
    vec3 a = (uMin - ro) * inv, b = (uMax - ro) * inv;
    vec3 lo = min(a, b), hi = max(a, b);
    float t0 = max(max(lo.x, lo.y), lo.z), t1 = min(min(hi.x, hi.y), hi.z);
    if (t1 < max(t0, 0.0)) { o = vec4(0.0); return; }
    t0 = max(t0, 0.0);
    float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    int n = int(min(900.0, ceil((t1 - t0) / uStep)));
    float dt = (t1 - t0) / float(max(n, 1));
    vec3 acc = vec3(0.0);
    float al = 0.0;
    vec4 mx = vec4(0.0);
    for (int i = 0; i < 900; i++) {
        if (i >= n) break;
        vec3 p = ro + rd * (t0 + (float(i) + jit) * dt);
        vec3 tc = (p - uBoxMin) / uBoxSize;
        vec4 v = texture(uVol, tc) * uW;
        if (uMode == 1) { mx = max(mx, v); continue; }
        if (uMode == 2) {
            float f = v.x + v.y + v.z + v.w;
            if (f >= uThr) {
                vec3 e = 1.0 / vec3(textureSize(uVol, 0));
                vec3 g = vec3(field(tc + vec3(e.x, 0, 0)) - field(tc - vec3(e.x, 0, 0)),
                              field(tc + vec3(0, e.y, 0)) - field(tc - vec3(0, e.y, 0)),
                              field(tc + vec3(0, 0, e.z)) - field(tc - vec3(0, 0, e.z)));
                vec3 nrm = normalize(-g / uBoxSize + vec3(1e-6));
                vec3 col = (v.x * uC0 + v.y * uC1 + v.z * uC2 + v.w * uC3) / max(f, 1e-4);
                vec3 L = normalize(vec3(0.4, -0.5, 0.8));
                float diff = max(dot(nrm, L), 0.0) * 0.7 + 0.3;
                float rim = pow(1.0 - abs(dot(nrm, rd)), 2.0) * 0.35;
                o = vec4(col * diff + rim, 1.0);
                return;
            }
            continue;
        }
        vec4 s = max(v - vec4(uThr), 0.0);
        float f = s.x + s.y + s.z + s.w;
        if (f <= 0.0) continue;
        vec3 col = (s.x * uC0 + s.y * uC1 + s.z * uC2 + s.w * uC3) / f;
        float k = 1.0 - exp(-f * uDensity * dt * 30.0);
        acc += (1.0 - al) * k * col * (1.0 + 1.5 * f);
        al += (1.0 - al) * k;
        if (al > 0.985) break;
    }
    if (uMode == 1) {
        vec3 col = mx.x * uC0 + mx.y * uC1 + mx.z * uC2 + mx.w * uC3;
        float m = max(max(mx.x, mx.y), max(mx.z, mx.w));
        float alpha = clamp(m * 1.4, 0.0, 1.0);
        o = vec4(min(col * 1.2, vec3(alpha)), alpha);
        return;
    }
    if (uMode == 2) { o = vec4(0.0); return; }
    o = vec4(min(acc, vec3(1.0)), al);
}`;

const FONT = 'system-ui, -apple-system, sans-serif';
const HOME: VolumeCamera = {yaw: -28, pitch: 24, distance: 2.6};

/**
 * A density volume rendered on the GPU: a 4-channel 3D texture ray-marched
 * in a WebGL2 fragment shader (glowing emission/absorption, brightest-sample
 * or a shaded iso surface), inside a box you orbit and clip. A 2D floor
 * under it (grid + your drawing), box edges, axis ticks and a picked-voxel
 * tooltip over it. Without WebGL2 it says so instead of drawing.
 */
export class VolumeView extends ChartSurface<VolumeViewEvents> {

    private readonly floorCanvas: HTMLCanvasElement;
    private readonly floorCtx: CanvasRenderingContext2D;
    private readonly glCanvas: HTMLCanvasElement;
    private gl: WebGL2RenderingContext | null = null;
    private program: WebGLProgram | null = null;
    private texture: WebGLTexture | null = null;
    private uniforms = new Map<string, WebGLUniformLocation | null>();
    private failure: string | null = null;

    private data: Uint8Array = new Uint8Array(4);
    private dims: Vec3 = [1, 1, 1];
    private box: Vec3 = [1, 1, 1];
    private channels: VolumeChannel[];
    private mode: VolumeMode;
    private threshold: number;
    private density: number;
    private clip: {min: Vec3; max: Vec3};
    private axes: {x?: VolumeAxis; y?: VolumeAxis; z?: VolumeAxis};
    private readonly floor: VolumeViewOptions['floor'];
    private cam: VolumeCamera;
    private autoRotate: number;
    private readonly format: (hit: VolumeHit, channels: VolumeChannel[]) => string[];
    private readonly quality: number;
    private viewProj: Mat4 = new Float32Array(16);
    private invViewProj: Mat4 | null = null;
    private eye: Vec3 = [0, 0, 1];
    private lastNow = -1;
    private drag: {x: number; y: number; cam: VolumeCamera; moved: boolean} | null = null;
    private pointer: {x: number; y: number} | null = null;
    private hit: VolumeHit | null = null;
    private dirtyTexture = true;

    public constructor(container: HTMLElement, options: VolumeViewOptions = {}) {
        super(container, options.theme ?? {background: 'rgba(0,0,0,0)', text: '#8b97b5', title: '#dfe6ff'});
        this.channels = options.channels ?? [{name: 'density', color: '#7cc4ff'}];
        this.mode = options.mode ?? 'glow';
        this.threshold = options.threshold ?? 0.1;
        this.density = options.density ?? 1;
        this.clip = options.clip ?? {min: [0, 0, 0], max: [1, 1, 1]};
        this.axes = options.axes ?? {};
        this.floor = options.floor;
        this.cam = {...HOME, ...options.camera};
        this.autoRotate = options.autoRotate ?? 0;
        this.quality = options.quality ?? 280;
        this.format = options.format ?? ((h, ch) => ch.map((c, i) => `${c.name}: ${(h.values[i] ?? 0).toFixed(2)}`));

        // layers: floor (2d) → volume (webgl2) → the base class canvas on top (edges, labels, tooltip)
        this.floorCanvas = document.createElement('canvas');
        this.glCanvas = document.createElement('canvas');
        for (const c of [this.floorCanvas, this.glCanvas]) {
            c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none';
            this.root.insertBefore(c, this.canvas);
        }
        this.floorCtx = this.floorCanvas.getContext('2d')!;
        this.initGl();
        if (options.data !== undefined && options.dims !== undefined) {
            this.setVolume(options.data, options.dims, options.size);
        }

        this.canvas.addEventListener('pointerdown', this.onDown);
        this.canvas.addEventListener('pointermove', this.onMove);
        this.canvas.addEventListener('pointerup', this.onUp);
        this.canvas.addEventListener('pointerleave', this.onLeave);
        this.canvas.addEventListener('wheel', this.onWheel, {passive: false});
        this.canvas.addEventListener('dblclick', this.onDblClick);
        this.redraw();
    }

    /** False when WebGL2 (or 3D textures) is missing or the context was lost. */
    public isSupported(): boolean {
        return this.failure === null;
    }

    // ---- data & settings ---------------------------------------------------------------------------

    public setVolume(data: Uint8Array, dims: Vec3, size?: Vec3): void {
        if (data.length < dims[0] * dims[1] * dims[2] * 4) {
            throw new Error('VolumeView: data shorter than dims × 4');
        }
        this.data = data;
        this.dims = dims;

        const s = size ?? dims;
        const m = Math.max(s[0], s[1], s[2]);

        this.box = [s[0] / m, s[1] / m, s[2] / m];
        this.dirtyTexture = true;
        this.redraw();
    }

    public setChannels(channels: VolumeChannel[]): void {
        this.channels = channels;
        this.redraw();
    }

    public setChannelVisible(index: number, visible: boolean): void {
        const c = this.channels[index];

        if (c !== undefined) {
            c.visible = visible;
            this.redraw();
        }
    }

    public setMode(mode: VolumeMode): void {
        this.mode = mode;
        this.redraw();
    }

    public setThreshold(v: number): void {
        this.threshold = v;
        this.redraw();
    }

    public setDensity(v: number): void {
        this.density = v;
        this.redraw();
    }

    /** Visible part, texture coords 0 … 1 per axis. */
    public setClip(min: Vec3, max: Vec3): void {
        this.clip = {min: [...min], max: [...max]};
        this.redraw();
    }

    public setAutoRotate(degPerSecond: number): void {
        this.autoRotate = degPerSecond;
        this.lastNow = -1;
        this.redraw();
    }

    public setCamera(cam: Partial<VolumeCamera>): void {
        this.cam = {...this.cam, ...cam};
        this.events.emit('viewChange', {...this.cam});
        this.redraw();
    }

    public getCamera(): VolumeCamera {
        return {...this.cam};
    }

    public resetView(): void {
        this.setCamera(HOME);
    }

    public override destroy(): void {
        this.canvas.removeEventListener('pointerdown', this.onDown);
        this.canvas.removeEventListener('pointermove', this.onMove);
        this.canvas.removeEventListener('pointerup', this.onUp);
        this.canvas.removeEventListener('pointerleave', this.onLeave);
        this.canvas.removeEventListener('wheel', this.onWheel);
        this.canvas.removeEventListener('dblclick', this.onDblClick);
        if (this.gl !== null) {
            this.gl.deleteTexture(this.texture);
            this.gl.deleteProgram(this.program);
            this.gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
        super.destroy();
    }

    // ---- webgl ----------------------------------------------------------------------------------------

    private initGl(): void {
        const gl = this.glCanvas.getContext('webgl2', {premultipliedAlpha: true, antialias: false, alpha: true});

        if (gl === null) {
            this.failure = 'WebGL2 is not available in this browser.';
            return;
        }

        const compile = (type: number, src: string): WebGLShader | null => {
            const sh = gl.createShader(type)!;
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                this.failure = 'Shader: ' + (gl.getShaderInfoLog(sh) ?? '?');
                return null;
            }
            return sh;
        };
        const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG);

        if (vs === null || fs === null) {
            return;
        }

        const p = gl.createProgram()!;

        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.bindAttribLocation(p, 0, 'aPos');
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            this.failure = 'Link: ' + (gl.getProgramInfoLog(p) ?? '?');
            return;
        }

        const buf = gl.createBuffer();

        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        for (const name of ['uVol', 'uInv', 'uEye', 'uMin', 'uMax', 'uBoxMin', 'uBoxSize', 'uW', 'uC0', 'uC1', 'uC2', 'uC3', 'uThr', 'uDensity', 'uStep', 'uMode']) {
            this.uniforms.set(name, gl.getUniformLocation(p, name));
        }
        this.gl = gl;
        this.program = p;
        this.texture = gl.createTexture();
        this.glCanvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            this.failure = 'The WebGL context was lost.';
            this.gl = null;
            this.redraw();
        });
    }

    private upload(): void {
        const gl = this.gl;

        if (gl === null || !this.dirtyTexture) {
            return;
        }
        this.dirtyTexture = false;
        gl.bindTexture(gl.TEXTURE_3D, this.texture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, this.dims[0], this.dims[1], this.dims[2], 0, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) {
            gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
        }
    }

    private weights(): number[] {
        return [0, 1, 2, 3].map((i) => {
            const c = this.channels[i];
            return c === undefined || c.visible === false ? 0 : c.gain ?? 1;
        });
    }

    private rgb(i: number): Vec3 {
        const c = Color.parse(this.channels[i]?.color ?? '#000000');

        return c === null ? [0, 0, 0] : [c.r / 255, c.g / 255, c.b / 255];
    }

    private boxMin(): Vec3 {
        return [-this.box[0] / 2, -this.box[1] / 2, -this.box[2] / 2];
    }

    /** Texture coords → world. */
    private world(u: number, v: number, w: number): Vec3 {
        const m = this.boxMin();

        return [m[0] + u * this.box[0], m[1] + v * this.box[1], m[2] + w * this.box[2]];
    }

    private renderVolume(): void {
        const gl = this.gl;

        if (gl === null || this.program === null) {
            return;
        }

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.max(1, Math.round(this.width * dpr)), h = Math.max(1, Math.round(this.height * dpr));

        if (this.glCanvas.width !== w || this.glCanvas.height !== h) {
            this.glCanvas.width = w;
            this.glCanvas.height = h;
        }
        this.upload();
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.program);

        const u = (n: string): WebGLUniformLocation | null => this.uniforms.get(n) ?? null;
        const bm = this.boxMin();
        const wt = this.weights();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_3D, this.texture);
        gl.uniform1i(u('uVol'), 0);
        gl.uniformMatrix4fv(u('uInv'), false, this.invViewProj!);
        gl.uniform3fv(u('uEye'), this.eye);
        gl.uniform3fv(u('uMin'), this.world(...this.clip.min));
        gl.uniform3fv(u('uMax'), this.world(...this.clip.max));
        gl.uniform3fv(u('uBoxMin'), bm);
        gl.uniform3fv(u('uBoxSize'), this.box);
        gl.uniform4f(u('uW'), wt[0]!, wt[1]!, wt[2]!, wt[3]!);
        gl.uniform3fv(u('uC0'), this.rgb(0));
        gl.uniform3fv(u('uC1'), this.rgb(1));
        gl.uniform3fv(u('uC2'), this.rgb(2));
        gl.uniform3fv(u('uC3'), this.rgb(3));
        gl.uniform1f(u('uThr'), this.threshold);
        gl.uniform1f(u('uDensity'), this.density);
        gl.uniform1f(u('uStep'), Math.hypot(...this.box) / this.quality);
        gl.uniform1i(u('uMode'), this.mode === 'mip' ? 1 : this.mode === 'iso' ? 2 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ---- frame -------------------------------------------------------------------------------------------

    protected draw(ctx: CanvasRenderingContext2D, now: number): boolean {
        const spinning = this.autoRotate !== 0 && this.drag === null;

        if (spinning && this.lastNow >= 0) {
            this.cam.yaw += this.autoRotate * Math.min(0.1, (now - this.lastNow) / 1000);
        }
        this.lastNow = spinning ? now : -1;

        this.eye = VolumeMath.orbit(this.cam.yaw, this.cam.pitch, this.cam.distance);
        const proj = VolumeMath.perspective(35, this.width / Math.max(1, this.height), 0.05, 50);
        const view = VolumeMath.lookAt(this.eye, [0, 0, 0], [0, 0, 1]);
        this.viewProj = VolumeMath.multiply(proj, view);
        this.invViewProj = VolumeMath.invert(this.viewProj);

        this.drawFloor();
        this.renderVolume();
        this.drawBox(ctx);
        this.drawAxes(ctx);
        if (this.failure !== null) {
            ctx.font = `13px ${FONT}`;
            ctx.fillStyle = this.theme.title;
            ctx.textAlign = 'center';
            ctx.fillText(this.failure, this.width / 2, this.height / 2);
        }
        if (spinning && this.pointer !== null && this.drag === null) {
            this.pick(this.pointer.x, this.pointer.y);
        }
        this.drawTooltip(ctx);

        return spinning;
    }

    private toScreen(p: Vec3): {x: number; y: number; z: number} {
        const q = VolumeMath.transform(this.viewProj, p);

        return {x: (q.x + 1) / 2 * this.width, y: (1 - q.y) / 2 * this.height, z: q.w};
    }

    private drawFloor(): void {
        const c = this.floorCanvas, ctx = this.floorCtx;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.round(this.width * dpr), h = Math.round(this.height * dpr);

        if (c.width !== w || c.height !== h) {
            c.width = w;
            c.height = h;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const bg = ctx.createRadialGradient(this.width / 2, this.height * 0.55, 0, this.width / 2, this.height / 2, Math.hypot(this.width, this.height) * 0.6);
        bg.addColorStop(0, '#141b33');
        bg.addColorStop(1, '#070a14');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, this.width, this.height);

        const at = (u: number, v: number): {x: number; y: number} => this.toScreen(this.world(u, v, 0));

        // floor plate + grid
        const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => at(u!, v!));
        ctx.beginPath();
        corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = 'rgba(120,150,220,0.05)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(140,170,240,0.09)';
        ctx.lineWidth = 1;
        for (let k = 1; k < 10; k++) {
            const a = at(k / 10, 0), b = at(k / 10, 1), d = at(0, k / 10), e = at(1, k / 10);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(e.x, e.y);
            ctx.stroke();
        }
        if (this.floor !== undefined) {
            ctx.save();
            this.floor(ctx, at);
            ctx.restore();
        }
    }

    private drawBox(ctx: CanvasRenderingContext2D): void {
        const edges = (min: Vec3, max: Vec3, color: string, width: number): void => {
            const c = (i: number): Vec3 => this.world(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]);
            const pairs = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.beginPath();
            for (const [a, b] of pairs) {
                const p = this.toScreen(c(a!)), q = this.toScreen(c(b!));
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(q.x, q.y);
            }
            ctx.stroke();
        };

        edges([0, 0, 0], [1, 1, 1], 'rgba(160,185,255,0.18)', 1);
        const clipped = this.clip.min.some((v) => v > 0) || this.clip.max.some((v) => v < 1);
        if (clipped) {
            edges(this.clip.min, this.clip.max, 'rgba(255,214,120,0.55)', 1.2);
        }
    }

    private drawAxes(ctx: CanvasRenderingContext2D): void {
        const e = this.eye;
        // the floor edges nearest the viewer carry x and y; the leftmost vertical edge carries z
        const vy = e[1] < 0 ? 0 : 1, vx = e[0] < 0 ? 0 : 1;
        const verticals = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => ({u: u!, v: v!, s: this.toScreen(this.world(u!, v!, 0))}));
        const zEdge = verticals.reduce((m, p) => (p.s.x < m.s.x ? p : m), verticals[0]!);
        const tickAt = (p: Vec3, out: Vec3, label: string, align: CanvasTextAlign): void => {
            const a = this.toScreen(p);
            const b = this.toScreen([p[0] + out[0] * 0.04, p[1] + out[1] * 0.04, p[2] + out[2] * 0.04]);
            ctx.strokeStyle = this.theme.text;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.textAlign = align;
            ctx.fillText(label, b.x + (b.x - a.x) * 0.6, b.y + (b.y - a.y) * 0.6);
        };

        ctx.font = `10px ${FONT}`;
        ctx.fillStyle = this.theme.text;
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 1;
        const outY: Vec3 = [0, vy === 0 ? -1 : 1, 0], outX: Vec3 = [vx === 0 ? -1 : 1, 0, 0];
        for (const t of this.axes.x?.ticks ?? []) {
            tickAt(this.world(t.at, vy, 0), outY, t.label, 'center');
        }
        for (const t of this.axes.y?.ticks ?? []) {
            tickAt(this.world(vx, t.at, 0), outX, t.label, 'center');
        }
        const zOut: Vec3 = [zEdge.u === 0 ? -1 : 1, zEdge.v === 0 ? -1 : 1, 0];
        for (const t of this.axes.z?.ticks ?? []) {
            tickAt(this.world(zEdge.u, zEdge.v, t.at), zOut, t.label, 'right');
        }

        ctx.font = `600 11px ${FONT}`;
        ctx.fillStyle = this.theme.title;
        const lab = (p: Vec3, text: string | undefined): void => {
            if (text === undefined) {
                return;
            }
            const s = this.toScreen(p);
            ctx.textAlign = 'center';
            ctx.fillText(text, s.x, s.y);
        };
        lab(this.world(0.5, vy === 0 ? -0.16 : 1.16, 0), this.axes.x?.label);
        lab(this.world(vx === 0 ? -0.16 : 1.16, 0.5, 0), this.axes.y?.label);
        lab(this.world(zEdge.u, zEdge.v, 1.07), this.axes.z?.label);
    }

    private drawTooltip(ctx: CanvasRenderingContext2D): void {
        const h = this.hit;

        if (h === null || this.pointer === null || this.drag?.moved === true) {
            return;
        }

        const s = this.toScreen(this.world(h.u, h.v, h.w));

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
        ctx.stroke();
        // drop line to the floor
        const f = this.toScreen(this.world(h.u, h.v, 0));
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.moveTo(s.x, s.y + 5);
        ctx.lineTo(f.x, f.y);
        ctx.stroke();
        ctx.setLineDash([]);

        const lines = this.format(h, this.channels);
        ctx.font = `12px ${FONT}`;
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
        const hh = lines.length * 16 + 12;
        const x = Math.max(4, Math.min(this.width - w - 4, this.pointer.x + 16));
        const y = Math.max(4, Math.min(this.height - hh - 4, this.pointer.y + 16));

        ctx.fillStyle = 'rgba(8,11,24,0.93)';
        ctx.strokeStyle = 'rgba(160,185,255,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, w, hh, 5);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        lines.forEach((l, i) => {
            ctx.font = i === 0 ? `600 12px ${FONT}` : `12px ${FONT}`;
            ctx.fillStyle = i === 0 ? this.theme.title : this.theme.text;
            ctx.fillText(l, x + 10, y + 7 + i * 16);
        });
    }

    // ---- input -------------------------------------------------------------------------------------------------

    private pick(x: number, y: number): void {
        const inv = this.invViewProj;

        if (inv === null) {
            this.hit = null;
            return;
        }

        const nx = x / this.width * 2 - 1, ny = 1 - y / this.height * 2;
        const far = VolumeMath.transform(inv, [nx, ny, 1]);
        const dir = VolumeMath.norm([far.x - this.eye[0], far.y - this.eye[1], far.z - this.eye[2]]);
        const best = VolumeMath.strongest(this.data, this.dims, this.eye, dir,
            this.world(...this.clip.min), this.world(...this.clip.max), this.weights(), 160);
        // strongest() reports coordinates relative to the clip box: back to the whole box
        const hit = best === null || best.sum < Math.max(0.02, this.mode === 'glow' ? this.threshold : this.threshold * 0.8) ? null : {
            u: this.clip.min[0] + best.u * (this.clip.max[0] - this.clip.min[0]),
            v: this.clip.min[1] + best.v * (this.clip.max[1] - this.clip.min[1]),
            w: this.clip.min[2] + best.w * (this.clip.max[2] - this.clip.min[2]),
            values: best.values
        };

        if ((hit === null) !== (this.hit === null) || hit !== null) {
            this.events.emit('hover', hit);
        }
        this.hit = hit;
    }

    private readonly onDown = (e: PointerEvent): void => {
        const p = this.local(e);

        this.drag = {x: p.x, y: p.y, cam: {...this.cam}, moved: false};
        this.canvas.setPointerCapture(e.pointerId);
    };

    private readonly onMove = (e: PointerEvent): void => {
        const p = this.local(e);

        this.pointer = p;
        if (this.drag !== null) {
            const dx = p.x - this.drag.x, dy = p.y - this.drag.y;
            if (Math.hypot(dx, dy) > 3) {
                this.drag.moved = true;
            }
            if (this.drag.moved) {
                this.cam = {
                    ...this.drag.cam,
                    yaw: this.drag.cam.yaw - dx * 0.35,
                    pitch: Math.max(-85, Math.min(88, this.drag.cam.pitch + dy * 0.3))
                };
                this.canvas.style.cursor = 'grabbing';
                this.events.emit('viewChange', {...this.cam});
                this.redraw();
                return;
            }
        }
        this.pick(p.x, p.y);
        this.canvas.style.cursor = this.hit !== null ? 'crosshair' : 'grab';
        this.redraw();
    };

    private readonly onUp = (e: PointerEvent): void => {
        const d = this.drag;

        this.drag = null;
        if (this.canvas.hasPointerCapture(e.pointerId)) {
            this.canvas.releasePointerCapture(e.pointerId);
        }
        this.canvas.style.cursor = 'grab';
        if (d !== null && !d.moved) {
            const p = this.local(e);
            this.pick(p.x, p.y);
            this.events.emit('click', this.hit);
        }
        this.redraw();
    };

    private readonly onLeave = (): void => {
        this.pointer = null;
        if (this.hit !== null) {
            this.hit = null;
            this.events.emit('hover', null);
        }
        this.redraw();
    };

    private readonly onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        this.cam = {...this.cam, distance: Math.max(0.6, Math.min(8, this.cam.distance * Math.exp(e.deltaY * 0.0012)))};
        this.events.emit('viewChange', {...this.cam});
        this.redraw();
    };

    private readonly onDblClick = (): void => {
        this.resetView();
    };

}
