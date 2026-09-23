// Functional smoke test for 熊二的世界.
//
//   node tools/smoke.mjs
//
// Replays the documented interactions through real key events and asserts the
// game state transitions via window.render_game_to_text(). Everything runs on a
// single loaded page: `window.__dshDebug` teleports the bear between scenarios
// instead of reloading, because a dozen WebGL contexts in a row is what used to
// crash the GPU process halfway through the run.
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

// Headless by default: a visible Chrome window steals focus from whatever the
// human is doing, and this test is long. Set SMOKE_HEADFUL=1 only when you
// actually want to watch it run.
const HEADLESS = process.env.SMOKE_HEADFUL !== '1';

const chrome = spawn(chromium.executablePath(), [
  ...(HEADLESS ? ['--headless=new', '--disable-gpu-vsync'] : []),
  `--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*',
  `--user-data-dir=${PROFILE}`, '--no-sandbox', '--no-first-run', '--disable-sync',
  '--window-size=1620,940', '--window-position=-2400,-2400',
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
  '--mute-audio', '--no-default-browser-check', '--disable-extensions',
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
const debug = (fn, ...args) => page.evaluate(
  ([name, a]) => window.__dshDebug[name](...a), [fn, args],
);

async function hold(key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(120);
}

/** Teleport the bear and let a few frames settle. */
async function place(x, z, yawDeg) {
  await debug('place', x, z, yawDeg);
  await page.waitForTimeout(120);
}

async function reset() {
  await debug('resetProgress');
  await page.waitForTimeout(120);
}

/** Step the game deterministically instead of waiting in real time. */
async function fast(ms) {
  await page.evaluate((m) => window.advanceTime(m), ms);
}

const results = [];

// ---------------------------------------------------------------- start screen
await page.goto(`${BASE}?fresh=1`, { waitUntil: 'load' });
await page.bringToFront();
await page.waitForSelector('#start:not(.hidden)', { timeout: 60000 });
check('start screen appears after loading', true);
check('the start screen mentions five open chapters', /五|关卡/.test(await page.textContent('#start .subtitle') + await page.textContent('.foot-note')));
await page.click('#btn-start');
await page.waitForTimeout(700);
let s = await state();
check('clicking 开始 enters the game', s.mode === 'playing', `mode=${s.mode}`);
check('the opening objective points at 熊大', /熊大/.test(s.objective ? s.objective.label : ''), JSON.stringify(s.objective));
check('five chapters exist', s.levels.length === 5, `n=${s.levels.length}`);
check('every chapter is startable from the off', s.levels.every((l) => !l.done), 'none pre-completed');
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

// ---------------------------------------------------------------- walking on terrain
{
  await reset();
  await place(2, 14, 0);
  const before = await state();
  await hold('KeyW', 900);
  const after = await state();
  const moved = Math.hypot(after.player.x - before.player.x, after.player.z - before.player.z);
  check('W walks forward', moved > 1.5, `moved ${moved.toFixed(2)}m`);
  const beforeTurn = after.player.yawDeg;
  await hold('ArrowLeft', 400);
  const afterTurn = (await state()).player.yawDeg;
  check('arrow keys turn the player', Math.abs(afterTurn - beforeTurn) > 10, `${beforeTurn} -> ${afterTurn}`);
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  const air = await state();
  check('Space jumps', !air.player.onGround || air.player.y > air.player.ground + 0.05,
    `y=${air.player.y} ground=${air.player.ground}`);
  await page.waitForTimeout(900);
  const landed = await state();
  check('player lands on the terrain again', Math.abs(landed.player.y - landed.player.ground) < 0.2,
    `y=${landed.player.y} ground=${landed.player.ground}`);
}

// ---------------------------------------------------------------- running, crouching, rolling, throwing
{
  await reset();
  await place(2, 14, 0);
  const before = await state();
  await page.keyboard.down('ShiftLeft');
  await hold('KeyW', 1500);
  await page.keyboard.up('ShiftLeft');
  const after = await state();
  check('holding Shift covers more ground than walking', after.distance - before.distance > 5.5,
    `${(after.distance - before.distance).toFixed(1)}m in 1.5s`);
  check('sprinting drains stamina', after.player.stamina < before.player.stamina,
    `${before.player.stamina} -> ${after.player.stamina}`);
  await page.waitForTimeout(2500);
  const rested = await state();
  check('stamina comes back', rested.player.stamina > after.player.stamina,
    `${after.player.stamina} -> ${rested.player.stamina}`);

  await page.keyboard.down('KeyC');
  await page.waitForTimeout(250);
  const crouched = await state();
  await page.keyboard.up('KeyC');
  check('C crouches', crouched.crouching === true, `crouching=${crouched.crouching}`);
  await page.waitForTimeout(250);

  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(120);
  const rolled = await state();
  check('Q rolls', rolled.rolling === true, `rolling=${rolled.rolling}`);
  await page.waitForTimeout(900);

  await page.keyboard.press('KeyR');
  await page.waitForTimeout(80);
  check('R throws a stone', (await debug('projectiles')) > 0, `live=${await debug('projectiles')}`);
  await page.waitForTimeout(1400);

  await page.keyboard.press('KeyF');
  await page.waitForTimeout(80);
  const swung = await state();
  check('F starts a paw swing', swung.attacking === true, `attacking=${swung.attacking}`);
  await page.waitForTimeout(420);
  check('the swing ends on its own', (await state()).attacking === false, 'swing closed');
}

// ---------------------------------------------------------------- dialogue + chapter 1 hand off
{
  await reset();
  // 熊大 wanders around his camp, so stand in front of wherever he actually is
  await place(2, 14, 0);
  await page.waitForTimeout(300);
  const roster = (await state()).nearbyNeighbours;
  const xiongda = roster.find((n) => n.name === '熊大');
  check('熊大 shows up in the nearby roster', Boolean(xiongda), JSON.stringify(roster.map((n) => n.name)));
  if (xiongda) {
    // stand 3m south of him facing +z (yaw 0), so he is inside the 80° chat cone
    await place(xiongda.x, xiongda.z - 3, 0);
    await page.waitForTimeout(300);
    const near = await state();
    check('熊大 is within talking range', Boolean(near.nearest && near.nearest.dist < 4.4),
      JSON.stringify(near.nearest));
    check('the prompt offers a chat', /熊大/.test(near.prompt || ''), `prompt=${near.prompt}`);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(300);
    const d0 = await state();
    check('E opens dialogue with a neighbour', Boolean(d0.dialogue), `speaker=${d0.dialogue && d0.dialogue.speaker}`);
    let guard = 0;
    while ((await state()).dialogue && guard < 20) {
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(340);
      guard += 1;
    }
    const d1 = await state();
    check('dialogue closes', !d1.dialogue, `lines=${guard}`);
    check('talking to 熊大 opens the first chapter', d1.level.introDone === true, `introDone=${d1.level.introDone}`);
  }
}

// ---------------------------------------------------------------- pickups
{
  await reset();
  const given = await debug('give', 'cone', 6);
  check('six pinecones can be handed over', given === 6, `given=${given}`);
  await page.waitForTimeout(200);
  let s2 = await state();
  check('the bag and chapter 2 agree', s2.bag.cone === 6 && s2.level.progress.lv2 === 6,
    `cone=${s2.bag.cone} progress=${s2.level.progress.lv2}`);
  const target = s2.pinecones.find((c) => !c.collected);
  check('one pinecone left to collect', Boolean(target), `left=${s2.pinecones.filter((c) => !c.collected).length}`);
  if (target) {
    // stand once, then actually walk in — re-teleporting every step would undo the walking
    await place(target.x - 4, target.z, 90);
    for (let i = 0; i < 24; i += 1) {
      await hold('KeyW', 260);
      if ((await state()).bag.cone >= 7) break;
    }
    s2 = await state();
    check('walking into a pinecone picks it up', s2.bag.cone >= 7,
      `cone=${s2.bag.cone} at ${s2.player.x},${s2.player.z} (target ${target.x},${target.z})`);
    check('chapter 2 completes at seven pinecones', s2.level.done.lv2 === true,
      `done=${JSON.stringify(s2.level.done)}`);
  }
}

// ---------------------------------------------------------------- swamp: wading and honey
{
  await reset();
  await place(-104, 74, 0);
  await page.waitForTimeout(500);
  const wet = await state();
  check('standing in the swamp floods the bear', wet.wading === true, `wading=${wet.wading} y=${wet.player.y}`);
  check('the swamp sits below sea level', wet.player.ground < -1.2, `ground=${wet.player.ground}`);
  const before = await state();
  await hold('KeyW', 1200);
  const after = await state();
  check('wading is slow', (after.distance - before.distance) / 1.2 < 3.6,
    `travelled ${(after.distance - before.distance).toFixed(1)}m in 1.2s`);

  await reset();
  await debug('startLevel', 'lv3');
  await page.waitForTimeout(300);
  let s3 = await state();
  check('chapter 3 can be started', s3.level.active === 'lv3', `active=${s3.level.active}`);
  const honey = s3.items.filter((i) => i.kind === 'honey' && !i.collected);
  check('the swamp holds honey jars', honey.length >= 6, `n=${honey.length}`);
  if (honey.length) {
    await place(honey[0].x, honey[0].z - 0.5, 0);
    await page.waitForTimeout(400);
    s3 = await state();
    check('picking up honey counts towards chapter 3', s3.bag.honey >= 1, `honey=${s3.bag.honey}`);
  }
}

// ---------------------------------------------------------------- night plateau: crystals
{
  await reset();
  await debug('startLevel', 'lv4');
  await page.waitForTimeout(300);
  await place(78, -87.4, 0);
  await page.waitForTimeout(400);
  let s4 = await state();
  check('chapter 4 is active', s4.level.active === 'lv4', `active=${s4.level.active}`);
  check('asked to light four crystals', s4.level.progress.lv4 === 0 && s4.levels[3].need === 4,
    `progress=${s4.level.progress.lv4} need=${s4.levels[3].need}`);
  check('a prompt offers to light the crystal', /晶石/.test(s4.prompt || ''), `prompt=${s4.prompt}`);
  check('the highland plateau is actually high up', s4.player.ground > 12, `ground=${s4.player.ground}`);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(400);
  s4 = await state();
  check('E lights a crystal', s4.crystals[0].lit === true, JSON.stringify(s4.crystals[0]));
  check('chapter 4 counts the lit crystal', s4.level.progress.lv4 === 1, `${s4.level.progress.lv4}`);
  for (let i = 1; i < 4; i += 1) await debug('lightCrystal', i);
  await page.waitForTimeout(400);
  s4 = await state();
  check('lighting all four completes chapter 4', s4.level.done.lv4 === true,
    `done=${JSON.stringify(s4.level.done)}`);
}

// ---------------------------------------------------------------- chapters 2/3/4 progress
{
  await reset();
  const cones = await debug('give', 'cone', 7);
  const honey = await debug('give', 'honey', 6);
  for (let i = 0; i < 4; i += 1) await debug('lightCrystal', i);
  await page.waitForTimeout(300);
  const s7 = await state();
  check('collecting all seven pinecones clears chapter 2', cones === 7 && s7.level.done.lv2 === true,
    `cone=${s7.bag.cone} done=${s7.level.done.lv2}`);
  check('collecting all six jars clears chapter 3', honey === 6 && s7.level.done.lv3 === true,
    `honey=${s7.bag.honey} done=${s7.level.done.lv3}`);
  check('lighting all four crystals clears chapter 4', s7.level.done.lv4 === true, `done=${s7.level.done.lv4}`);
  check('three of five chapters are done', s7.level.completed === 3, `completed=${s7.level.completed}`);
}

// ---------------------------------------------------------------- chapters 1 and 5, then the win screen
{
  // no reset from here on: the last chapter to fall must trigger the ending
  let s8 = await state();
  check('two chapters still to go', s8.level.completed === 3, `completed=${s8.level.completed}`);

  await debug('startLevel', 'lv1');
  await fast(400);
  s8 = await state();
  check('chapter 1 wakes the lumberjack', Boolean(s8.boss && s8.boss.active), JSON.stringify(s8.boss && s8.boss.phase));
  const startHp = s8.boss ? s8.boss.hp : 0;
  for (let i = 0; i < 50; i += 1) {
    const cur = await state();
    if (!cur.boss || cur.boss.hp <= 0 || cur.boss.phase === 'defeated' || cur.boss.phase === 'fleeing') break;
    // stand right in front of him so the swing cannot fall short
    await place(cur.boss.x - 2, cur.boss.z, 90);
    await page.keyboard.press('KeyF');
    await fast(420);
  }
  s8 = await state();
  check('punching the lumberjack damages him', s8.boss.hp < startHp || s8.boss.phase === 'fleeing',
    `hp ${startHp} -> ${s8.boss.hp} (${s8.boss.phase})`);
  check('chapter 1 completes when he gives up', s8.level.done.lv1 === true,
    `done=${JSON.stringify(s8.level.done)}`);

  await debug('startLevel', 'lv5');
  await fast(400);
  s8 = await state();
  check('chapter 5 spawns the first wave', s8.arena.active === true && s8.arena.alive > 0,
    JSON.stringify(s8.arena));
  const firstWave = s8.arena.alive;
  for (let i = 0; i < 260; i += 1) {
    const cur = await state();
    if (cur.level.done.lv5 || cur.arena.cleared) break;
    const foes = await debug('enemies');
    const foe = foes[0];
    if (!foe) { await fast(300); continue; }
    await place(foe.x - 1.8, foe.z, 90);
    await page.keyboard.press('KeyF');
    await fast(420);
  }
  s8 = await state();
  check('the paw connects with an arena opponent', s8.arena.cleared || s8.arena.alive < firstWave,
    `${firstWave} -> ${s8.arena.alive} cleared=${s8.arena.cleared}`);
  check('chapter 5 completes when the waves are cleared', s8.level.done.lv5 === true,
    `arena=${JSON.stringify(s8.arena)}`);
  const winVisible = await page.evaluate(() => !document.getElementById('win').classList.contains('hidden'));
  check('clearing the last chapter shows the ending screen', winVisible === true, `win=${winVisible}`);
  const winStats = await page.evaluate(() => document.getElementById('win-stats').textContent);
  check('the ending screen reports the run', /关卡|通关/.test(winStats) && /5/.test(winStats), `stats="${winStats}"`);
  const winMode = (await state()).mode;
  check('the ending screen stops the bear', winMode === 'win', `mode=${winMode}`);
  await debug('resume');
  await page.waitForTimeout(200);
  check('the test can hand control back', (await state()).mode === 'playing', 'resumed');
}

// ---------------------------------------------------------------- river + bridge
{
  await reset();
  await place(34, 18, 90);
  await page.waitForTimeout(400);
  const onBridge = await state();
  check('standing on the log bridge works', onBridge.onBridge === true, `onBridge=${onBridge.onBridge}`);
  check('the bridge deck holds the bear above the gorge', onBridge.player.y > 0.2,
    `y=${onBridge.player.y}`);
  // the deck is a fixed height, so the banks it lands on have to be level with it
  for (const [x, label] of [[23.5, 'west'], [44.5, 'east']]) {
    await place(x, 18, 90);
    await page.waitForTimeout(300);
    const bank = await state();
    check(`the ${label} bank meets the bridge deck`, Math.abs(bank.player.ground - 0.32) < 0.6,
      `ground=${bank.player.ground} deck=0.32`);
  }
  // walking on from the bank must reach the deck, not fall into the gorge
  await place(23, 18, 90);
  for (let i = 0; i < 14; i += 1) await hold('KeyW', 240);
  const crossed = await state();
  check('the bear can walk from the bank onto the bridge and across',
    crossed.onBridge === true || crossed.player.x > 30, `x=${crossed.player.x} onBridge=${crossed.onBridge}`);
}

// ---------------------------------------------------------------- overlays
{
  await reset();
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(350);
  let o = await state();
  check('M opens the big map', o.overlay === 'map', `overlay=${o.overlay}`);
  const painted = await page.evaluate(() => {
    const c = document.getElementById('bigmap-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4000) if (d[i] > 0) lit += 1;
    return lit;
  });
  check('the big map is actually painted', painted > 100, `sampled=${painted}`);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(350);
  o = await state();
  check('M closes the big map', o.overlay === null, `overlay=${o.overlay}`);

  await page.keyboard.press('Tab');
  await page.waitForTimeout(350);
  o = await state();
  check('Tab opens the chapter board', o.overlay === 'board', `overlay=${o.overlay}`);
  const cards = await page.evaluate(() => document.querySelectorAll('#board-list .lvcard').length);
  check('the board lists every chapter', cards === 5, `cards=${cards}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  o = await state();
  check('Escape closes the board without pausing', o.overlay === null && o.mode === 'playing',
    `overlay=${o.overlay} mode=${o.mode}`);
}

// ---------------------------------------------------------------- level stone interaction
{
  await reset();
  await page.waitForTimeout(200);
  const totem = (await state()).totems[2];
  await place(totem.x, totem.z - 2.5, 0);
  await page.waitForTimeout(400);
  const nearTotem = await state();
  check('a level stone offers an interaction', /石碑/.test(nearTotem.prompt || ''), `prompt=${nearTotem.prompt}`);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(400);
  check('E on the stone opens the chapter board', (await state()).overlay === 'board', 'board open');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
}

// ---------------------------------------------------------------- performance / memory
{
  await reset();
  await place(2, 14, 0);
  await page.waitForTimeout(1800);
  const perf = await state();
  results.push(['gameplay', perf.drawCalls, perf.triangles]);
  check('draw calls stay in the instanced budget', perf.drawCalls < 300, `calls=${perf.drawCalls}`);
  check('texture memory stays reasonable', perf.memory.textureMB < 110, `${perf.memory.textureMB}MB`);
  console.log(`  info  tris=${perf.triangles} calls=${perf.drawCalls} tex=${perf.memory.textureMB}MB ` +
    `geo=${perf.memory.gpuGeometries} heap=${perf.memory.jsHeapMB}MB canvas=${perf.memory.canvasMB}MB`);
}

// ---------------------------------------------------------------- save / reload
{
  await reset();
  await debug('give', 'cone', 3);
  await debug('lightCrystal', 0);
  await page.waitForTimeout(300);
  await page.goto(`${BASE}?autostart=1`, { waitUntil: 'load' });
  for (let i = 0; i < 60; i += 1) {
    await page.bringToFront();
    try { if ((await state()).mode === 'playing') break; } catch (e) { /* not ready */ }
    await page.waitForTimeout(400);
  }
  const saved = await state();
  check('progress survives a reload', saved.bag.cone === 3 && saved.level.progress.lv2 === 3,
    `cone=${saved.bag.cone} progress=${saved.level.progress.lv2}`);
  check('a lit crystal survives a reload', saved.crystals[0].lit === true, JSON.stringify(saved.crystals[0]));
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
