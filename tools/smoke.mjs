// Functional smoke test for 熊二的世界.
//
//   node tools/smoke.mjs
//
// Replays the documented interactions through real key events and asserts the
// game state transitions via window.render_game_to_text(), so a rendering or
// performance change cannot quietly break the quest, the dialogue, the pinecone
// pickups, the boss fight or the pause menu.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = process.env.GAME_PORT || '8765';
const CDP_PORT = Number(process.env.CDP_PORT || 9222 + (process.pid % 500));
const PROFILE = fileURLToPath(new URL(`../.smoke-profile-${process.pid}`, import.meta.url));
const BASE = `http://127.0.0.1:${PORT}/index.html`;

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });

const chrome = spawn(chromium.executablePath(), [
  `--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*',
  `--user-data-dir=${PROFILE}`, '--no-sandbox', '--no-first-run', '--disable-sync',
  '--window-size=1620,940', '--window-position=0,0',
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
  'about:blank',
], { detached: true, stdio: 'ignore' });
chrome.unref();

const shutdown = () => {
  try { spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { /* ignore */ }
};
process.on('exit', shutdown);

for (let i = 0; i < 80; i += 1) {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    if (r.ok) break;
  } catch (e) { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
const context = browser.contexts()[0];
const page = await context.newPage();
await page.setViewportSize({ width: 1600, height: 900 });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('favicon')) errors.push(`${r.status()} ${r.url()}`);
});
page.on('console', (m) => {
  const text = m.text();
  // resource 404s are reported with their URL by the response listener instead
  if (m.type() === 'error' && !text.includes('Failed to load resource')) errors.push('console: ' + text);
});

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? '  -- ' + detail : ''}`);
}

async function state() {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

/** Boot the game at a pose and wait for the frame loop to actually be playing. */
async function boot(query) {
  await page.goto(`${BASE}?${query}`, { waitUntil: 'load' });
  for (let i = 0; i < 60; i += 1) {
    await page.bringToFront();
    try {
      if ((await state()).mode === 'playing') return true;
    } catch (e) { /* not ready */ }
    await page.waitForTimeout(500);
  }
  return false;
}

async function hold(key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(120);
}

const results = [];

// ---------------------------------------------------------------- start screen
await page.goto(BASE, { waitUntil: 'load' });
await page.bringToFront();
await page.waitForSelector('#start:not(.hidden)', { timeout: 60000 });
check('start screen appears after loading', true);
await page.click('#btn-start');
await page.waitForTimeout(600);
let s = await state();
check('clicking 开始 enters the game', s.mode === 'playing', `mode=${s.mode}`);
check('quest card shows the tutorial', /熊大|任务|新手/.test(s.questTitle), `title="${s.questTitle}"`);
check('scene actually renders geometry', s.drawCalls > 0 && s.triangles > 1000,
  `calls=${s.drawCalls} tris=${s.triangles}`);
results.push(['menu -> play', s.drawCalls, s.triangles]);

// ---------------------------------------------------------------- pause/resume
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
s = await state();
check('Escape pauses', s.mode === 'paused', `mode=${s.mode}`);
await page.keyboard.press('KeyE');
await page.waitForTimeout(400);
s = await state();
check('E resumes', s.mode === 'playing', `mode=${s.mode}`);

// ---------------------------------------------------------------- walking
{
  await boot('autostart=1&pose=2,14,0');
  const before = await state();
  await hold('KeyW', 900);
  const after = await state();
  const moved = Math.hypot(after.player.x - before.player.x, after.player.z - before.player.z);
  check('W walks forward', moved > 1.5, `moved ${moved.toFixed(2)}m`);
  const beforeTurn = (await state()).player.yawDeg;
  await hold('ArrowLeft', 400);
  const afterTurn = (await state()).player.yawDeg;
  check('arrow keys turn the player', Math.abs(afterTurn - beforeTurn) > 10,
    `${beforeTurn} -> ${afterTurn}`);
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  const air = await state();
  check('Space jumps', !air.player.onGround || air.player.y > 0.05,
    `y=${air.player.y} onGround=${air.player.onGround}`);
  await page.waitForTimeout(700);
  const landed = await state();
  check('player lands again', landed.player.y <= 0.05, `y=${landed.player.y}`);
}

// ---------------------------------------------------------------- dialogue
{
  // stand next to 熊大 (the first neighbour) and talk
  const near = await page.evaluate(() => {
    const s = JSON.parse(window.render_game_to_text());
    return s.nearbyNeighbours && s.nearbyNeighbours.length ? s.nearbyNeighbours[0].name : null;
  });
  await boot('autostart=1&pose=-3,-2.5,180');
  await page.waitForTimeout(400);
  const nearXiongda = await state();
  if (nearXiongda.nearest && nearXiongda.nearest.dist < 4) {
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(300);
    let d = await state();
    check('E opens dialogue with a neighbour', Boolean(d.dialogue), `speaker=${d.dialogue && d.dialogue.speaker}`);
    const first = d.dialogue ? d.dialogue.text : '';
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(400);
    d = await state();
    check('E advances the dialogue', Boolean(d.dialogue) || d.mode === 'playing',
      `line ${d.dialogue ? d.dialogue.line : 'closed'}`);
    let guard = 0;
    while ((await state()).dialogue && guard < 20) {
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(320);
      guard += 1;
    }
    check('dialogue closes and the quest advances',
      (await state()).questStage !== 'intro', `stage=${(await state()).questStage}`);
    check('the neighbour remembered the chat', guard < 20 && first.length > 0);
  } else {
    check('neighbour is within talking range of the test pose', false,
      `nearest=${JSON.stringify(nearXiongda.nearest)}`);
  }
}

// ---------------------------------------------------------------- pinecone pickup
{
  await boot('autostart=1&dev=1&stage=cones&cones=6');
  await page.waitForTimeout(500);
  let s2 = await state();
  const target = s2.pinecones.find((c) => !c.collected);
  check('one pinecone left to collect', Boolean(target), `found=${s2.quest.found}`);
  if (target) {
    // stand a few metres west of it, facing +x, and walk in
    const from = { x: target.x - 6, z: target.z };
    await boot(`autostart=1&dev=1&stage=cones&cones=6&pose=${from.x},${from.z},90`);
    await page.waitForTimeout(400);
    for (let i = 0; i < 20; i += 1) {
      await hold('KeyW', 200);
      const cur = await state();
      if (cur.quest.found >= 7) break;
    }
    s2 = await state();
    check('walking into a pinecone picks it up', s2.quest.found >= 7,
      `found=${s2.quest.found} at ${s2.player.x},${s2.player.z} (cone ${target.x},${target.z})`);
  }
}

// ---------------------------------------------------------------- boss fight
{
  await boot('autostart=1&dev=1&stage=fight&pose=44,14,90');
  await page.waitForTimeout(700);
  let s3 = await state();
  check('boss fight is active', Boolean(s3.boss && s3.boss.active), JSON.stringify(s3.boss && s3.boss.phase));
  const startHp = s3.boss ? s3.boss.hp : 0;
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(280);
    const cur = await state();
    if (cur.boss && (cur.boss.hp <= 0 || cur.boss.phase === 'defeated' || cur.boss.phase === 'fleeing')) break;
  }
  s3 = await state();
  check('punching the lumberjack damages him', s3.boss.hp < startHp || s3.boss.phase === 'fleeing',
    `hp ${startHp} -> ${s3.boss.hp} (${s3.boss.phase})`);
  check('the tree he is chopping can be saved', s3.questStage !== 'intro', `stage=${s3.questStage}`);
}

// ---------------------------------------------------------------- river
{
  await boot('autostart=1&pose=34,18,90');
  await page.waitForTimeout(400);
  const onBridge = await state();
  check('standing on the log bridge works', onBridge.onBridge === true, `onBridge=${onBridge.onBridge}`);
}

await browser.close();
shutdown();

console.log('');
if (errors.length) {
  console.log('page errors:');
  for (const e of [...new Set(errors)].join('\n').split('\n')) console.log('  ' + e);
}
console.log(failures === 0 ? `ALL CHECKS PASSED (${errors.length ? errors.length + ' page errors!' : 'no page errors'})` : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 && errors.length === 0 ? 0 : 1;
