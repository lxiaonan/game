import * as THREE from '../vendor/three.module.js';
import { makeGlow } from './assets.js';
import { groundHeightAt, REGION_BY_ID, terrainHeight } from './terrain.js';

/**
 * Everything in the valley the player can walk up to and do something with:
 * glowing pickups, the level stones, the crystals on the night plateau and the
 * beehives in the swamp. Keeping them in one place means the minimap, the
 * highlight ring and the interaction prompt all iterate the same list.
 */

export const PICKUP_KINDS = {
  cone: { tex: 'pinecone', height: 1.45, label: '金松果', color: 0xffd98a },
  honey: { tex: 'honey', height: 1.25, label: '蜂蜜罐', color: 0xffc35e },
  shroom: { tex: 'shroom', height: 1.05, label: '发光蘑菇', color: 0xffb98a },
};

export const PICKUP_SPOTS = {
  cone: [
    { x: -34, z: 30 }, { x: 48, z: -26 }, { x: -46, z: -50 }, { x: 22, z: 52 },
    { x: 66, z: 6 }, { x: -18, z: -78 }, { x: 12, z: -108 },
  ],
  honey: [
    { x: -104, z: 74 }, { x: -122, z: 86 }, { x: -88, z: 96 }, { x: -116, z: 58 },
    { x: -94, z: 112 }, { x: -134, z: 66 }, { x: 58, z: 26 }, { x: 44, z: -56 },
  ],
  shroom: [
    { x: 54, z: -60 }, { x: 40, z: -68 }, { x: 66, z: -50 }, { x: 60, z: -74 },
    { x: -30, z: -104 }, { x: -14, z: -96 }, { x: -44, z: -112 }, { x: -22, z: -122 },
  ],
};

/** The five level stones, one per region, standing just off the trail. */
export const TOTEM_SPOTS = [
  { id: 'lv1', x: 40, z: 30, region: 'lumberyard', title: '第一关 · 抢树之战' },
  { id: 'lv2', x: 8, z: 40, region: 'camp', title: '第二关 · 金松果大搜索' },
  { id: 'lv3', x: -84, z: 54, region: 'swamp', title: '第三关 · 迷雾沼泽' },
  { id: 'lv4', x: 96, z: -68, region: 'highland', title: '第四关 · 夜色高地' },
  { id: 'lv5', x: -44, z: -28, region: 'stones', title: '第五关 · 巨石阵试炼' },
];

export const CRYSTAL_SPOTS = [
  { x: 78, z: -84 }, { x: 122, z: -92 }, { x: 112, z: -128 }, { x: 82, z: -122 },
];

export const BEEHIVE_SPOTS = [
  { x: -112, z: 92 }, { x: -96, z: 64 }, { x: -84, z: 88 }, { x: -126, z: 74 },
];

/** The arena the fifth level is fought in. */
export const ARENA = { x: -58, z: -34, r: 17 };

function makeRingTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0, 'rgba(255,220,140,0)');
  grad.addColorStop(0.72, 'rgba(255,220,140,0.85)');
  grad.addColorStop(0.86, 'rgba(255,240,190,0.95)');
  grad.addColorStop(1, 'rgba(255,220,140,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createProps(scene, tex, world) {
  const glow = makeGlow();
  const ringTex = makeRingTexture();
  const colliders = [];

  // ---------------- pickups ----------------
  const items = [];
  for (const [kind, spots] of Object.entries(PICKUP_SPOTS)) {
    const info = PICKUP_KINDS[kind];
    const texture = tex[info.tex] || tex.pinecone;
    spots.forEach((spot, index) => {
      const group = new THREE.Group();
      const body = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture, transparent: false, alphaTest: 0.2, fog: true, depthWrite: true,
      }));
      const aspect = (texture.image.width || 1) / (texture.image.height || 1);
      body.scale.set(info.height * aspect, info.height, 1);
      body.center.set(0.5, 0.5);
      group.add(body);

      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glow, color: info.color, transparent: true, opacity: 0.8, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: true,
      }));
      halo.scale.set(2.8, 2.8, 1);
      group.add(halo);

      const baseY = groundHeightAt(spot.x, spot.z) + 1.25;
      group.position.set(spot.x, baseY, spot.z);
      group.userData = { kind, index, label: info.label, baseY, seed: index * 1.7 + kind.length, collected: false };
      scene.add(group);
      items.push(group);
    });
  }

  // ---------------- beehives ----------------
  const hives = [];
  for (const spot of BEEHIVE_SPOTS) {
    const hive = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex.beehive, transparent: false, alphaTest: 0.3, fog: true, depthWrite: true,
    }));
    const aspect = (tex.beehive.image.width || 1) / (tex.beehive.image.height || 1);
    const height = 2.6;
    hive.scale.set(height * aspect, height, 1);
    hive.center.set(0.5, 0.5);
    hive.position.set(spot.x, groundHeightAt(spot.x, spot.z) + 3.1, spot.z);
    hive.userData = { seed: Math.random() * 6, x: spot.x, z: spot.z, buzz: 0 };
    scene.add(hive);
    hives.push(hive);
  }

  // ---------------- level stones ----------------
  const totems = [];
  for (const spot of TOTEM_SPOTS) {
    const group = new THREE.Group();
    const stone = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex.totem, transparent: false, alphaTest: 0.35, fog: true, depthWrite: true,
    }));
    const aspect = (tex.totem.image.width || 1) / (tex.totem.image.height || 1);
    const height = 3.4;
    stone.scale.set(height * aspect, height, 1);
    stone.center.set(0.5, 0);
    group.add(stone);

    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffd479, transparent: true, opacity: 0.16, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 16, 12, 1, true), beamMat);
    beam.position.y = 8;
    group.add(beam);

    const node = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: 0xffe3a8, transparent: true, opacity: 0.7, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    }));
    node.scale.set(2.6, 2.6, 1);
    node.position.y = 3.2;
    group.add(node);

    const y = groundHeightAt(spot.x, spot.z);
    group.position.set(spot.x, y, spot.z);
    group.userData = { ...spot, beamMat, node, cleared: false, baseY: y };
    scene.add(group);
    totems.push(group);
    colliders.push({ x: spot.x, z: spot.z, r: 1.1 });
  }

  // ---------------- crystals to light on the night plateau ----------------
  const crystals = [];
  CRYSTAL_SPOTS.forEach((spot, index) => {
    const group = new THREE.Group();
    const body = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex.crystal, transparent: false, alphaTest: 0.3, fog: true, depthWrite: true,
      color: 0x8fa4b8,
    }));
    const aspect = (tex.crystal.image.width || 1) / (tex.crystal.image.height || 1);
    const height = 3.0;
    body.scale.set(height * aspect, height, 1);
    body.center.set(0.5, 0);
    group.add(body);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: 0x8fd8ff, transparent: true, opacity: 0.0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    }));
    halo.scale.set(5, 5, 1);
    halo.position.y = 1.6;
    group.add(halo);

    const y = terrainHeight(spot.x, spot.z);
    group.position.set(spot.x, y, spot.z);
    group.userData = { index, lit: false, body, halo, baseY: y };
    scene.add(group);
    crystals.push(group);
    colliders.push({ x: spot.x, z: spot.z, r: 1.0 });
  });

  // ---------------- the arena ring on the stone circle ----------------
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(ARENA.r - 0.9, ARENA.r, 72),
    new THREE.MeshBasicMaterial({
      map: ringTex, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(ARENA.x, terrainHeight(ARENA.x, ARENA.z) + 0.12, ARENA.z);
  scene.add(ring);

  const update = (dt, time, playerPos) => {
    for (const item of items) {
      if (item.userData.collected) continue;
      const data = item.userData;
      item.position.y = data.baseY + Math.sin(time * 1.8 + data.seed) * 0.16;
      item.rotation.y = time * 0.8 + data.seed;
      const toPlayer = Math.hypot(item.position.x - playerPos.x, item.position.z - playerPos.z);
      item.visible = toPlayer < 120;
    }
    for (const hive of hives) {
      const toPlayer = Math.hypot(hive.position.x - playerPos.x, hive.position.z - playerPos.z);
      // swarms buzz harder the closer the bear gets
      hive.userData.buzz = Math.max(0, 1 - toPlayer / 16);
      hive.material.rotation = Math.sin(time * 1.4 + hive.userData.seed) * 0.02 * hive.userData.buzz;
      const wobble = 1 + Math.sin(time * 3.2 + hive.userData.seed) * 0.02 * hive.userData.buzz;
      const aspect = (tex.beehive.image.width || 1) / (tex.beehive.image.height || 1);
      hive.scale.set(2.6 * aspect * wobble, 2.6 * wobble, 1);
    }
    for (const totem of totems) {
      const pulse = 1 + Math.sin(time * 1.7 + totem.position.x * 0.1) * 0.12;
      totem.userData.beamMat.opacity = totem.userData.cleared
        ? 0.05
        : 0.13 + Math.sin(time * 1.7) * 0.05;
      totem.userData.node.material.opacity = (totem.userData.cleared ? 0.25 : 0.6)
        + Math.sin(time * 2.6) * 0.16;
      totem.userData.node.scale.setScalar(2.6 * pulse);
    }
    for (const crystal of crystals) {
      const data = crystal.userData;
      const target = data.lit ? 0.95 : 0.0;
      data.halo.material.opacity += (target - data.halo.material.opacity) * Math.min(1, dt * 4);
      const scale = data.lit ? 6 + Math.sin(time * 2.2 + data.index) * 0.7 : 5;
      data.halo.scale.set(scale, scale, 1);
      data.body.material.color.setRGB(
        0.56 + (data.lit ? 0.42 : 0),
        0.64 + (data.lit ? 0.34 : 0),
        0.72 + (data.lit ? 0.2 : 0),
      );
    }
    const inArena = Math.hypot(playerPos.x - ARENA.x, playerPos.z - ARENA.z) < ARENA.r + 8;
    ring.material.opacity += ((inArena ? 0.75 : 0) - ring.material.opacity) * Math.min(1, dt * 3);
    ring.rotation.z = time * 0.15;
  };

  return {
    items,
    hives,
    totems,
    crystals,
    ring,
    colliders,
    update,
    countRemaining: (kind) => items.filter((i) => i.userData.kind === kind && !i.userData.collected).length,
  };
}
