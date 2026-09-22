import * as THREE from '../vendor/three.module.js';
import { loadTextures } from './assets.js';
import { buildWorld, LANDMARKS, RIVER, groundHeightAt, isOnBridge } from './world.js';
import { buildNeighbours, nearestOf, syncCharacter } from './npcs.js';
import { createPlayer } from './player.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';
import { createBossFight } from './boss.js';
import { createQuest } from './quest.js';

const ui = createUI();
const audio = createAudio();
const params = new URLSearchParams(location.search);
const AUTOSTART = params.get('autostart') === '1';

const HINTS = {
  xiongda: '去林子里找会发光的金松果,找齐 7 颗带回来给我。',
  bengbeng: '营地向北,那棵最大的千年大树下面有一颗。',
  jiji: '西边的巨石阵下面藏着一颗,敢不敢去?',
  tutu: '东边的小路上有一颗被风吹走的松果。',
  asong: '东北方向的灌木丛里,我见过光一闪一闪的。',
  maomao: '东南边的林子里有一颗,别告诉吉吉大王是我说的。',
  gugu: '巨石阵的石头下面压着一颗,挪开石头就能看见。',
  huashen: '营地南边的蘑菇圈附近,有一颗金松果。',
  dahei: '北边的老林子深处还有两颗,小心别迷路。',
  laoli: '伐木场后面的空地上,应该还有一颗。',
  cuihua: '别光顾着玩,记得把松果带回家。',
  guangtouqiang: '伐木场这边我翻过木头,一颗松果也没有,别找了。',
};

const canvas = document.getElementById('scene');
// MSAA stays on: now that the forest is instanced there is room in the frame
// budget for it, and it is what keeps the hut/bridge/ground silhouettes clean.
// `?aa=0` drops it for machines that are still struggling.
const ANTIALIAS = params.get('aa') !== '0';
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: ANTIALIAS,
  stencil: false,
  powerPreference: 'high-performance',
});
const MAX_PIXEL_RATIO = 1.5;
// Adaptive resolution keeps the frame budget on the GPU we actually have: this is
// an integrated Arc, and the forest is fill rate bound, so pixels are the thing to
// trade. `?scale=0.75` forces a fixed scale for A/B measurement.
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
  forward: 0, strafe: 0, turn: 0, run: false, jump: false, interact: false, attack: false,
};
const keys = new Set();

let world = null;
let neighbours = null;
let boss = null;
let quest = null;
let talkables = [];
let player = null;
let mode = 'loading'; // loading | menu | playing | paused | win
let dialogue = null;
let collected = 0;
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

const TOTAL_CONES = 7;

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
}

window.addEventListener('keydown', (event) => {
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
  if (event.code === 'KeyE' || event.code === 'Enter') {
    event.preventDefault();
    if (mode === 'paused') {
      togglePause(false);
      return;
    }
    input.interact = true;
  }
  if (event.code === 'KeyF') {
    event.preventDefault();
    input.attack = true;
  }
  if (event.code === 'Escape') togglePause(true);
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
  updateInputFromKeys();
});

window.addEventListener('blur', () => {
  keys.clear();
  updateInputFromKeys();
});

function togglePause(force) {
  if (mode !== 'playing' && mode !== 'paused') return;
  const want = force === undefined ? mode === 'playing' : force;
  paused = want;
  mode = want ? 'paused' : 'playing';
  ui.showPause(want);
  if (want) {
    if (document.pointerLockElement) document.exitPointerLock();
    keys.clear();
    updateInputFromKeys();
  } else {
    requestLock();
  }
}

function requestLock() {
  if (isTouch) return;
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
  } else if (hadPointerLock && mode === 'playing') {
    togglePause(true);
  }
});

window.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== canvas || mode !== 'playing' || dialogue) return;
  player.look(event.movementX || 0, event.movementY || 0, 0.0021);
});

canvas.addEventListener('click', () => {
  if (mode === 'playing' && !dialogue) requestLock();
});

canvas.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  if (document.pointerLockElement !== canvas) return;
  if (mode !== 'playing' || dialogue) return;
  input.attack = true;
});

// ------------------------------------------------------------------ interaction
/** Xiong Da hands out both the tutorial and, later, the pinecone hunt. */
function xiongDaScript() {
  const stage = quest.state.stage;
  if (stage === 'intro') {
    return [
      '熊二!你可算醒啦,正好有急事!',
      '光头强在河对岸砍树呢,那棵大树要是倒了,咱们的家就没啦!',
      '沿着小路一直往东走,踩着独木桥过河,快去阻止他!',
    ];
  }
  if (stage === 'bridge') return ['还愣着干啥?过了独木桥就是光头强!'];
  if (stage === 'fight') return ['他就在桥东边的空地上砍树,按 F 用你的熊掌拍他!'];
  if (stage === 'report') {
    return [
      '干得漂亮,熊二!树保住了,狗熊岭谢谢你。',
      '不过还有件事——大风把 7 颗金松果吹得满森林都是。',
      '帮我把它们找回来吧,找齐了请你吃蜂蜜饼!',
    ];
  }
  if (quest.state.cones >= TOTAL_CONES) {
    return [
      '七颗金松果全都找齐啦!你真是狗熊岭最棒的熊!',
      '今晚大家一起吃蜂蜜饼,翠花的饼管够!',
    ];
  }
  return ['还差几颗金松果?它们会发光,夜里也看得见。', '和邻居们聊聊,他们知道松果都吹到哪儿去了。'];
}

function startDialogue(npc) {
  dialogue = { npc, index: 0 };
  ui.openDialogue(npc.name, scriptFor(npc)[0]);
  ui.setPrompt(null);
  audio.blip(npc.id.charCodeAt(0) * 3 + 400);
  if (!talked.has(npc.id)) {
    talked.add(npc.id);
    if (npc.id !== 'xiongda') {
      const hint = collected >= TOTAL_CONES ? '松果找齐啦,回去找熊大交任务吧!' : HINTS[npc.id];
      if (hint && quest.state.stage === 'cones') ui.setQuest(collected, TOTAL_CONES, hint);
    }
  }
}

function scriptFor(npc) {
  if (npc.id === 'xiongda') return xiongDaScript();
  if (quest.state.stage === 'cones' && quest.state.cones >= TOTAL_CONES && npc.done) return npc.done;
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
  if (npc.id === 'xiongda') {
    if (quest.state.stage === 'cones' && collected >= TOTAL_CONES) {
      finishGame();
    } else {
      quest.onXiongdaTalked();
    }
  }
}

function questDone() {
  return collected >= TOTAL_CONES;
}

function finishGame() {
  mode = 'win';
  if (document.pointerLockElement) document.exitPointerLock();
  audio.fanfare();
  ui.setHud(false);
  const total = playSeconds;
  ui.showWin({
    cones: collected,
    talked: talked.size,
    time: Math.floor(total / 60) + ':' + String(Math.floor(total % 60)).padStart(2, '0'),
    walk: Math.round(walkDistance) + 'm',
    text: '七颗金松果全部找齐啦!狗熊岭的邻居们都跑来给你鼓掌,熊大说今晚请大家吃蜂蜜。',
  });
}

function collectPinecone(cone) {
  cone.userData.collected = true;
  cone.visible = false;
  collected += 1;
  audio.pickup();
  if (collected >= TOTAL_CONES) {
    ui.toast('全部 <b>7</b> 颗金松果都找到啦!回去找 <b>熊大</b> 交任务吧');
  } else {
    ui.toast('捡到一颗 <b>金松果</b> ' + collected + ' / ' + TOTAL_CONES);
  }
  quest.onConeCollected(collected, TOTAL_CONES);
}

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
  document.getElementById('btn-use').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    input.interact = true;
  });
  document.getElementById('btn-jump').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    input.jump = true;
  });
  document.getElementById('btn-hit').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    input.attack = true;
  });
}

// ------------------------------------------------------------------ loop
function step(dt) {
  clock.time += dt;
  if (!player) return;
  if (mode === 'playing' || mode === 'paused' || mode === 'win') {
    world.update(dt, clock.time);
  }
  if (quest) quest.update(dt, clock.time);
  if (mode !== 'playing') {
    input.interact = false;
    input.jump = false;
    input.attack = false;
    return;
  }

  if (input.turn) player.state.yaw += input.turn * 2.3 * dt;
  player.update(dt, input);

  // ---------------- paw attack ----------------
  if (input.attack) {
    input.attack = false;
    if (!dialogue && player.attack()) audio.blip(320);
  }
  if (boss && player.attackImpactReady() && boss.resolvePunch()) {
    player.state.attackLanded = true;
    boss.applyHit();
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
    audio.footstep(player.state.speed > 5.4);
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
    // swept back to the nearest bank with a splash
    const toWest = Math.abs(player.position.x - (RIVER.x - RIVER.halfWidth));
    const toEast = Math.abs(player.position.x - (RIVER.x + RIVER.halfWidth));
    const bank = toWest < toEast ? RIVER.x - RIVER.halfWidth - 1.6 : RIVER.x + RIVER.halfWidth + 1.6;
    player.position.set(bank, 0.4, player.position.z);
    player.state.onGround = false;
    player.state.stun = 0.45;
    player.state.shake = 0.8;
  }

  // ---------------- crossed the bridge? ----------------
  if (quest.state.stage === 'bridge' && !onBridge
      && player.position.x > RIVER.x + RIVER.halfWidth + 1.2
      && player.position.y > -0.2) {
    quest.onCrossedBridge();
    if (boss) boss.activate();
  }

  chirpTimer -= dt;
  if (chirpTimer <= 0 && !dialogue) {
    chirpTimer = 3 + Math.random() * 7;
    audio.chirp(Math.random() * 2 - 1, 0.03 + Math.random() * 0.03);
  }

  neighbours.update(dt, clock.time, player.position);
  if (boss) {
    if (!boss.state.active && quest.state.stage !== 'intro') {
      const toTree = Math.hypot(player.position.x - 48, player.position.z - 13);
      if (toTree < 26) boss.activate();
    }
    boss.update(dt, clock.time, player.position, Boolean(dialogue));
    if (boss.state.lastEvent === 'treeFell') {
      boss.state.lastEvent = null;
      quest.onTreeFell();
      treeRespawnTimer = 3.4;
    }
    ui.setBossBars(boss.state.active && boss.state.phase !== 'fleeing'
      ? { hp: boss.getHp(), maxHp: 100, treeHp: boss.getTreeHp(), treeMaxHp: 100 }
      : null);
    if (boss.state.hp <= 0 && boss.state.phase === 'defeated' && !bossDefeatHandled) {
      bossDefeatHandled = true;
      quest.onBossDefeated();
    }
  }
  if (treeRespawnTimer > 0) {
    treeRespawnTimer -= dt;
    if (treeRespawnTimer <= 0) {
      boss.reset();
      boss.activate();
      ui.toast('光头强又拖来一棵树继续砍,再揍他一顿!', 3000);
    }
  }

  for (const cone of world.pinecones) {
    if (cone.userData.collected) continue;
    const d = Math.hypot(cone.position.x - player.position.x, cone.position.z - player.position.z);
    if (d < 2.3) collectPinecone(cone);
  }

  const near = nearestOf(talkables, player.position);
  // only offer a chat when the neighbour is actually in front of the player
  let target = near;
  if (near) {
    const dx = near.sprite.position.x - player.position.x;
    const dz = near.sprite.position.z - player.position.z;
    const distance = Math.hypot(dx, dz) || 1;
    const facing = (dx / distance) * Math.sin(player.state.yaw) + (dz / distance) * Math.cos(player.state.yaw);
    if (facing < 0.15) target = null;
  }
  if (dialogue) {
    if (input.interact) advanceDialogue();
    input.interact = false;
  } else {
    ui.setPrompt(target ? target.name : null);
    if (input.interact) {
      input.interact = false;
      if (target) startDialogue(target);
    }
  }

  ui.setCompass(player.state.yaw, player.position.x, player.position.z);
  updateTracker();
  // building this object allocates several arrays; the minimap only repaints a
  // few times a second, so skip the work in between
  minimapTimer -= dt;
  if (minimapTimer <= 0) {
    minimapTimer = 0.12;
    ui.drawMinimap({
      paths: world.pathSamples,
      landmarks: LANDMARKS,
      river: RIVER,
      objective: quest.objective,
      pinecones: world.pinecones.map((c) => ({ x: c.position.x, z: c.position.z, collected: c.userData.collected })),
      neighbours: talkables
        .filter((n) => n.sprite.visible)
        .map((n) => ({ x: n.sprite.position.x, z: n.sprite.position.z, talked: n.talked })),
      player: { x: player.position.x, z: player.position.z, yaw: player.state.yaw },
    });
  }
}

/** Rotate the little arrow so it always points at the current objective. */
function updateTracker() {
  if (!quest || mode !== 'playing') {
    ui.setTracker(null);
    return;
  }
  const dx = quest.objective.x - player.position.x;
  const dz = quest.objective.z - player.position.z;
  const distance = Math.hypot(dx, dz);
  if (!quest.objective.show || distance < 2.2) {
    ui.setTracker(null);
    return;
  }
  // bearing of the target relative to the way the player is facing, in screen degrees
  const targetAngle = Math.atan2(dx, dz);
  let relative = targetAngle - player.state.yaw;
  relative = Math.atan2(Math.sin(relative), Math.cos(relative));
  ui.setTracker({
    label: quest.objective.label,
    distance,
    degrees: (relative * 180) / Math.PI,
  });
}

let lastFrame = performance.now();
let fps = 60;
// rolling frame time in ms, used by the resolution controller
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

/** Size of the drawing buffer, including the multisample buffers when MSAA is on. */
function canvasMemory() {
  const gl = renderer.getContext();
  const pixels = renderer.domElement.width * renderer.domElement.height;
  const samples = ANTIALIAS ? (gl.getParameter(gl.SAMPLES) || 4) : 1;
  // colour + depth, multiplied by the sample count for the MSAA targets
  return (pixels * 4 * (1 + samples)) / 1048576;
}

window.render_game_to_text = () => {
  if (!player) return JSON.stringify({ mode });
  const near = neighbours ? neighbours.nearest(player.position) : null;
  const nearby = neighbours
    ? neighbours.list
      .map((n) => ({
        name: n.name,
        dx: +(n.sprite.position.x - player.position.x).toFixed(1),
        dz: +(n.sprite.position.z - player.position.z).toFixed(1),
        dist: +Math.hypot(n.sprite.position.x - player.position.x, n.sprite.position.z - player.position.z).toFixed(1),
        talked: n.talked,
      }))
      .filter((n) => n.dist < 22)
      .sort((a, b) => a.dist - b.dist)
    : [];
  return JSON.stringify({
    mode,
    paused,
    questStage: quest ? quest.state.stage : null,
    questTitle: document.getElementById('q-title').textContent,
    questHint: document.getElementById('q-hint').textContent,
    objective: quest ? {
      label: quest.objective.label,
      x: +quest.objective.x.toFixed(1),
      z: +quest.objective.z.toFixed(1),
      distance: +Math.hypot(quest.objective.x - player.position.x, quest.objective.z - player.position.z).toFixed(1),
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
    attacking: player.state.attacking,
    stun: +player.state.stun.toFixed(2),
    inWater: player.state.wasInRiver,
    onBridge: isOnBridge(player.position.x, player.position.z),
    treeFallen: quest ? quest.state.treeFallen : false,
    player: {
      x: +player.position.x.toFixed(2),
      z: +player.position.z.toFixed(2),
      y: +player.position.y.toFixed(2),
      yawDeg: +(((player.state.yaw * 180) / Math.PI) % 360).toFixed(1),
      speed: +player.state.speed.toFixed(2),
      onGround: player.state.onGround,
    },
    quest: {
      found: collected,
      total: TOTAL_CONES,
      hint: document.getElementById('q-hint').textContent,
      neighboursTalked: talked.size,
    },
    pinecones: world
      ? world.pinecones.map((c, i) => ({
        i,
        x: +c.position.x.toFixed(1),
        z: +c.position.z.toFixed(1),
        collected: c.userData.collected,
      }))
      : [],
    dialogue: dialogue
      ? { speaker: dialogue.npc.name, line: dialogue.index, text: document.getElementById('d-text').textContent }
      : null,
    prompt: document.getElementById('prompt').classList.contains('on')
      ? document.getElementById('prompt-name').textContent
      : null,
    nearest: near ? { name: near.name, dist: +Math.hypot(near.sprite.position.x - player.position.x, near.sprite.position.z - player.position.z).toFixed(2) } : null,
    nearbyNeighbours: nearby,
    landmarks: LANDMARKS,
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
    hint: 'WASD 走路 / 方向键转身 / Shift 奔跑 / Space 跳 / E 和邻居说话',
  });
};

// ------------------------------------------------------------------ boot
function enterGame() {
  ui.hideStart();
  ui.setHud(true);
  mode = 'playing';
  audio.start();
  if (!isTouch) requestLock();
  quest.applyStage(quest.state.stage);
  ui.toast('走进营地找 <b>熊大</b> 接任务吧', 3200);
  canvas.focus();
}

document.getElementById('btn-start').addEventListener('click', enterGame);
document.getElementById('btn-resume').addEventListener('click', () => togglePause(false));
document.getElementById('btn-again').addEventListener('click', () => location.reload());
document.getElementById('dialogue').addEventListener('click', () => {
  if (dialogue) advanceDialogue();
});

loadTextures((done, total, file) => {
  ui.setLoading(done / total, '加载 ' + file + ' (' + done + '/' + total + ')');
}).then((textures) => {
  ui.setLoading(1, '搭 建 狗 熊 岭 …');
  world = buildWorld(scene, textures);
  neighbours = buildNeighbours(scene, textures);
  player = createPlayer(camera, scene, textures, world.colliders, groundHeightAt);
  boss = createBossFight(scene, textures, world, audio, player, ui);
  talkables = [...neighbours.list, boss.character];
  quest = createQuest({
    scene, ui, audio, player, world,
    xiongdaPos: { x: neighbours.list[0].x, z: neighbours.list[0].z },
  });
  quest.applyStage('intro');
  const pose = params.get('pose');
  if (pose) {
    const [px, pz, pyaw] = pose.split(',').map(Number);
    if (Number.isFinite(px)) player.position.x = px;
    if (Number.isFinite(pz)) player.position.z = pz;
    if (Number.isFinite(pyaw)) player.state.yaw = (pyaw * Math.PI) / 180;
    previousX = player.position.x;
    previousZ = player.position.z;
  }
  // dev-only shortcut so the automated test client can reach the end game quickly
  if (params.get('dev') === '1') {
    const preset = Number(params.get('cones') || 0);
    if (preset > 0) {
      world.pinecones.slice(0, Math.min(preset, TOTAL_CONES)).forEach((cone) => {
        cone.userData.collected = true;
        cone.visible = false;
        collected += 1;
      });
    }
    const stage = params.get('stage');
    if (stage && ['intro', 'bridge', 'fight', 'report', 'cones'].includes(stage)) {
      quest.applyStage(stage);
      if (stage === 'fight' || stage === 'report' || stage === 'cones') boss.activate();
    }
  }
  setupTouch();
  onResize();
  ui.setQuest(0, TOTAL_CONES);
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
