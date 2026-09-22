// Memory probe for 熊二的世界.
//
//   node tools/mem.mjs
//
// Reports where the runtime memory actually goes: GPU texture bytes (counted from
// each unique Texture object, because three.js uploads one copy per object), the
// drawing buffer including MSAA targets, the JS heap, and Chrome's DOM counters.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = process.env.GAME_PORT || '8765';
const CDP_PORT = Number(process.env.CDP_PORT || 9222 + (process.pid % 500));
const PROFILE = fileURLToPath(new URL(`../.mem-profile-${process.pid}`, import.meta.url));

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });

const chrome = spawn(chromium.executablePath(), [
  `--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*',
  `--user-data-dir=${PROFILE}`, '--no-sandbox', '--no-first-run', '--disable-sync',
  '--window-size=1620,940', '--window-position=0,0',
  '--disable-features=CalculateNativeWinOcclusion', 'about:blank',
], { detached: true, stdio: 'ignore' });
chrome.unref();
const shutdown = () => {
  try { spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { /* ignore */ }
};
process.on('exit', shutdown);

for (let i = 0; i < 80; i += 1) {
  try {
    if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break;
  } catch (e) { /* not up */ }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
const context = browser.contexts()[0];
const page = await context.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');

await page.goto(`http://127.0.0.1:${PORT}/index.html?autostart=1`, { waitUntil: 'load' });
for (let i = 0; i < 60; i += 1) {
  await page.bringToFront();
  const mode = await page.evaluate(() => {
    try { return JSON.parse(window.render_game_to_text()).mode; } catch (e) { return null; }
  });
  if (mode === 'playing') break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1200);

const state = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
const metrics = await cdp.send('Performance.getMetrics');
const metric = (k) => (metrics.metrics.find((x) => x.name === k) || {}).value || 0;
const counters = await cdp.send('Memory.getDOMCounters').catch(() => ({}));
const procs = await cdp.send('SystemInfo.getProcessInfo').catch(() => ({ processInfo: [] }));
const gl = await page.evaluate(() => {
  const c = document.getElementById('scene').getContext('webgl2');
  const ext = c.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '',
    samples: c.getParameter(c.SAMPLES),
    buffer: [c.drawingBufferWidth, c.drawingBufferHeight],
    maxTexture: c.getParameter(c.MAX_TEXTURE_SIZE),
  };
});

const m = state.memory;
console.log('viewport           ', gl.buffer[0] + 'x' + gl.buffer[1], '  MSAA samples:', gl.samples);
console.log('gpu                ', gl.renderer);
console.log('');
console.log('--- 显存 / GPU 侧 ---');
console.log(`纹理对象数(上传数)   ${m.gpuTextures}   唯一贴图 ${m.uniqueTextures}`);
console.log(`纹理显存            ${m.textureMB} MB   (已含 mipmap)`);
console.log(`绘制缓冲(含MSAA)     ${m.canvasMB} MB`);
console.log(`几何体对象          ${m.gpuGeometries}   着色器程序 ${m.programs}`);
console.log('');
console.log('--- CPU / JS 侧 ---');
console.log(`JS 堆               ${metric('JSHeapUsedSize') / 1048576 | 0} MB  (总 ${metric('JSHeapTotalSize') / 1048576 | 0} MB)`);
console.log(`页面内报告堆        ${m.jsHeapMB} MB`);
console.log(`DOM 节点            ${counters.nodes}   事件监听 ${counters.jsEventListeners}`);
console.log(`draw call / 三角面  ${state.drawCalls} / ${state.triangles}`);
console.log('');
console.log('--- 浏览器进程 ---');
const byType = {};
for (const p of (procs.processInfo || [])) byType[p.type] = (byType[p.type] || 0) + 1;
console.log(JSON.stringify(byType), ' 共', (procs.processInfo || []).length, '个进程');
const game = m.textureMB + m.canvasMB;
console.log('');
console.log(`游戏自身占用(纹理+绘制缓冲) ≈ ${game.toFixed(1)} MB`);
console.log('其余为 JS 堆、几何体、浏览器进程本身与 Chrome 基础开销');

// What a first-time visitor actually has to download, straight from the browser's
// own resource timings (encodedBodySize = bytes on the wire after compression).
const payload = await page.evaluate(() => {
  const entries = performance.getEntriesByType('resource');
  const byType = {};
  let total = 0;
  let encoded = 0;
  for (const e of entries) {
    const kind = e.name.endsWith('.js') ? 'js'
      : e.name.endsWith('.png') ? 'png'
        : e.name.endsWith('.html') ? 'html' : 'other';
    byType[kind] = byType[kind] || { count: 0, bytes: 0, wire: 0 };
    byType[kind].count += 1;
    byType[kind].bytes += e.decodedBodySize || 0;
    byType[kind].wire += e.encodedBodySize || 0;
    total += e.decodedBodySize || 0;
    encoded += e.encodedBodySize || 0;
  }
  return { byType, total, encoded, count: entries.length };
});

console.log('');
console.log('--- 首屏网络载荷(新访客,无缓存) ---');
for (const [kind, v] of Object.entries(payload.byType)) {
  console.log(`${kind.padEnd(6)} ${String(v.count).padStart(3)} 个   ${(v.wire / 1048576).toFixed(2)} MB`);
}
console.log(`合计   ${payload.count} 个请求  ${(payload.encoded / 1048576).toFixed(2)} MB`);

await browser.close();
shutdown();
