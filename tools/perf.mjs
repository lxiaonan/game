// Performance probe for 熊二的世界.
//
//   node tools/perf.mjs [label] [seconds]
//
// Launches a headed Chromium at 1600x900 (deviceScaleFactor 1), drops the player
// at a few fixed poses that stress different parts of the scene, and reports:
//   frameMs  - ms per frame for step() + renderer.render() with gl.finish(), so
//              the GPU actually drains. >16.7 means it cannot hold 60fps.
//   calls    - WebGL draw calls in the last rendered frame
//   present  - real requestAnimationFrame rate (includes browser compositing of
//              the CSS layers: vignette, grain, panel backdrop-filters)
//   noCss    - rAF rate with those CSS layers switched off
//
// Chrome does not rasterize a hidden window, which makes occluded measurements
// read absurdly fast, so every sample is gated on document.visibilityState
// being 'visible'. frameMs is the median of three drained batches.
//
// Numbers are only meaningful compared against another run of the same script
// on the same machine, which is exactly what the before/after comparison needs.
//
// The browser is started detached with stdio:'ignore' and attached over CDP:
// Playwright's own launcher pipes stdio, and Chromium's Mojo IPC needs named
// pipes, both of which the file sandbox denies.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const LABEL = process.argv[2] || 'run';
const SECONDS = Number(process.argv[3] || 3);
const PORT = process.env.GAME_PORT || '8765';
const BASE = `http://127.0.0.1:${PORT}/index.html${process.env.EXTRA || ''}`;
const CDP_PORT = Number(process.env.CDP_PORT || 9222 + (process.pid % 500));
const PROFILE = fileURLToPath(new URL(`../.perf-profile-${process.pid}`, import.meta.url));

const POSES = [
  { name: 'camp', pose: '2,14,0' },
  { name: 'forest', pose: '0,-30,0' },
  { name: 'deepforest', pose: '-40,-25,90' },
  { name: 'bridge', pose: '26,18,90' },
  { name: 'lumberyard', pose: '44,14,90' },
].filter((p) => !process.env.POSES || process.env.POSES.split(',').includes(p.name));

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });

const chrome = spawn(chromium.executablePath(), [
  `--remote-debugging-port=${CDP_PORT}`,
  '--remote-allow-origins=*',
  `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disable-sync', '--no-sandbox',
  '--window-size=1620,940', '--window-position=0,0',
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
  // Uncapped by default: turns rAF into a continuous throughput number instead of
  // a vsync-quantised 60/120 that hides everything between those two points.
  // VSYNC=1 restores vsync, which is what the player actually experiences.
  ...(process.env.VSYNC === '1' ? [] : ['--disable-frame-rate-limit', '--disable-gpu-vsync']),
  'about:blank',
], { detached: true, stdio: 'ignore' });
chrome.unref();

const shutdown = () => {
  try { spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { /* still locked, fine */ }
};
process.on('exit', shutdown);

async function waitForCdp() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('chrome never opened its CDP port');
}

await waitForCdp();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
const context = browser.contexts()[0];
const page = await context.newPage();
await page.setViewportSize({ width: 1600, height: 900 });

const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => problems.push('requestfailed: ' + r.url() + ' ' + ((r.failure() || {}).errorText || '')));

const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');

/** Chrome silently skips rasterizing a hidden window, so never sample then. */
async function ensureVisible() {
  for (let i = 0; i < 30; i += 1) {
    await page.bringToFront();
    const visible = await page.evaluate(() => document.visibilityState === 'visible').catch(() => false);
    if (visible) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

const rows = [];
let gpu = 'unknown';
for (const { name, pose } of POSES) {
  await page.goto(`${BASE}${BASE.includes('?') ? '&' : '?'}autostart=1&pose=${pose}`, { waitUntil: 'load' });

  let reached = false;
  for (let i = 0; i < 60 && !reached; i += 1) {
    await page.bringToFront();
    reached = await page.evaluate(() => {
      try { return JSON.parse(window.render_game_to_text()).mode === 'playing'; } catch (e) { return false; }
    });
    if (!reached) await page.waitForTimeout(500);
  }
  if (!reached) {
    const tip = await page.evaluate(() => (document.getElementById('load-tip') || {}).textContent).catch(() => '?');
    console.log(`\n[${name}] never reached mode=playing. loading tip: ${tip}`);
    console.log(problems.join('\n') || '(no console output)');
    throw new Error(`${name}: game never started`);
  }
  if (gpu === 'unknown') {
    gpu = await page.evaluate(() => {
      const gl = document.getElementById('scene').getContext('webgl2');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
  }

  const visible = await ensureVisible();
  await page.waitForTimeout(400);

  // Many short drained batches: this machine is shared with whatever else is on
  // screen (including the player's own browser running the same game), so the
  // minimum is the honest per-frame cost and the spread shows the interference.
  const batches = [];
  for (let b = 0; b < 8; b += 1) {
    await ensureVisible();
    batches.push(await page.evaluate(() => {
      const gl = document.getElementById('scene').getContext('webgl2');
      const frames = 24;
      window.advanceTime(frames * (1000 / 60));
      if (gl) gl.finish();
      const t0 = performance.now();
      window.advanceTime(frames * (1000 / 60));
      if (gl) gl.finish();
      return (performance.now() - t0) / frames;
    }));
  }
  const sorted = [...batches].sort((a, b) => a - b);
  const frameMs = sorted[Math.floor(sorted.length / 2)];
  const frameMin = sorted[0];

  const state = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  mkdirSync(fileURLToPath(new URL('./shots', import.meta.url)), { recursive: true });
  await page.screenshot({ path: `tools/shots/perf-${LABEL}-${name}.png` });

  // Real present-path rate, then again with the CSS compositing layers off.
  const sampleRaf = async (mutate) => {
    if (mutate) await page.evaluate(mutate);
    if (!(await ensureVisible())) return null;
    await page.evaluate(() => {
      window.__ft = [];
      let last = performance.now();
      const tick = (t) => { window.__ft.push(t - last); last = t; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const before = await cdp.send('Performance.getMetrics');
    await page.waitForTimeout(SECONDS * 1000);
    const after = await cdp.send('Performance.getMetrics');
    const metric = (m, k) => (m.metrics.find((x) => x.name === k) || {}).value || 0;
    const wall = metric(after, 'Timestamp') - metric(before, 'Timestamp');
    const task = metric(after, 'TaskDuration') - metric(before, 'TaskDuration');
    const samples = (await page.evaluate(() => window.__ft.slice(8))).sort((a, b) => a - b);
    if (samples.length < 10) return null;
    return {
      fps: 1000 / samples[Math.floor(samples.length / 2)],
      taskPct: (task / wall) * 100,
    };
  };

  const present = await sampleRaf(null);
  const noCss = await sampleRaf(() => {
    for (const sel of ['.vignette', '.grain']) {
      const n = document.querySelector(sel);
      if (n) n.style.display = 'none';
    }
    for (const p of document.querySelectorAll('.panel')) p.style.backdropFilter = 'none';
  });

  rows.push({
    pose: name,
    visible,
    frameMin: +frameMin.toFixed(2),
    frameMs: +frameMs.toFixed(2),
    spread: `${sorted[0].toFixed(1)}-${sorted[sorted.length - 1].toFixed(1)}`,
    ceilFps: Math.round(1000 / frameMs),
    presentFps: present ? +present.fps.toFixed(1) : null,
    noCssFps: noCss ? +noCss.fps.toFixed(1) : null,
    drawCalls: state.drawCalls,
    triangles: state.triangles,
    taskPct: present ? +present.taskPct.toFixed(1) : null,
  });
}

await browser.close();
shutdown();

console.log(`\n=== ${LABEL} ===`);
console.log('gpu:', gpu);
console.log(
  'pose'.padEnd(12), 'minMs'.padStart(7), 'frameMs'.padStart(8), 'spread'.padStart(11), 'ceilFps'.padStart(8),
  'present'.padStart(8), 'noCss'.padStart(7), 'calls'.padStart(7), 'tris'.padStart(8), 'task%'.padStart(7), 'vis'.padStart(5),
);
for (const r of rows) {
  console.log(
    r.pose.padEnd(12),
    String(r.frameMin).padStart(7),
    String(r.frameMs).padStart(8),
    String(r.spread).padStart(11),
    String(r.ceilFps).padStart(8),
    String(r.presentFps === null ? '-' : r.presentFps).padStart(8),
    String(r.noCssFps === null ? '-' : r.noCssFps).padStart(7),
    String(r.drawCalls).padStart(7),
    String(r.triangles).padStart(8),
    String(r.taskPct === null ? '-' : r.taskPct).padStart(7),
    String(r.visible).padStart(5),
  );
}
const avg = (k, round = 1) => {
  const vals = rows.map((r) => r[k]).filter((v) => typeof v === 'number');
  return vals.length ? +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(round) : '-';
};
const worst = (k) => {
  const vals = rows.map((r) => r[k]).filter((v) => typeof v === 'number');
  return vals.length ? +Math.max(...vals).toFixed(2) : '-';
};
console.log('AVERAGE'.padEnd(12), String(avg('frameMin', 2)).padStart(7), String(avg('frameMs', 2)).padStart(8),
  ''.padStart(11), String(avg('ceilFps', 0)).padStart(8),
  String(avg('presentFps')).padStart(8), String(avg('noCssFps')).padStart(7),
  String(Math.round(avg('drawCalls', 0))).padStart(7), '', String(avg('taskPct')).padStart(7));
console.log('WORST'.padEnd(12), String(worst('frameMin')).padStart(7), String(worst('frameMs')).padStart(8));
console.log('\nminMs   = best per-frame cost (step + render + GPU drain), least affected by other apps');
console.log('frameMs = median; a large spread means this machine was busy with something else');
console.log('present = real rAF fps incl. CSS compositing;  noCss = with vignette/grain/backdrop-filter off');
if (problems.length) console.log('\nproblems:\n' + [...new Set(problems)].join('\n'));
