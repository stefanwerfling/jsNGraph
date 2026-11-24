// Regenerates the gallery thumbnails in examples/shots/ (one per card in examples/index.html).
// Needs: a built bundle (npm run build), google-chrome or chromium, python3, ImageMagick, Node ≥ 22 (WebSocket).
// Usage: node scripts/shots.mjs [page …]   (no arguments = every card)
// Drives headless Chrome over the DevTools protocol and waits in real time — with --virtual-time-budget
// rAF-driven canvases often never draw.
import {spawn, execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'examples', 'shots');
const tmp = mkdtempSync(join(tmpdir(), 'jsngraph-shots-'));
const httpPort = 8791;
const cdpPort = 9333;
const width = 1280;
const height = 800;
const nav = 36;
/** Extra settle time for pages that load data or grow over time (ms). */
// pages that look best a little into their animation get a query string
const query = {gomera: '?t=95', storyboard: '#canvas'};
const waits = {atlas: 6000, vault: 5000, livingmap: 6000, knowledge: 4000, monitoring: 4000, netview: 4000, 'seabird-radar': 6200, gomera: 6000, moonphase: 2500, smartcity: 2500, encounters: 4000, socialsky: 2500, sightingcloud: 3000};

const which = (...names) => {
    for (const n of names) {
        try {
            return execFileSync('which', [n]).toString().trim();
        } catch {
            // next
        }
    }
    throw new Error(`none of ${names.join(', ')} found`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pages = process.argv.length > 2
    ? process.argv.slice(2).map((p) => p.replace(/\.html$/, ''))
    : [...readFileSync(join(root, 'examples', 'index.html'), 'utf8').matchAll(/class="card" href="([^"]+)\.html"/g)].map((m) => m[1]);

mkdirSync(out, {recursive: true});
const server = spawn('python3', ['-m', 'http.server', String(httpPort), '--directory', root], {stdio: 'ignore'});
const chrome = spawn(which('google-chrome', 'chromium', 'chromium-browser'), [
    '--headless=new', '--hide-scrollbars', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${tmp}/profile`,
    `--window-size=${width},${height}`, 'about:blank'
], {stdio: 'ignore'});
const magick = which('magick', 'convert');

try {
    let target;
    for (let i = 0; i < 50 && target === undefined; i++) {
        await sleep(200);
        try {
            const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
            target = list.find((t) => t.type === 'page');
        } catch {
            // not up yet
        }
    }
    if (target === undefined) {
        throw new Error('Chrome did not start');
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, {once: true}));
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id !== undefined && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
    });
    const send = (method, params = {}) => new Promise((resolve) => {
        const id = ++seq;
        pending.set(id, resolve);
        ws.send(JSON.stringify({id, method, params}));
    });

    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});

    for (const page of pages) {
        await send('Page.navigate', {url: `http://localhost:${httpPort}/examples/${page}.html${query[page] ?? ''}`});
        await sleep(waits[page] ?? 2500);
        const shot = await send('Page.captureScreenshot', {
            format: 'png',
            clip: {x: 0, y: nav, width, height: height - nav, scale: 1}
        });
        const png = join(tmp, `${page}.png`);
        writeFileSync(png, Buffer.from(shot.result.data, 'base64'));
        const file = join(out, `${page}.webp`);
        execFileSync(magick, [png, '-resize', '560x', '-quality', '78', file]);
        console.log(`${page}.webp ${statSync(file).size} bytes`);
    }
    ws.close();
} finally {
    chrome.kill();
    server.kill();
    await sleep(300);
    rmSync(tmp, {recursive: true, force: true});
}
