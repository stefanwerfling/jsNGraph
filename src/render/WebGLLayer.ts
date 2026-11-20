import { Color } from '../util/Color';
import { ARROW_STRIDE, BulkBuffers, DISC_STRIDE, LINE_STRIDE } from './BulkBuffers';

/** Screen = world · scale + offset, all in CSS pixels. */
export interface GlView {
    scale: number;
    offsetX: number;
    offsetY: number;
}

const HEADER = `#version 300 es
uniform vec3 u_view;
uniform vec2 u_size;
vec4 clip(vec2 p) { return vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0); }
`;

/** Edge quad: 1 CSS px wider than the stroke on each side for antialiasing; hairlines fade instead of thinning. */
const LINE_VS = `${HEADER}
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 i_seg;
layout(location = 2) in float i_width;
layout(location = 3) in vec4 i_color;
out vec4 v_color;
out float v_dist;
out float v_half;
void main() {
    vec2 a = i_seg.xy * u_view.x + u_view.yz;
    vec2 b = i_seg.zw * u_view.x + u_view.yz;
    vec2 d = b - a;
    float len = length(d);
    vec2 dir = len > 0.0 ? d / len : vec2(1.0, 0.0);
    vec2 n = vec2(-dir.y, dir.x);
    float w = i_width * u_view.x;
    float drawW = max(w, 1.0);
    v_half = drawW * 0.5;
    v_dist = a_corner.y * (drawW + 2.0);
    v_color = vec4(i_color.rgb, i_color.a * min(w, 1.0));
    gl_Position = clip(a + dir * (a_corner.x * len) + n * v_dist);
}`;

const LINE_FS = `#version 300 es
precision mediump float;
in vec4 v_color;
in float v_dist;
in float v_half;
out vec4 o;
void main() {
    float a = v_color.a * clamp(v_half + 0.5 - abs(v_dist), 0.0, 1.0);
    o = vec4(v_color.rgb * a, a);
}`;

const ARROW_VS = `${HEADER}
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 i_arrow;
layout(location = 2) in float i_size;
layout(location = 3) in vec4 i_color;
out vec4 v_color;
void main() {
    vec2 tip = i_arrow.xy * u_view.x + u_view.yz;
    vec2 dir = i_arrow.zw;
    vec2 n = vec2(-dir.y, dir.x);
    float s = i_size * u_view.x;
    v_color = i_color;
    gl_Position = clip(tip + dir * (a_corner.x * s) + n * (a_corner.y * s));
}`;

const FLAT_FS = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 o;
void main() { o = vec4(v_color.rgb * v_color.a, v_color.a); }`;

/** Dot: signed-distance disc with a 1 world-px rim (dropped below 2 px radius, like the 2d LOD squares). */
const DISC_VS = `${HEADER}
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec3 i_disc;
layout(location = 2) in vec4 i_fill;
layout(location = 3) in vec4 i_stroke;
out vec2 v_local;
out float v_r;
out float v_sw;
out vec4 v_fill;
out vec4 v_stroke;
void main() {
    vec2 c = i_disc.xy * u_view.x + u_view.yz;
    float r = max(i_disc.z * u_view.x, 0.6);
    float sw = r < 2.0 ? 0.0 : u_view.x;
    v_local = a_corner * (r + sw * 0.5 + 1.0);
    v_r = r;
    v_sw = sw;
    v_fill = i_fill;
    v_stroke = i_stroke;
    gl_Position = clip(c + v_local);
}`;

const DISC_FS = `#version 300 es
precision mediump float;
in vec2 v_local;
in float v_r;
in float v_sw;
in vec4 v_fill;
in vec4 v_stroke;
out vec4 o;
void main() {
    float d = length(v_local);
    float cov = clamp(v_r + v_sw * 0.5 + 0.5 - d, 0.0, 1.0);
    float inner = v_sw > 0.0 ? clamp(v_r - v_sw * 0.5 + 0.5 - d, 0.0, 1.0) : 1.0;
    vec4 col = mix(v_stroke, v_fill, inner);
    float a = col.a * cov;
    if (a <= 0.0) discard;
    o = vec4(col.rgb * a, a);
}`;

interface Pass {
    program: WebGLProgram;
    vao: WebGLVertexArrayObject;
    instances: WebGLBuffer;
    view: WebGLUniformLocation | null;
    size: WebGLUniformLocation | null;
    corners: number;
}

/** Instance attribute layout: [location, components] in buffer order. */
type Layout = ReadonlyArray<readonly [number, number]>;

/**
 * Optional WebGL2 layer under the 2d canvas (J11). Draws the bulk of a big
 * graph — plain straight edges, their arrowheads, plain dots — as three
 * instanced draw calls, whatever the count. Everything with detail (cards,
 * icons, rings, hover/selection, labels, curves, dashes, hulls, overlays,
 * clusters) stays on the 2d canvas above it.
 */
export class WebGLLayer {

    /** A WebGL2 layer on `canvas`, or null when WebGL2 is unavailable or a shader fails. */
    public static create(canvas: HTMLCanvasElement): WebGLLayer | null {
        const gl = canvas.getContext('webgl2', {alpha: false, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false});

        if (gl === null) {
            return null;
        }

        try {
            return new WebGLLayer(canvas, gl);
        } catch (err) {
            console.warn('jsNGraph: WebGL layer unavailable, using canvas 2d', err);
            return null;
        }
    }

    public readonly buffers = new BulkBuffers();
    private readonly lines: Pass;
    private readonly arrows: Pass;
    private readonly discs: Pass;
    private contextLost = false;

    private constructor(public readonly canvas: HTMLCanvasElement, private readonly gl: WebGL2RenderingContext) {
        const cos = Math.cos(0.42);
        const sin = Math.sin(0.42);

        this.lines = this.pass(LINE_VS, LINE_FS, [0, -0.5, 1, -0.5, 1, 0.5, 0, -0.5, 1, 0.5, 0, 0.5],
            [[1, 4], [2, 1], [3, 4]], LINE_STRIDE);
        this.arrows = this.pass(ARROW_VS, FLAT_FS, [0, 0, -cos, sin, -cos, -sin],
            [[1, 4], [2, 1], [3, 4]], ARROW_STRIDE);
        this.discs = this.pass(DISC_VS, DISC_FS, [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1],
            [[1, 3], [2, 4], [3, 4]], DISC_STRIDE);

        canvas.addEventListener('webglcontextlost', this.onLost);
    }

    /** True once the browser dropped the context; the host falls back to 2d. */
    public get lost(): boolean {
        return this.contextLost || this.gl.isContextLost();
    }

    /** Clear to `background` and draw what was collected in `buffers`; then reset them. */
    public render(view: GlView, width: number, height: number, dpr: number, background: string): void {
        const {gl, buffers} = this;
        const pw = Math.max(1, Math.round(width * dpr));
        const ph = Math.max(1, Math.round(height * dpr));

        if (this.canvas.width !== pw || this.canvas.height !== ph) {
            this.canvas.width = pw;
            this.canvas.height = ph;
        }

        const bg = Color.parse(background) ?? {r: 0, g: 0, b: 0, a: 1};

        gl.viewport(0, 0, pw, ph);
        gl.clearColor(bg.r / 255, bg.g / 255, bg.b / 255, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        this.drawPass(this.lines, buffers.lines.data, buffers.lines.length, buffers.lineCount, view, width, height);
        this.drawPass(this.arrows, buffers.arrows.data, buffers.arrows.length, buffers.arrowCount, view, width, height);
        this.drawPass(this.discs, buffers.discs.data, buffers.discs.length, buffers.discCount, view, width, height);
        buffers.reset();
    }

    public destroy(): void {
        this.canvas.removeEventListener('webglcontextlost', this.onLost);

        for (const p of [this.lines, this.arrows, this.discs]) {
            this.gl.deleteBuffer(p.instances);
            this.gl.deleteVertexArray(p.vao);
            this.gl.deleteProgram(p.program);
        }

        this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }

    private readonly onLost = (event: Event): void => {
        event.preventDefault();
        this.contextLost = true;
    };

    private drawPass(pass: Pass, data: Float32Array, floats: number, count: number, view: GlView, w: number, h: number): void {
        if (count === 0) {
            return;
        }

        const {gl} = this;

        gl.useProgram(pass.program);
        gl.uniform3f(pass.view, view.scale, view.offsetX, view.offsetY);
        gl.uniform2f(pass.size, w, h);
        gl.bindVertexArray(pass.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, pass.instances);
        gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, floats), gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, pass.corners, count);
        gl.bindVertexArray(null);
    }

    private pass(vs: string, fs: string, corners: number[], layout: Layout, stride: number): Pass {
        const {gl} = this;
        const program = this.program(vs, fs);
        const vao = gl.createVertexArray();
        const cornerBuffer = gl.createBuffer();
        const instances = gl.createBuffer();

        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(corners), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, instances);
        let offset = 0;

        for (const [location, size] of layout) {
            gl.enableVertexAttribArray(location);
            gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4);
            gl.vertexAttribDivisor(location, 1);
            offset += size;
        }

        gl.bindVertexArray(null);

        return {
            program: program,
            vao: vao,
            instances: instances,
            view: gl.getUniformLocation(program, 'u_view'),
            size: gl.getUniformLocation(program, 'u_size'),
            corners: corners.length / 2
        };
    }

    private program(vsSource: string, fsSource: string): WebGLProgram {
        const {gl} = this;
        const program = gl.createProgram();

        for (const [type, source] of [[gl.VERTEX_SHADER, vsSource], [gl.FRAGMENT_SHADER, fsSource]] as const) {
            const shader = gl.createShader(type);

            if (shader === null) {
                throw new Error('createShader failed');
            }

            gl.shaderSource(shader, source);
            gl.compileShader(shader);

            if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
                throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
            }

            gl.attachShader(program, shader);
            gl.deleteShader(shader);
        }

        gl.linkProgram(program);

        if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
            throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
        }

        return program;
    }

}
