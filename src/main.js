import * as THREE from '../vendor/three.module.js';
import { loadTextures } from './assets.js';
import { buildWorld, LANDMARKS, RIVER, REGIONS, groundHeightAt, isOnBridge, terrainHeight } from './world.js';
import { buildNeighbours, nearestOf } from './npcs.js';
import { createPlayer } from './player.js';
import { createProps, ARENA } from './props.js';
import { createArena } from './enemies.js';
import { createLevels, LEVELS } from './levels.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';
import { createBossFight } from './boss.js';
import { loadSave, writeSave, clearSave } from './save.js';

const ui = createUI();
const audio = createAudio();
const params = new URLSearchParams(location.search);
const AUTOSTART = params.get('autostart') === '1';
const DEV = params.get('dev') === '1';
const FRESH = params.get('fresh') === '1' || DEV;

const canvas = document.getElementById('scene');
const ANTIALIAS = params.get('aa') !== '0';
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: ANTIALIAS,
  stencil: false,
  powerPreference: 'high-performance',
});
const MAX_PIXEL_RATIO = 1.5;
let renderScale = Math.min(1, Math.max(0.5, Number(params.get('scale')) || 1));
let refreshMs = 16.7;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) * renderScale);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;

/** Median rAF interval before the game starts: the display's frame budget. */
(function measureRefresh() {
  const samples = [];
  let last = performance.now();
  const tick = (now) => {
    samples.push(now - last);
    last = now;
    if (samples.length < 30) {
      requestAnimationFrame(tick);
    } else {
      const sorted = samples.slice(5).sort((a, b) => a - b);
      refreshMs = sorted[Math.floor(sorted.length / 2)] || 16.7;
    }
  };
  requestAnimationFrame(tick);
}());

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.1, 900);
scene.add(camera);

const clock = { time: 0 };
const input = {
  forward: 0, strafe: 0, turn: 0, run: false, jump: false,
  interact: false, attack: false, roll: false, throw: false, crouch: false,
};
const keys = new Set();

let world = null;
let neighbours = null;
let props = null;
let arena = null;
let levels = null;
let boss = null;
let player = null;
let mode = 'loading'; // loading | menu | playing | paused | win
let overlay = null; // null | 'map' | 'board'
let dialogue = null;
let talkables = [];
let bag = { cone: 0, honey: 0, shroom: 0 };
let talked = new Set();
let playSeconds = 0;
let walkDistance = 0;
let stepAccumulator = 0;
let chirpTimer = 3;
let hadPointerLock = false;
let paused = false;
let previousX = 2;
let previousZ = 14;
let treeRespawnTimer = 0;
let bossDefeatHandled = false;
let minimapTimer = 0;
let mapTimer = 0;
let downTimer = 0;
let saveTimer = 30;
let toastCooldown = 0;

const PAW_KEY = 'E';

// ------------------------------------------------------------------ setup
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  applyPixelRatio();
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function applyPixelRatio() {
  const base = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  renderer.setPixelRatio(base * renderScale);
}
window.addEventListener('resize', onResize);

const isTouch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;

function updateInputFromKeys() {
  const pressed = (code) => keys.has(code);
  input.forward = (pressed('KeyW') || pressed('ArrowUp') ? 1 : 0) - (pressed('KeyS') || pressed('ArrowDown') ? 1 : 0);
  input.strafe = (pressed('KeyD') ? 1 : 0) - (pressed('KeyA') ? 1 : 0);
  input.turn = (pressed('ArrowLeft') ? 1 : 0) - (pressed('ArrowRight') ? 1 : 0);
  input.run = pressed('ShiftLeft') || pressed('ShiftRight');
  input.crouch = pressed('KeyC');
}

function clearKeys() {
  keys.clear();
  updateInputFromKeys();
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'Tab') {
    event.preventDefault();
    if (mode === 'playing') toggleOverlay(overlay === 'board' ? null : 'board');
    return;
  }
  if (event.repeat) {
    if (event.code === 'KeyE' || event.code === 'Space') event.preventDefault();
    return;
  }
  keys.add(event.code);
  updateInputFromKeys();

  if (event.code === 'Space') {
    event.preventDefault();
    input.jump = true;
  }
  if (event.code === 'KeyQ') {
    event.preventDefault();
    input.roll = true;
  }
  if (event.code === 'KeyR') {
    event.preventDefault();
    input.throw = true;
  }
  if (event.code === 'KeyM') {
    event.preventDefault();
    if (mode === 'playing') toggleOverlay(overlay === 'map' ? null : 'map');
    return;
  }
  if (event.code === 'KeyE' || event.code === 'Enter') {
    event.preventDefault();
    if (overlay) { toggleOverlay(null); return; }
    if (mode === 'paused') { togglePause(false); return; }
    input.interact = true;
  }
  if (event.code === 'KeyF') {
    event.preventDefault();
    input.attack = true;
  }
  if (event.code === 'Escape') {
    if (overlay) { toggleOverlay(null); return; }
    togglePause(true);
  }
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
  updateInputFromKeys();
});

window.addEventListener('blur', () => {
  clearKeys();
});

function togglePause(force) {
  if (mode !== 'playing' && mode !== 'paused') return;
  const want = force === undefined ? mode === 'playing' : force;
  if (want && overlay) toggleOverlay(null);
  paused = want;
  mode = want ? 'paused' : 'playing';
  ui.showPause(want);
  if (want) {
    if (document.pointerLockElement) document.exitPointerLock();
    clearKeys();
  } else {
    requestLock();
  }
}

/** Full screen map / chapter board. They freeze the bear but keep the world alive. */
function toggleOverlay(next) {
  overlay = next;
  ui.showMap(next === 'map');
  ui.showBoard(next === 'board');
  if (next) {
    if (document.pointerLockElement) document.exitPointerLock();
    clearKeys();
    if (next === 'board') ui.setLevelBoard({ levels: LEVELS, state: levels.state });
    if (next === 'map') drawBigMap();
  } else if (mode === 'playing') {
    requestLock();
  }
}

function requestLock() {
  if (isTouch || overlay) return;
  if (!canvas.requestPointerLock) return;
  try {
    const result = canvas.requestPointerLock();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (error) {
    /* pointer lock needs a user gesture; ignore when it is denied */
  }
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    hadPointerLock = true;
  } else if (hadPointerLock && mode === 'playing' && !overlay) {
    togglePause(true);
  }
});

window.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== canvas || mode !== 'playing' || dialogue || overlay) return;
  player.look(event.movementX || 0, event.movementY || 0, 0.0021);
});

canvas.addEventListener('click', () => {
  if (mode === 'playing' && !dialogue && !overlay) requestLock();
});

canvas.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  if (document.pointerLockElement !== canvas) return;
  if (mode !== 'playing' || dialogue || overlay) return;
  input.attack = true;
});

// ------------------------------------------------------------------ interaction
function inFront(target, maxDot) {
  const dx = target.x - player.position.x;
  const dz = target.z - player.position.z;
  const distance = Math.hypot(dx, dz) || 1;
  const facing = (dx / distance) * Math.sin(player.state.yaw) + (dz / distance) * Math.cos(player.state.yaw);
  return { distance, facing, ok: facing >= maxDot };
}

/** The single thing the E key would act on right now, or null. */
function findInteraction() {
  let best = null;
  const consider = (candidate) => {
    if (!best || candidate.distance < best.distance) best = candidate;
  };

  const npc = nearestOf(talkables, player.position, 4.4);
  if (npc) {
    const test = inFront(npc.sprite.position, 0.1);
    if (test.ok) {
      consider({ kind: 'npc', target: npc, distance: test.distance });
    }
  }

  for (const totem of props.totems) {
    const test = inFront(totem.position, -0.2);
    if (test.distance < 5.2 && test.ok) {
      consider({ kind: 'totem', target: totem, distance: test.distance });
    }
  }

  for (const crystal of props.crystals) {
    if (crystal.userData.lit) continue;
    const test = inFront(crystal.position, -0.1);
    if (test.distance < 3.8 && test.ok) {
      consider({ kind: 'crystal', target: crystal, distance: test.distance });
    }
  }

  return best;
}

function promptFor(hit) {
  if (!hit) return null;
  if (hit.kind === 'npc') return `<kbd>${PAW_KEY}</kbd> 和 <em>${hit.target.name}</em> 说话`;
  if (hit.kind === 'crystal') return `<kbd>${PAW_KEY}</kbd> 点亮 <em>晶石</em>`;
  const level = LEVELS.find((l) => l.totem.x === hit.target.position.x && l.totem.z === hit.target.position.z);
  if (level) {
    const done = levels.state.done[level.id] ? '(已通关)' : '';
    return `<kbd>${PAW_KEY}</kbd> 关卡石碑 · <em>第 ${level.index} 关 · ${level.title}</em>${done}`;
  }
  return `<kbd>${PAW_KEY}</kbd> 查看 <em>关卡石碑</em>`;
}

function startDialogue(npc) {
  dialogue = { npc, index: 0 };
  ui.openDialogue(npc.name, scriptFor(npc)[0]);
  ui.setPrompt(null);
  audio.blip(npc.id.charCodeAt(0) * 3 + 400);
  if (!talked.has(npc.id)) {
    talked.add(npc.id);
    if (npc.id === 'xiongda') levels.onIntroDone();
  }
}

function scriptFor(npc) {
  if (npc.done && levels.state.completedCount >= LEVELS.length) return npc.done;
  return npc.talked ? (npc.after || npc.lines) : npc.lines;
}

function advanceDialogue() {
  if (!dialogue) return;
  if (ui.finishTyping()) return;
  const npc = dialogue.npc;
  dialogue.index += 1;
  const list = scriptFor(npc);
  if (dialogue.index < list.length) {
    ui.openDialogue(npc.name, list[dialogue.index]);
    audio.blip(460 + dialogue.index * 40);
    return;
  }
  npc.talked = true;
  ui.closeDialogue();
  dialogue = null;
}

// ------------------------------------------------------------------ pickups
function collectItem(item) {
  item.userData.collected = true;
  item.visible = false;
  const kind = item.userData.kind;
  bag[kind] = (bag[kind] || 0) + 1;
  audio.pickup();
  ui.setBag(bagCounts());
  if (kind === 'cone') ui.toast(`捡到一颗 <b>金松果</b> · 共 ${bag.cone} 颗`, 1600);
  else if (kind === 'honey') ui.toast(`捞到一罐 <b>野蜂蜜</b> · 共 ${bag.honey} 罐`, 1600);
  else ui.toast(`采到一朵 <b>发光蘑菇</b> · 共 ${bag.shroom} 朵`, 1600);
  levels.onPickup(kind);
  saveSoon();
}

function bagCounts() {
  return { ...bag, stars: levels ? levels.state.completedCount : 0, total: LEVELS.length };
}

function lightCrystal(crystal) {
  crystal.userData.lit = true;
  audio.fanfare();
  ui.toast('点亮了一块 <b>晶石</b>', 1600);
  levels.onCrystalLit();
  saveSoon();
}

// ------------------------------------------------------------------ environment
const env = {
  setNight(on) {
    world.setNight(on, renderer);
    ui.setStateChip(on
      ? '夜晚 · 星光下也能看清路'
      : 'WASD 走路 · Shift 跑 · C 蹲 · Q 翻滚 · F 出掌 · R 扔石头');
  },
  /** All five chapters cleared: hand the screen over to the ending. */
  win() {
    mode = 'win';
    if (document.pointerLockElement) document.exitPointerLock();
    ui.setHud(false);
    saveNow();
  },
};

function drawBigMap() {
  ui.drawBigMap({
    regions: REGIONS,
    river: RIVER,
    paths: world.pathSamples,
    landmarks: LANDMARKS,
    player: { x: player.position.x, z: player.position.z, yaw: player.state.yaw },
    objective: levels.objective,
    totems: props.totems.map((t) => {
      const level = LEVELS.find((l) => l.totem.x === t.position.x && l.totem.z === t.position.z);
      return {
        x: t.position.x,
        z: t.position.z,
        label: level ? `${level.index}. ${level.title}` : '',
        done: level ? levels.state.done[level.id] : false,
        active: level ? levels.state.activeId === level.id : false,
      };
    }),
    items: props.items.filter((i) => !i.userData.collected)
      .map((i) => ({ x: i.position.x, z: i.position.z, kind: i.userData.kind })),
    crystals: props.crystals.map((c) => ({ x: c.position.x, z: c.position.z, lit: c.userData.lit })),
    neighbours: neighbours.list.map((n) => ({
      x: n.sprite.position.x, z: n.sprite.position.z, talked: n.talked,
    })),
    levelLines: LEVELS.map((level) => ({
      done: levels.state.done[level.id],
      active: levels.state.activeId === level.id,
      text: `第 ${level.index} 关 · ${level.title} · ${level.where}`
        + (level.need ? ` · ${levels.state.progress[level.id]}/${level.need}` : '')
        + (levels.state.done[level.id] ? ' · 已通关' : ''),
    })),
  });
}

// ------------------------------------------------------------------ saving
function snapshot() {
  return {
    done: levels.state.done,
    progress: levels.state.progress,
    bag,
    activeId: levels.state.activeId,
    introDone: levels.state.introDone,
  };
}

function saveSoon() {
  saveTimer = Math.min(saveTimer, 4);
}

function saveNow() {
  if (!levels) return;
  writeSave(snapshot());
}

// Closing the tab or backgrounding the page must not lose the chapter progress:
// the periodic save is 30 seconds apart, which is a long window to lose.
window.addEventListener('pagehide', saveNow);
window.addEventListener('beforeunload', saveNow);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveNow();
});

// ------------------------------------------------------------------ touch
function setupTouch() {
  if (!isTouch) return;
  ui.setTouch(true);
  const stick = document.getElementById('stick');
  const knob = stick.querySelector('i');
  let stickId = null;
  let lookId = null;
  let lookX = 0;
  let lookY = 0;
  const resetStick = () => {
    input.forward = 0;
    input.strafe = 0;
    knob.style.transform = 'translate(0,0)';
  };
  const moveStick = (event) => {
    const rect = stick.getBoundingClientRect();
    let dx = event.clientX - (rect.left + rect.width / 2);
    let dy = event.clientY - (rect.top + rect.height / 2);
    const limit = rect.width / 2 - 18;
    const len = Math.hypot(dx, dy);
    if (len > limit) {
      dx *= limit / len;
      dy *= limit / len;
    }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    input.strafe = dx / limit;
    input.forward = -dy / limit;
  };
  stick.addEventListener('pointerdown', (event) => {
    stickId = event.pointerId;
    stick.setPointerCapture(event.pointerId);
    moveStick(event);
  });
  stick.addEventListener('pointermove', (event) => {
    if (event.pointerId === stickId) moveStick(event);
  });
  stick.addEventListener('pointerup', (event) => {
    if (event.pointerId === stickId) { stickId = null; resetStick(); }
  });
  canvas.addEventListener('pointerdown', (event) => {
    lookId = event.pointerId;
    lookX = event.clientX;
    lookY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId !== lookId || mode !== 'playing') return;
    player.look((event.clientX - lookX) * 1.4, (event.clientY - lookY) * 1.4, 0.0026);
    lookX = event.clientX;
    lookY = event.clientY;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId === lookId) lookId = null;
  });
  const bind = (id, action) => {
    const node = document.getElementById(id);
    if (!node) return;
    node.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      action();
    });
  };
  bind('btn-use', () => { input.interact = true; });
  bind('btn-jump', () => { input.jump = true; });
  bind('btn-hit', () => { input.attack = true; });
  bind('btn-roll', () => { input.roll = true; });
  bind('btn-throw', () => { input.throw = true; });
}

// ------------------------------------------------------------------ loop
function step(dt) {
  clock.time += dt;
  if (!player) return;
  if (mode === 'playing' || mode === 'paused' || mode === 'win') {
    world.update(dt, clock.time);
  }
  if (mode !== 'playing') {
    input.interact = false;
    input.jump = false;
    input.attack = false;
    input.roll = false;
    input.throw = false;
    return;
  }
  if (overlay) {
    // the map and the chapter board freeze the bear but not the valley
    arena.update(dt, clock.time, player.position);
    props.update(dt, clock.time, player.position);
    levels.update(dt, clock.time, player.position);
    input.interact = false;
    input.attack = false;
    input.roll = false;
    input.throw = false;
    return;
  }

  if (input.turn) player.state.yaw += input.turn * 2.3 * dt;

  // ---------------- knocked out ----------------
  if (downTimer > 0) {
    downTimer -= dt;
    player.update(dt, { ...input, forward: 0, strafe: 0, jump: false, roll: false, attack: false });
    if (downTimer <= 0) {
      player.revive();
      player.teleport(2, 14, Math.PI);
      previousX = player.position.x;
      previousZ = player.position.z;
      ui.toast('熊二被抬回营地,缓过来了……再去试试!', 3200);
    }
  } else {
    player.update(dt, input);
  }

  // ---------------- paw combat ----------------
  if (input.attack) {
    input.attack = false;
    if (!dialogue && player.attack()) audio.blip(320);
  }
  if (player.state.attacking) {
    ui.setCombo(player.state.attackIndex + 1);
  } else {
    ui.setCombo(0);
  }
  if (!dialogue && player.attackImpactReady()) {
    let landed = false;
    if (boss && boss.resolvePunch()) {
      boss.applyHit();
      landed = true;
    }
    if (arena.resolveSwing(player.attackDamage()) > 0) landed = true;
    if (landed) {
      player.state.attackLanded = true;
      ui.hitFlash();
    }
  }

  // ---------------- thrown stones ----------------
  for (const shot of player.projectiles) {
    if (!shot.live || shot.hit) continue;
    const sx = shot.sprite.position.x;
    const sz = shot.sprite.position.z;
    let hit = false;
    if (arena.hitNear(sx, sz, 1.8, 12) > 0) hit = true;
    if (boss && boss.state.active && boss.hitNear(sx, sz, 2.0, 12)) hit = true;
    if (hit) {
      shot.hit = true;
      shot.live = false;
      shot.sprite.visible = false;
      audio.blip(260);
    }
  }

  playSeconds += dt;

  const moved = Math.hypot(player.position.x - previousX, player.position.z - previousZ);
  previousX = player.position.x;
  previousZ = player.position.z;
  walkDistance += moved;
  stepAccumulator += moved;
  const stride = player.state.speed > 5.4 ? 2.7 : 2.1;
  if (stepAccumulator > stride) {
    stepAccumulator = 0;
    audio.footstep(player.state.speed > 5.4, player.state.wading ? 'water' : 'grass');
  }

  // ---------------- wading / falling into the river ----------------
  const inGorge = Math.abs(player.position.x - RIVER.x) < RIVER.halfWidth;
  const onBridge = isOnBridge(player.position.x, player.position.z);
  const inWater = inGorge && !onBridge && player.position.y < RIVER.waterY + 0.6;
  if (inWater && !player.state.wasInRiver) {
    player.state.wasInRiver = true;
    audio.footstep(false);
    ui.toast('哎呀!<b>掉河里了</b>,浑身湿透……回到岸上再来一次!', 2600);
  } else if (!inWater && player.position.y > -0.4 && player.state.wasInRiver) {
    player.state.wasInRiver = false;
  }
  if (inWater) {
    const toWest = Math.abs(player.position.x - (RIVER.x - RIVER.halfWidth));
    const toEast = Math.abs(player.position.x - (RIVER.x + RIVER.halfWidth));
    const bank = toWest < toEast ? RIVER.x - RIVER.halfWidth - 2.4 : RIVER.x + RIVER.halfWidth + 2.4;
    player.position.set(bank, terrainHeight(bank, player.position.z) + 0.4, player.position.z);
    player.state.onGround = false;
    player.state.stun = 0.45;
    player.state.shake = 0.8;
    if (player.hurt(6)) ui.hitFlash();
  }

  // ---------------- health ----------------
  if (player.state.hp <= 0 && downTimer <= 0) {
    downTimer = 1.5;
    ui.hitFlash();
    ui.toast('<b>熊二倒下了!</b>', 2000);
  }
  if (player.state.hurtFlash > 0.85) ui.hitFlash();

  chirpTimer -= dt;
  if (chirpTimer <= 0 && !dialogue) {
    chirpTimer = 3 + Math.random() * 7;
    audio.chirp(Math.random() * 2 - 1, 0.03 + Math.random() * 0.03);
  }

  neighbours.update(dt, clock.time, player.position);

  // ---------------- the lumberjack ----------------
  if (boss) {
    if (!boss.state.active && boss.state.phase !== 'defeated' && boss.state.phase !== 'fleeing') {
      const toTree = Math.hypot(player.position.x - 48, player.position.z - 13);
      if (toTree < 30 || levels.state.activeId === 'lv1') boss.activate();
    }
    boss.update(dt, clock.time, player.position, Boolean(dialogue));
    if (boss.state.lastEvent === 'treeFell') {
      boss.state.lastEvent = null;
      treeRespawnTimer = 3.4;
      ui.toast('<b>大树倒了!</b> 光头强又拖来一棵继续砍……再来一次!', 4200);
    }
    const fighting = boss.state.active && boss.state.phase !== 'fleeing' && boss.state.phase !== 'defeated';
    const near = Math.hypot(boss.character.sprite.position.x - player.position.x,
      boss.character.sprite.position.z - player.position.z) < 48;
    ui.setBossBars(fighting && near
      ? { name: '光头强', hp: boss.getHp(), maxHp: 100, treeHp: boss.getTreeHp(), treeMaxHp: 100 }
      : null);
    if (boss.state.hp <= 0 && boss.state.phase === 'defeated' && !bossDefeatHandled) {
      bossDefeatHandled = true;
      levels.onBossDefeated();
      saveSoon();
    }
  }
  if (treeRespawnTimer > 0) {
    treeRespawnTimer -= dt;
    if (treeRespawnTimer <= 0) {
      boss.reset();
      boss.activate();
    }
  }

  // ---------------- arena ----------------
  arena.update(dt, clock.time, player.position);
  if (arena.state.active) {
    ui.setBossBars({
      name: `第 ${arena.state.wave + 1} 波 · 剩 ${arena.getAlive()}`,
      hp: Math.max(0, 100 - (arena.state.wave * 33 + Math.max(0, 3 - arena.getAlive()) * 8)),
      maxHp: 100,
      tree: false,
    });
  }

  props.update(dt, clock.time, player.position);

  // ---------------- auto pickups ----------------
  for (const item of props.items) {
    if (item.userData.collected) continue;
    const d = Math.hypot(item.position.x - player.position.x, item.position.z - player.position.z);
    if (d < 2.2) collectItem(item);
  }

  // ---------------- interaction prompt ----------------
  const hit = dialogue ? null : findInteraction();
  if (dialogue) {
    if (input.interact) advanceDialogue();
    input.interact = false;
  } else {
    ui.setPrompt(promptFor(hit));
    if (input.interact) {
      input.interact = false;
      if (hit && hit.kind === 'npc') startDialogue(hit.target);
      else if (hit && hit.kind === 'crystal') lightCrystal(hit.target);
      else if (hit && hit.kind === 'totem') {
        ui.setLevelBoard({ levels: LEVELS, state: levels.state });
        toggleOverlay('board');
      }
    }
  }

  levels.update(dt, clock.time, player.position);

  ui.setVitals({
    hp: Math.max(0, player.state.hp),
    maxHp: player.state.maxHp,
    stamina: player.state.stamina,
    staminaMax: player.state.staminaMax,
    wading: player.state.wading,
    crouching: player.state.crouching,
    rolling: player.state.rolling,
  });

  ui.setCompass(player.state.yaw, player.position.x, player.position.z);
  updateTracker();

  minimapTimer -= dt;
  if (minimapTimer <= 0) {
    minimapTimer = 0.14;
    ui.drawMinimap({
      regions: REGIONS,
      paths: world.pathSamples,
      landmarks: LANDMARKS,
      river: RIVER,
      objective: levels.objective,
      items: props.items.filter((c) => !c.userData.collected)
        .map((c) => ({ x: c.position.x, z: c.position.z, kind: c.userData.kind })),
      totems: props.totems.map((t) => {
        const level = LEVELS.find((l) => l.totem.x === t.position.x && l.totem.z === t.position.z);
        return {
          x: t.position.x,
          z: t.position.z,
          done: level ? levels.state.done[level.id] : false,
          active: level ? levels.state.activeId === level.id : false,
        };
      }),
      neighbours: neighbours.list.map((n) => ({
        x: n.sprite.position.x, z: n.sprite.position.z, talked: n.talked,
      })),
      player: { x: player.position.x, z: player.position.z, yaw: player.state.yaw },
    });
  }

  mapTimer -= dt;
  if (mapTimer <= 0) {
    mapTimer = 0.2;
    // building the payload allocates a dozen arrays; skip it entirely when the
    // map is not on screen
    if (ui.isMapOpen()) drawBigMap();
  }

  saveTimer -= dt;
  if (saveTimer <= 0) {
    saveTimer = 30;
    saveNow();
  }

  if (toastCooldown > 0) toastCooldown -= dt;
}

/** Rotate the little arrow so it always points at the current objective. */
function updateTracker() {
  if (mode !== 'playing' || !levels.objective.show) {
    ui.setTracker(null);
    return;
  }
  const dx = levels.objective.x - player.position.x;
  const dz = levels.objective.z - player.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 2.2) {
    ui.setTracker(null);
    return;
  }
  const targetAngle = Math.atan2(dx, dz);
  let relative = targetAngle - player.state.yaw;
  relative = Math.atan2(Math.sin(relative), Math.cos(relative));
  ui.setTracker({
    label: levels.objective.label,
    distance,
    degrees: (relative * 180) / Math.PI,
  });
}

let lastFrame = performance.now();
let fps = 60;
let frameBudget = 16.7;
let slowFrames = 0;
let fastFrames = 0;

/**
 * Keep the internal resolution just high enough to hold the display's refresh
 * rate. Frames are only judged against the measured refresh interval, otherwise
 * vsync would look like "no headroom" and the resolution would ratchet down.
 */
function adaptResolution(dt) {
  const ms = dt * 1000;
  frameBudget = frameBudget * 0.92 + ms * 0.08;
  const target = refreshMs;
  if (frameBudget > target * 1.35) {
    slowFrames += 1;
    fastFrames = 0;
  } else if (frameBudget < target * 1.05) {
    fastFrames += 1;
    slowFrames = 0;
  }
  if (slowFrames >= 45 && renderScale > 0.6) {
    renderScale = Math.max(0.6, renderScale * 0.88);
    slowFrames = 0;
    applyPixelRatio();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  } else if (fastFrames >= 240 && renderScale < 1) {
    renderScale = Math.min(1, renderScale * 1.08);
    fastFrames = 0;
    applyPixelRatio();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }
}

function frame(now) {
  const dt = Math.min(0.05, Math.max(0.0001, (now - lastFrame) / 1000));
  lastFrame = now;
  fps = fps * 0.9 + (1 / dt) * 0.1;
  step(dt);
  adaptResolution(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// deterministic hook used by the automated test client
window.advanceTime = (ms) => {
  const frames = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < frames; i += 1) {
    step(1 / 60);
    renderer.render(scene, camera);
  }
  return frames;
};

/**
 * Test-only introspection and setup.
 *
 * The smoke test used to reach each scenario by reloading the page with a
 * different `?pose=` / `?dev=` combination, which meant ~17 WebGL contexts in a
 * row and an occasional GPU process crash. Driving one loaded page through this
 * is both faster and far more reliable, and it exercises the same public systems
 * the keyboard does.
 */
window.__dshDebug = {
  projectiles: () => (player ? player.projectiles.filter((p) => p.live).length : 0),
  liveEnemies: () => (arena ? arena.getAlive() : 0),
  enemies: () => (arena ? arena.list.filter((e) => !e.dead).map((e) => ({
    name: e.data.name,
    hp: e.hp,
    x: +e.character.sprite.position.x.toFixed(2),
    z: +e.character.sprite.position.z.toFixed(2),
  })) : []),
  totemCount: () => (props ? props.totems.length : 0),
  regionAt: (x, z) => REGIONS.map((r) => `${r.id}:${Math.round(Math.hypot(r.x - x, r.z - z))}`).join(' '),
  terrainAt: (x, z) => terrainHeight(x, z),
  place: (x, z, yawDeg) => {
    if (!player) return false;
    player.teleport(x, z, yawDeg === undefined ? undefined : (yawDeg * Math.PI) / 180);
    previousX = player.position.x;
    previousZ = player.position.z;
    return true;
  },
  startLevel: (id) => levels.start(id),
  introDone: () => levels.onIntroDone(),
  resetProgress: () => {
    for (const level of LEVELS) {
      levels.state.done[level.id] = false;
      levels.state.progress[level.id] = 0;
    }
    levels.state.completedCount = 0;
    levels.state.activeId = null;
    levels.state.introDone = false;
    bag = { cone: 0, honey: 0, shroom: 0 };
    for (const item of props.items) {
      item.userData.collected = false;
      item.visible = true;
    }
    for (const crystal of props.crystals) crystal.userData.lit = false;
    arena.stop();
    ui.setBag(bagCounts());
    levels.refreshObjective();
  },
  give: (kind, count) => {
    let taken = 0;
    for (const item of props.items) {
      if (taken >= count) break;
      if (item.userData.kind !== kind || item.userData.collected) continue;
      item.userData.collected = true;
      item.visible = false;
      bag[kind] = (bag[kind] || 0) + 1;
      taken += 1;
      levels.onPickup(kind);
    }
    ui.setBag(bagCounts());
    saveSoon();
    return taken;
  },
  lightCrystal: (index) => {
    const crystal = props.crystals[index];
    if (!crystal) return false;
    crystal.userData.lit = true;
    levels.onCrystalLit();
    saveSoon();
    return true;
  },
  levelSnapshot: () => levels.snapshot(),
  bag: () => ({ ...bag }),
  /** Come back from the ending screen so the test can keep driving the page. */
  resume: () => {
    mode = 'playing';
    ui.hideWin();
    ui.setHud(true);
    return mode;
  },
};

/**
 * Texture memory actually resident on the GPU.
 *
 * Keyed by texture.source, not by Texture object: three.js uploads one copy per
 * *source*, and clone() shares the source, so counting objects would invent VRAM
 * that is not there.
 */
function textureMemory() {
  const seen = new Set();
  let bytes = 0;
  scene.traverse((node) => {
    const material = node.material;
    if (!material) return;
    for (const value of Object.values(material)) {
      if (value && value.isTexture && value.image && !seen.has(value.source.uuid)) {
        seen.add(value.source.uuid);
        const { width = 0, height = 0 } = value.image;
        const mips = value.generateMipmaps && value.minFilter !== THREE.NearestFilter ? 4 / 3 : 1;
        bytes += width * height * 4 * mips;
      }
    }
  });
  return { unique: seen.size, mb: bytes / 1048576 };
}

function canvasMemory() {
  const gl = renderer.getContext();
  const pixels = renderer.domElement.width * renderer.domElement.height;
  const samples = ANTIALIAS ? (gl.getParameter(gl.SAMPLES) || 4) : 1;
  return (pixels * 4 * (1 + samples)) / 1048576;
}

window.render_game_to_text = () => {
  if (!player) return JSON.stringify({ mode });
  const near = neighbours ? neighbours.nearest(player.position) : null;
  const entry = (n) => ({
    name: n.name,
    x: +n.sprite.position.x.toFixed(1),
    z: +n.sprite.position.z.toFixed(1),
    dist: +Math.hypot(n.sprite.position.x - player.position.x, n.sprite.position.z - player.position.z).toFixed(1),
    talked: n.talked,
  });
  const nearby = neighbours
    ? neighbours.list.map(entry)
      .filter((n) => n.dist < 26)
      .sort((a, b) => a.dist - b.dist)
    : [];
  return JSON.stringify({
    mode,
    paused,
    overlay,
    level: levels ? {
      active: levels.state.activeId,
      completed: levels.state.completedCount,
      total: LEVELS.length,
      done: levels.state.done,
      progress: levels.state.progress,
      introDone: levels.state.introDone,
      title: document.getElementById('q-title').textContent,
    } : null,
    levels: levels ? levels.snapshot() : [],
    questStage: levels ? levels.state.activeId : null,
    questTitle: document.getElementById('q-title').textContent,
    questHint: document.getElementById('q-hint').textContent,
    objective: levels ? {
      label: levels.objective.label,
      x: +levels.objective.x.toFixed(1),
      z: +levels.objective.z.toFixed(1),
      show: levels.objective.show,
      distance: +Math.hypot(levels.objective.x - player.position.x, levels.objective.z - player.position.z).toFixed(1),
    } : null,
    boss: boss ? {
      active: boss.state.active,
      phase: boss.state.phase,
      hp: boss.getHp(),
      treeHp: boss.getTreeHp(),
      x: +boss.character.sprite.position.x.toFixed(1),
      z: +boss.character.sprite.position.z.toFixed(1),
      distance: +Math.hypot(
        boss.character.sprite.position.x - player.position.x,
        boss.character.sprite.position.z - player.position.z,
      ).toFixed(2),
    } : null,
    arena: arena ? {
      active: arena.state.active,
      wave: arena.state.wave,
      alive: arena.getAlive(),
      cleared: arena.state.cleared,
    } : null,
    attacking: player.state.attacking,
    attackIndex: player.state.attackIndex,
    rolling: player.state.rolling,
    crouching: player.state.crouching,
    wading: player.state.wading,
    hurt: +player.state.hurtFlash.toFixed(2),
    stun: +player.state.stun.toFixed(2),
    inWater: player.state.wasInRiver,
    onBridge: isOnBridge(player.position.x, player.position.z),
    player: {
      x: +player.position.x.toFixed(2),
      z: +player.position.z.toFixed(2),
      y: +player.position.y.toFixed(2),
      yawDeg: +(((player.state.yaw * 180) / Math.PI) % 360).toFixed(1),
      speed: +player.state.speed.toFixed(2),
      onGround: player.state.onGround,
      hp: +player.state.hp.toFixed(1),
      maxHp: player.state.maxHp,
      stamina: +player.state.stamina.toFixed(1),
      ground: +terrainHeight(player.position.x, player.position.z).toFixed(2),
    },
    quest: {
      found: bag.cone,
      total: 7,
      hint: document.getElementById('q-hint').textContent,
      neighboursTalked: talked.size,
    },
    bag: { ...bag, stars: levels.state.completedCount },
    items: props ? props.items.map((c, i) => ({
      i,
      kind: c.userData.kind,
      x: +c.position.x.toFixed(1),
      z: +c.position.z.toFixed(1),
      collected: c.userData.collected,
    })) : [],
    pinecones: props ? props.items
      .map((c, i) => ({ i, c }))
      .filter((e) => e.c.userData.kind === 'cone')
      .map((e) => ({
        i: e.i,
        x: +e.c.position.x.toFixed(1),
        z: +e.c.position.z.toFixed(1),
        collected: e.c.userData.collected,
      })) : [],
    crystals: props ? props.crystals.map((c, i) => ({
      i, x: +c.position.x.toFixed(1), z: +c.position.z.toFixed(1), lit: c.userData.lit,
    })) : [],
    totems: props ? props.totems.map((t) => ({ x: +t.position.x.toFixed(1), z: +t.position.z.toFixed(1) })) : [],
    dialogue: dialogue
      ? { speaker: dialogue.npc.name, line: dialogue.index, text: document.getElementById('d-text').textContent }
      : null,
    prompt: document.getElementById('prompt').classList.contains('on')
      ? document.getElementById('prompt').textContent
      : null,
    nearest: near ? {
      name: near.name,
      dist: +Math.hypot(near.sprite.position.x - player.position.x, near.sprite.position.z - player.position.z).toFixed(2),
    } : null,
    nearbyNeighbours: nearby,
    landmarks: LANDMARKS,
    arena2: { x: ARENA.x, z: ARENA.z },
    seconds: +playSeconds.toFixed(1),
    distance: +walkDistance.toFixed(1),
    fps: Math.round(fps),
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    renderScale: +renderScale.toFixed(2),
    pixelRatio: +renderer.getPixelRatio().toFixed(2),
    memory: (() => {
      const tex = textureMemory();
      return {
        gpuTextures: renderer.info.memory.textures,
        gpuGeometries: renderer.info.memory.geometries,
        programs: renderer.info.programs ? renderer.info.programs.length : 0,
        textureMB: +tex.mb.toFixed(1),
        uniqueTextures: tex.unique,
        jsHeapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
        canvasMB: +canvasMemory().toFixed(1),
      };
    })(),
    hint: 'WASD 走路 / Shift 跑 / C 蹲 / Q 翻滚 / Space 跳 / F 熊掌三连 / R 扔石头 / E 交互 / M 地图 / Tab 关卡',
  });
};

// ------------------------------------------------------------------ boot
function enterGame() {
  ui.hideStart();
  ui.setHud(true);
  mode = 'playing';
  audio.start();
  if (!isTouch) requestLock();
  levels.setCard(levels.activeLevel());
  levels.refreshObjective();
  ui.toast('整片狗熊岭随便走,发光的<b>关卡石碑</b>按 E 就能选关', 4000);
  canvas.focus();
}

document.getElementById('btn-start').addEventListener('click', enterGame);
document.getElementById('btn-resume').addEventListener('click', () => togglePause(false));
document.getElementById('btn-again').addEventListener('click', () => {
  clearSave();
  location.reload();
});
document.getElementById('dialogue').addEventListener('click', () => {
  if (dialogue) advanceDialogue();
});

function applySave(save) {
  if (!save) return;
  for (const level of LEVELS) {
    if (save.done[level.id]) {
      levels.state.done[level.id] = true;
      levels.state.completedCount += 1;
    }
    if (typeof save.progress[level.id] === 'number') {
      levels.state.progress[level.id] = Math.min(level.need || 99, save.progress[level.id]);
    }
  }
  bag = { ...bag, ...save.bag };
  levels.state.introDone = save.introDone;
  if (save.activeId && !levels.state.done[save.activeId]) levels.state.activeId = save.activeId;
  // re-apply the world side of the progress so the map and the tracker agree
  let remainingCones = bag.cone;
  let remainingHoney = bag.honey;
  let remainingShrooms = bag.shroom;
  for (const item of props.items) {
    const kind = item.userData.kind;
    if (kind === 'cone' && remainingCones > 0) { remainingCones -= 1; item.userData.collected = true; item.visible = false; }
    if (kind === 'honey' && remainingHoney > 0) { remainingHoney -= 1; item.userData.collected = true; item.visible = false; }
    if (kind === 'shroom' && remainingShrooms > 0) { remainingShrooms -= 1; item.userData.collected = true; item.visible = false; }
  }
  const lit = levels.state.progress.lv4 || 0;
  props.crystals.slice(0, lit).forEach((crystal) => { crystal.userData.lit = true; });
  // replay the upgrades the completed chapters had already granted
  for (const level of LEVELS) {
    if (levels.state.done[level.id] && player.grantReward) player.grantReward(level.id);
  }
}

loadTextures((done, total, file) => {
  ui.setLoading(done / total, '加载 ' + file + ' (' + done + '/' + total + ')');
}).then((textures) => {
  ui.setLoading(1, '搭 建 狗 熊 岭 …');
  world = buildWorld(scene, textures);
  neighbours = buildNeighbours(scene, textures);
  props = createProps(scene, textures, world);
  world.colliders.push(...props.colliders);
  player = createPlayer(camera, scene, textures, world.colliders, groundHeightAt);
  boss = createBossFight(scene, textures, world, audio, player, ui);
  arena = createArena(scene, textures, { ui, audio, player });
  talkables = [...neighbours.list, boss.character];
  levels = createLevels({
    scene, ui, audio, world, props, player, boss, arena, env,
    xiongdaPos: { x: neighbours.list[0].x, z: neighbours.list[0].z },
    groundAt: groundHeightAt,
  });
  ui.onStartLevel((id) => {
    levels.start(id);
    toggleOverlay(null);
  });

  if (!FRESH) applySave(loadSave());
  ui.setBag(bagCounts());
  ui.setLevelBoard({ levels: LEVELS, state: levels.state });
  levels.setCard(levels.activeLevel());
  levels.refreshObjective();

  const pose = params.get('pose');
  if (pose) {
    const [px, pz, pyaw] = pose.split(',').map(Number);
    if (Number.isFinite(px) && Number.isFinite(pz)) player.teleport(px, pz);
    if (Number.isFinite(pyaw)) player.state.yaw = (pyaw * Math.PI) / 180;
  }
  previousX = player.position.x;
  previousZ = player.position.z;

  // dev-only shortcuts so the automated test client can reach any state quickly
  if (DEV) {
    const give = params.get('give');
    if (give) {
      for (const pair of give.split(',')) {
        const [kind, count] = pair.split(':');
        const want = Number(count) || 0;
        let taken = 0;
        for (const item of props.items) {
          if (taken >= want) break;
          if (item.userData.kind !== kind || item.userData.collected) continue;
          item.userData.collected = true;
          item.visible = false;
          bag[kind] = (bag[kind] || 0) + 1;
          taken += 1;
          levels.onPickup(kind);
        }
      }
    }
    const lit = Number(params.get('lit') || 0);
    if (lit > 0) {
      props.crystals.slice(0, lit).forEach((c) => { c.userData.lit = true; });
      levels.onCrystalLit();
    }
    const level = params.get('level');
    if (level) levels.start(level);
    if (params.get('intro') === '1') levels.state.introDone = true;
    ui.setBag(bagCounts());
    levels.refreshObjective();
  }

  setupTouch();
  onResize();
  requestAnimationFrame(() => {
    renderer.render(scene, camera);
    ui.showStart();
    if (AUTOSTART) enterGame();
    requestAnimationFrame(frame);
  });
}).catch((error) => {
  ui.setLoading(1, '加载失败:' + error.message);
  console.error(error);
});
