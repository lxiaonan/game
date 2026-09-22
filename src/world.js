import * as THREE from '../vendor/three.module.js';
import { makeBlobShadow, makeGlow, makePollen } from './assets.js';
import { createBillboardField } from './billboards.js';
import { createPollenField } from './pollen.js';

export const WORLD = {
  size: 400,
  playRadius: 128,
  clearingRadius: 26,
  villageCenter: new THREE.Vector2(0, 0),
  sunDir: new THREE.Vector3(-0.45, 0.72, -0.52).normalize(),
  fogColor: 0xb7cdbd,
};

/** The river gorge that splits the valley: the camp is west, the lumber yard east. */
export const RIVER = {
  x: 34,
  halfWidth: 6,
  floorY: -4.6,
  waterY: -3.3,
  bridgeZ: 18,
  bridgeHalfWalk: 1.15,
  bridgeFrom: 26.2,
  bridgeTo: 41.8,
  deckY: 0.14,
};

/** Tree the lumberjack is chopping: the target of the tutorial fight. */
export const DOOMED_TREE = { x: 48, z: 13, height: 16 };

export function isGorge(x, z) {
  return Math.abs(x - RIVER.x) < RIVER.halfWidth;
}

/** Height of the walkable ground at a point: 0 on land, deep down inside the gorge. */
export function isOnBridge(x, z) {
  return x > RIVER.bridgeFrom - 0.35 && x < RIVER.bridgeTo + 0.35
    && Math.abs(z - RIVER.bridgeZ) < RIVER.bridgeHalfWalk;
}

/** Height of the walkable ground at a point: deck on the log, 0 on land, the gorge floor in the water. */
export function groundHeightAt(x, z) {
  if (isOnBridge(x, z)) return RIVER.deckY;
  if (!isGorge(x, z)) return 0;
  return RIVER.floorY;
}

const PATHS = [
  [[6, 66], [3, 40], [0, 18], [-2, -6], [3, -28], [0, -56]],
  [[0, 6], [12, 9], [20, 14], [26.2, 18]],
  [[41.8, 18], [48, 15.5], [54, 16], [64, 20]],
  [[-2, -8], [-20, -16], [-40, -25], [-58, -34]],
];

export const LANDMARKS = [
  { x: 0, z: 0, label: '森林营地' },
  { x: -16, z: 5, label: '木屋' },
  { x: 0, z: -58, label: '千年大树' },
  { x: 64, z: 20, label: '伐木场' },
  { x: -58, z: -34, label: '巨石阵' },
  { x: 34, z: 18, label: '独木桥' },
  { x: 48, z: 13, label: '光头强砍树处' },
];

export const PINECONE_SPOTS = [
  { x: -34, z: 30 },
  { x: 48, z: -26 },
  { x: -46, z: -50 },
  { x: 22, z: 52 },
  { x: 66, z: 6 },
  { x: -18, z: -70 },
  { x: 12, z: -96 },
];

/**
 * Scale a geometry's UVs, so one uploaded texture can serve several tiling rates.
 *
 * three.js keeps repeat/offset on the Texture, so the old code cloned a texture
 * whenever it needed a different repeat — and a clone is a second full GPU upload
 * of the same image. The five 1024x1024 surface textures were being uploaded 13
 * times between them, ~43MB of duplicated VRAM. Baking the factor into the UVs is
 * arithmetically identical (`uv * repeat + offset` either way) and uploads once.
 */
function tileUVs(geometry, u, v) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  uv.needsUpdate = true;
  return geometry;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distanceToPaths(x, z, samples) {
  let best = Infinity;
  for (const list of samples) {
    for (const p of list) {
      const d = Math.hypot(p[0] - x, p[1] - z);
      if (d < best) best = d;
    }
  }
  return best;
}

function ribbonGeometry(curve, width, segments) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  let travelled = 0;
  let previous = null;

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    curve.getPointAt(t, point);
    curve.getTangentAt(t, tangent);
    if (previous) travelled += point.distanceTo(previous);
    previous = previous ? previous.copy(point) : point.clone();

    const nx = -tangent.z;
    const nz = tangent.x;
    const len = Math.hypot(nx, nz) || 1;
    const half = width / 2;
    const wobble = Math.sin(t * 26) * 0.35 + Math.sin(t * 9.3) * 0.6;
    const w = half + wobble;
    positions.push(point.x + (nx / len) * w, point.y, point.z + (nz / len) * w);
    positions.push(point.x - (nx / len) * w, point.y, point.z - (nz / len) * w);
    const v = travelled / 4.5;
    uvs.push(0, v, 1, v);
    if (i > 0) {
      const a = (i - 1) * 2;
      // wound so the ribbon faces up; the other order gets back-face culled
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function buildWorld(scene, tex) {
  const rand = mulberry32(20260921);
  const colliders = [];
  // only the couple of one off props that are animated or hidden keep a CPU sway
  const swayers = [];
  const blobShadow = makeBlobShadow();
  const glow = makeGlow();
  const billboards = createBillboardField();
  // ---------------- sky, sun and light ----------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(360, 48, 32),
    new THREE.MeshBasicMaterial({ map: tex.sky, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: 0xfff3cf, transparent: true, opacity: 0.95, depthWrite: false, fog: false,
  }));
  sun.scale.set(120, 120, 1);
  sun.position.copy(WORLD.sunDir).multiplyScalar(300);
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4b6135, 0.95);
  scene.add(hemi);
  const directional = new THREE.DirectionalLight(0xfff0cf, 1.75);
  directional.position.copy(WORLD.sunDir).multiplyScalar(90);
  scene.add(directional);
  scene.fog = new THREE.Fog(WORLD.fogColor, 42, 168);

  // ---------------- ground ----------------
  const GRASS_TILES = 124;
  const grassMap = tex.grass;
  grassMap.wrapS = grassMap.wrapT = THREE.RepeatWrapping;
  grassMap.anisotropy = 4;
  // Phong rather than Standard: these are unlit-looking surfaces in direct sun, so
  // the PBR BRDF and image based lighting buy nothing but cost fragment work on
  // the largest thing on screen. Per pixel lighting is kept for the campfire glow.
  const grassMaterial = new THREE.MeshPhongMaterial({
    map: grassMap, vertexColors: true, specular: 0x000000, shininess: 0,
  });

  /** A grass slab with soft per vertex colour patches, used for both river banks. */
  const grassSlab = (x0, x1, z0, z1) => {
    const width = x1 - x0;
    const depth = z1 - z0;
    const cols = Math.max(2, Math.round(width / 6));
    const rows = Math.max(2, Math.round(depth / 6));
    const geo = new THREE.PlaneGeometry(width, depth, cols, rows);
    const colors = [];
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const gx = pos.getX(i) + (x0 + x1) / 2;
      const gz = -pos.getY(i) + (z0 + z1) / 2;
      const patch = Math.sin(gx * 0.031) * Math.cos(gz * 0.027) + Math.sin((gx + gz) * 0.013) * 0.7
        + Math.sin(gx * 0.101 + 1.7) * Math.sin(gz * 0.087) * 0.45;
      const t = Math.max(0, Math.min(1, 0.5 + patch * 0.34));
      colors.push(0.62 + t * 0.22, 0.80 + t * 0.16, 0.48 + t * 0.20);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    // the UVs follow world space so the two slabs line up seamlessly
    const uvs = geo.attributes.uv;
    for (let i = 0; i < pos.count; i += 1) {
      uvs.setXY(
        i,
        ((pos.getX(i) + (x0 + x1) / 2) / WORLD.size) * GRASS_TILES,
        ((-pos.getY(i) + (z0 + z1) / 2) / WORLD.size) * GRASS_TILES,
      );
    }
    const mesh = new THREE.Mesh(geo, grassMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    scene.add(mesh);
    return mesh;
  };

  const half = WORLD.size / 2;
  const bankWest = RIVER.x - RIVER.halfWidth;
  const bankEast = RIVER.x + RIVER.halfWidth;
  grassSlab(-half, bankWest, -half, half);
  grassSlab(bankEast, half, -half, half);

  // ---------------- river gorge: banks, riverbed, water ----------------
  const cliffMap = tex.cliff;
  cliffMap.wrapS = cliffMap.wrapT = THREE.RepeatWrapping;
  // front side only: each bank wall faces the river, so it is culled from the land side
  const cliffMat = new THREE.MeshPhongMaterial({
    map: cliffMap, side: THREE.FrontSide, specular: 0x000000, shininess: 0,
  });

  // leave a notch where the log bridge crosses, otherwise the walls slice through it
  const wallStrip = (x, faceEast, z0, z1) => {
    const segments = Math.max(2, Math.round((z1 - z0) / 3));
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= segments; i += 1) {
      const z = z0 + ((z1 - z0) * i) / segments;
      positions.push(x, 0.02, z, x, RIVER.floorY, z);
      const u = (-RIVER.floorY) / 5.2;
      const v = (z + half) / 7;
      uvs.push(0, v, u, v);
      if (i > 0) {
        const a = (i - 1) * 2;
        if (faceEast) indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        else indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, cliffMat));
  };
  const bridgeGap = RIVER.bridgeHalfWalk + 0.85;
  for (const [z0, z1] of [[-half, RIVER.bridgeZ - bridgeGap], [RIVER.bridgeZ + bridgeGap, half]]) {
    wallStrip(bankWest, true, z0, z1);
    wallStrip(bankEast, false, z0, z1);
  }

  const bedMap = tex.dirt;
  bedMap.wrapS = bedMap.wrapT = THREE.RepeatWrapping;
  const riverbed = new THREE.Mesh(
    tileUVs(new THREE.PlaneGeometry(RIVER.halfWidth * 2, WORLD.size), 2, WORLD.size / 6),
    new THREE.MeshPhongMaterial({ map: bedMap, color: 0x6b6255, specular: 0x000000, shininess: 0 }),
  );
  riverbed.rotation.x = -Math.PI / 2;
  riverbed.position.set(RIVER.x, RIVER.floorY, 0);
  scene.add(riverbed);

  const waterMap = tex.water;
  waterMap.wrapS = waterMap.wrapT = THREE.RepeatWrapping;
  const waterMat = new THREE.MeshPhongMaterial({
    map: waterMap,
    color: 0x74c2dc,
    emissive: 0x123240,
    emissiveIntensity: 0.55,
    specular: 0x9fc4d8,
    shininess: 55,
    transparent: true,
    opacity: 0.86,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const water = new THREE.Mesh(
    tileUVs(new THREE.PlaneGeometry(RIVER.halfWidth * 2 - 0.1, WORLD.size), 3, 34),
    waterMat,
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(RIVER.x, RIVER.waterY, 0);
  scene.add(water);

  // ---------------- the log bridge ----------------
  // CylinderGeometry points along Y. One Z rotation lays it along X, across the gorge.
  // A second Y rotation would spin it parallel to the river, which is what made it look like a floating barrier.
  const BARK_TILES = { u: 6, v: 1.4 };
  const barkMap = tex.bark;
  barkMap.wrapS = barkMap.wrapT = THREE.RepeatWrapping;
  const barkMat = new THREE.MeshPhongMaterial({ map: barkMap, specular: 0x000000, shininess: 0 });
  const bridgeLength = RIVER.bridgeTo - RIVER.bridgeFrom;
  const bridgeMid = (RIVER.bridgeFrom + RIVER.bridgeTo) / 2;
  const logRadius = 0.78;
  const deckThickness = 0.16;
  const deckCenterY = RIVER.deckY - deckThickness / 2;
  const trunk = new THREE.Mesh(
    tileUVs(new THREE.CylinderGeometry(logRadius, logRadius * 0.92, bridgeLength, 18, 1, false), BARK_TILES.u, BARK_TILES.v),
    barkMat,
  );
  trunk.rotation.z = Math.PI / 2;
  trunk.position.set(bridgeMid, deckCenterY - deckThickness / 2 - logRadius + 0.12, RIVER.bridgeZ);
  scene.add(trunk);

  const deck = new THREE.Mesh(
    tileUVs(new THREE.BoxGeometry(bridgeLength + 0.4, deckThickness, RIVER.bridgeHalfWalk * 2), 8, 1),
    new THREE.MeshPhongMaterial({ map: barkMap, color: 0xc4a57a, specular: 0x000000, shininess: 0 }),
  );
  deck.position.set(bridgeMid, deckCenterY, RIVER.bridgeZ);
  scene.add(deck);

  // short posts mark the two ends so the narrow walkway reads from first person
  for (const x of [RIVER.bridgeFrom + 0.2, RIVER.bridgeTo - 0.2]) {
    for (const side of [-1, 1]) {
      const marker = new THREE.Mesh(
        tileUVs(new THREE.CylinderGeometry(0.07, 0.09, 1.05, 6), BARK_TILES.u, BARK_TILES.v),
        barkMat,
      );
      marker.position.set(x, RIVER.deckY + 0.48, RIVER.bridgeZ + side * (RIVER.bridgeHalfWalk - 0.08));
      scene.add(marker);
    }
  }

  // cut branch stubs sticking out of the sides of the log
  for (let i = 0; i < 6; i += 1) {
    const t = (i + 0.5) / 6;
    const x = RIVER.bridgeFrom + t * bridgeLength;
    const side = i % 2 ? 1 : -1;
    const stub = new THREE.Mesh(
      tileUVs(new THREE.CylinderGeometry(0.07, 0.11, 0.55, 6), BARK_TILES.u, BARK_TILES.v),
      barkMat,
    );
    stub.rotation.x = side * 1.15;
    stub.position.set(x, trunk.position.y - 0.05, RIVER.bridgeZ + side * (logRadius + 0.12));
    scene.add(stub);
  }

  // two posts from the riverbed up to the log, leaning out so they don't block the walkway
  const postTop = trunk.position.y - logRadius * 0.35;
  const postHeight = postTop - RIVER.floorY;
  for (const zOffset of [-1.15, 1.15]) {
    const post = new THREE.Mesh(
      tileUVs(new THREE.CylinderGeometry(0.16, 0.22, postHeight, 8), BARK_TILES.u, BARK_TILES.v),
      barkMat,
    );
    post.position.set(bridgeMid, RIVER.floorY + postHeight / 2, RIVER.bridgeZ + zOffset);
    post.rotation.x = zOffset > 0 ? 0.12 : -0.12;
    scene.add(post);
  }

  // every blob shadow is written into one merged mesh so the forest stays cheap to draw
  const shadowQuads = [];
  const addShadowQuad = (x, z, size) => {
    const half = size / 2;
    const y = 0.035;
    shadowQuads.push(
      x - half, y, z - half, 0, 0,
      x + half, y, z - half, 1, 0,
      x + half, y, z + half, 1, 1,
      x - half, y, z + half, 0, 1,
    );
  };

  // ---------------- trails ----------------
  const pathSamples = [];
  const dirtMap = tex.dirt;
  dirtMap.wrapS = dirtMap.wrapT = THREE.RepeatWrapping;
  dirtMap.anisotropy = 4;
  const dirtMat = new THREE.MeshStandardMaterial({
    map: dirtMap, roughness: 1, metalness: 0, transparent: true, opacity: 0.97,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false,
    side: THREE.DoubleSide,
  });
  // a wider, fainter ribbon underneath softens the edge where the trail meets the grass
  const dirtEdgeMat = dirtMat.clone();
  dirtEdgeMat.opacity = 0.42;
  const sampled = [];
  for (const raw of PATHS) {
    const points = raw.map(([x, z]) => new THREE.Vector3(x, 0.02, z));
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
    const segments = Math.max(48, Math.round(curve.getLength() / 1.5));
    const edge = new THREE.Mesh(ribbonGeometry(curve, 5.4, segments), dirtEdgeMat);
    edge.position.y = -0.006;
    scene.add(edge);
    scene.add(new THREE.Mesh(ribbonGeometry(curve, 3.4, segments), dirtMat));
    const local = [];
    for (let i = 0; i <= segments; i += 1) {
      const p = curve.getPointAt(i / segments);
      local.push([p.x, p.z]);
    }
    pathSamples.push(local);
    sampled.push(local);
  }

  // ---------------- helpers ----------------
  const materialCache = new Map();
  const spriteMaterial = (texture, alphaTest, color) => {
    const key = texture.uuid + '|' + alphaTest + '|' + color;
    if (!materialCache.has(key)) {
      materialCache.set(key, new THREE.SpriteMaterial({
        map: texture,
        transparent: false,
        alphaTest,
        color,
        fog: true,
        depthWrite: true,
      }));
    }
    return materialCache.get(key);
  };

  const placeSprite = (texture, x, z, height, opts = {}) => {
    const image = texture.image || { width: 1, height: 1 };
    const aspect = (image.width || 1) / (image.height || 1);
    const sprite = new THREE.Sprite(spriteMaterial(
      texture,
      opts.alphaTest === undefined ? 0.42 : opts.alphaTest,
      opts.color || 0xffffff,
    ));
    const sign = opts.mirror ? -1 : 1;
    sprite.scale.set(height * aspect * sign, height, 1);
    sprite.position.set(x, opts.y === undefined ? 0 : opts.y, z);
    sprite.center.set(0.5, 0);
    scene.add(sprite);
    if (opts.shadow !== false) {
      addShadowQuad(x, z + 0.1, height * (opts.shadowScale || 0.75));
    }
    sprite.userData.baseX = height * aspect * sign;
    sprite.userData.baseY = height;
    return sprite;
  };

  /**
   * Queue a batched billboard. Same silhouette, anchor and ground shadow as
   * placeSprite, but it lands in one InstancedMesh per texture instead of being
   * its own draw call. `phase`/`amp` drive the sway in the vertex shader; leaving
   * them out keeps the quad perfectly still (and consumes no RNG, so the seeded
   * layout stays identical to the sprite version).
   */
  const addBillboard = (texture, x, z, height, opts = {}) => {
    billboards.add(texture, {
      x,
      y: opts.y === undefined ? 0 : opts.y,
      z,
      height,
      width: opts.width,
      mirror: opts.mirror,
      phase: opts.phase,
      amp: opts.amp,
      alphaTest: opts.alphaTest,
    });
    if (opts.shadow !== false) {
      addShadowQuad(x, z + 0.1, height * (opts.shadowScale || 0.75));
    }
  };

  const treeTypes = [
    { tex: tex.treePine, height: [12, 18], weight: 0.34 },
    { tex: tex.treeOak, height: [10, 15], weight: 0.36 },
    { tex: tex.treeBig, height: [15, 22], weight: 0.3 },
  ];

  const blocked = (x, z, radius) => {
    if (Math.abs(x - RIVER.x) < RIVER.halfWidth + 2.4) return true;
    for (const landmark of LANDMARKS) {
      if (Math.hypot(landmark.x - x, landmark.z - z) < 12) return true;
    }
    for (const spot of PINECONE_SPOTS) {
      if (Math.hypot(spot.x - x, spot.z - z) < 7) return true;
    }
    return distanceToPaths(x, z, sampled) < radius;
  };

  // ---------------- forest ----------------
  const treeCount = 520;
  let placed = 0;
  let guard = 0;
  while (placed < treeCount && guard < 12000) {
    guard += 1;
    const angle = rand() * Math.PI * 2;
    const radius = 15 + Math.pow(rand(), 0.58) * 84;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (Math.hypot(x, z) > WORLD.playRadius) continue;
    if (blocked(x, z, 4.4)) continue;
    if (Math.hypot(x, z) < 11) continue;
    const roll = rand();
    let type = treeTypes[0];
    let acc = 0;
    for (const candidate of treeTypes) {
      acc += candidate.weight;
      if (roll <= acc) { type = candidate; break; }
    }
    const height = type.height[0] + rand() * (type.height[1] - type.height[0]);
    addBillboard(type.tex, x, z, height, {
      shadowScale: 0.6,
      mirror: rand() < 0.5,
      phase: rand() * Math.PI * 2,
      amp: 0.008 + rand() * 0.012,
    });
    colliders.push({ x, z, r: 0.55 + height * 0.045 });
    placed += 1;
  }

  // shrubs sprinkled everywhere, including inside the clearing
  for (let i = 0; i < 300; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = 4 + Math.pow(rand(), 0.7) * 112;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (distanceToPaths(x, z, sampled) < 2.3) continue;
    if (Math.abs(x - RIVER.x) < RIVER.halfWidth + 1.6) continue;
    if (LANDMARKS.some((l) => Math.hypot(l.x - x, l.z - z) < 8)) continue;
    if (Math.hypot(x + 16, z - 5) < 9) continue;
    const height = 0.8 + rand() * 1.5;
    addBillboard(tex.bush, x, z, height, {
      shadowScale: 0.8,
      shadow: radius < 70,
      mirror: rand() < 0.5,
      phase: rand() * Math.PI * 2,
      amp: 0.02 + rand() * 0.02,
    });
  }

  // ---------------- landmarks ----------------
  // banks of the gorge: rocks and shrubs so the drop reads clearly
  for (let i = 0; i < 46; i += 1) {
    const z = -100 + rand() * 200;
    const side = rand() < 0.5 ? -1 : 1;
    if (Math.abs(z - RIVER.bridgeZ) < 4) continue;
    const x = RIVER.x + side * (RIVER.halfWidth + 0.6 + rand() * 2.6);
    const height = 0.5 + rand() * 0.7;
    addBillboard(rand() < 0.45 ? tex.rock : tex.bush, x, z, height, { shadow: false, mirror: rand() < 0.5 });
  }

  const giant = placeSprite(tex.treeBig, 0, -62, 40, { shadowScale: 0.55, alphaTest: 0.35 });
  colliders.push({ x: 0, z: -62, r: 4.2 });
  swayers.push({ sprite: giant, baseX: giant.userData.baseX, baseY: 40, phase: 1.1, amp: 0.004 });

  const hut = placeSprite(tex.hut, -16, 5, 6.4, { shadowScale: 0.95, alphaTest: 0.35 });
  hut.center.set(0.5, 0);
  colliders.push({ x: -16, z: 5, r: 5.6 });

  const rockSpots = [[-58, -34], [-53, -30], [-62, -29], [-57, -39], [-51, -37], [44, -30], [52, -34], [-28, 62]];
  for (const [x, z] of rockSpots) {
    const height = 1.5 + rand() * 1.5;
    addBillboard(tex.rock, x, z, height, { shadowScale: 1.1, mirror: rand() < 0.5 });
    colliders.push({ x, z, r: height * 0.55 });
  }

  const logSpots = [[58, 26, 3.3], [68, 33, 2.8], [54, 35, 2.5], [-40, -18, 3.0], [30, 48, 2.6]];
  for (const [x, z, height] of logSpots) {
    addBillboard(tex.log, x, z, height, { shadowScale: 1.0, y: 0, mirror: rand() < 0.5 });
    colliders.push({ x, z, r: height * 0.6 });
    if (x > 40 && z > 10) colliders.push({ x: x + 1.5, z: z - 1.5, r: 1.1 });
  }

  // campfire: stone ring, logs and a live flame
  const fire = new THREE.Group();
  fire.position.set(0, 0, 0);
  const flameMat = new THREE.MeshBasicMaterial({
    map: glow, color: 0xffa63c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const flame = new THREE.Sprite(flameMat);
  flame.scale.set(2.6, 3.4, 1);
  flame.center.set(0.5, 0);
  flame.position.set(0, 0.2, 0);
  fire.add(flame);
  const emberMat = new THREE.SpriteMaterial({
    map: glow, color: 0xffd27a, transparent: true, opacity: 0.75, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  });
  const embers = [];
  for (let i = 0; i < 10; i += 1) {
    const ember = new THREE.Sprite(emberMat);
    const scale = 0.18 + Math.random() * 0.2;
    ember.scale.set(scale, scale, 1);
    ember.userData.seed = Math.random() * 10;
    ember.userData.radius = 0.2 + Math.random() * 0.5;
    fire.add(ember);
    embers.push(ember);
  }
  const light = new THREE.PointLight(0xffa044, 12, 22, 2);
  light.position.set(0, 1.2, 0);
  fire.add(light);
  scene.add(fire);
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2;
    addBillboard(tex.rock, Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0.75, { shadow: false });
  }
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    addBillboard(tex.log, Math.cos(a) * 4.6, Math.sin(a) * 4.6, 1.15, { y: 0, shadow: false });
  }
  colliders.push({ x: 0, z: 0, r: 2.5 });

  // ---------------- the tree the lumberjack is felling ----------------
  const doomed = placeSprite(tex.treeChopped, DOOMED_TREE.x, DOOMED_TREE.z, DOOMED_TREE.height, {
    shadowScale: 0.62, alphaTest: 0.35,
  });
  const doomedSway = { sprite: doomed, baseX: doomed.userData.baseX, baseY: DOOMED_TREE.height, phase: 2.4, amp: 0.006 };
  swayers.push(doomedSway);
  colliders.push({ x: DOOMED_TREE.x, z: DOOMED_TREE.z, r: 1.15 });

  const stumpMap = tex.bark;
  const felledTrunk = new THREE.Group();
  const lying = new THREE.Mesh(
    tileUVs(new THREE.CylinderGeometry(0.85, 0.72, DOOMED_TREE.height * 0.95, 14), 4, 1),
    new THREE.MeshPhongMaterial({ map: stumpMap, specular: 0x000000, shininess: 0 }),
  );
  lying.rotation.z = Math.PI / 2;
  lying.position.set(DOOMED_TREE.x + 7.2, 0.78, DOOMED_TREE.z + 1.4);
  felledTrunk.add(lying);
  felledTrunk.visible = false;
  scene.add(felledTrunk);
  const stumpSprite = placeSprite(tex.stump, DOOMED_TREE.x, DOOMED_TREE.z, 1.35, { shadow: false, alphaTest: 0.35 });
  stumpSprite.visible = false;

  // ---------------- merged blob shadows ----------------
  const shadowGeo = new THREE.BufferGeometry();
  const vertexCount = shadowQuads.length / 5;
  const shadowPositions = new Float32Array(vertexCount * 3);
  const shadowUvs = new Float32Array(vertexCount * 2);
  for (let v = 0; v < vertexCount; v += 1) {
    shadowPositions[v * 3] = shadowQuads[v * 5];
    shadowPositions[v * 3 + 1] = shadowQuads[v * 5 + 1];
    shadowPositions[v * 3 + 2] = shadowQuads[v * 5 + 2];
    shadowUvs[v * 2] = shadowQuads[v * 5 + 3];
    shadowUvs[v * 2 + 1] = shadowQuads[v * 5 + 4];
  }
  const shadowIndex = [];
  for (let q = 0; q < vertexCount / 4; q += 1) {
    const base = q * 4;
    shadowIndex.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  shadowGeo.setAttribute('position', new THREE.BufferAttribute(shadowPositions, 3));
  shadowGeo.setAttribute('uv', new THREE.BufferAttribute(shadowUvs, 2));
  shadowGeo.setIndex(shadowIndex);
  const shadowMesh = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({
    map: blobShadow, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
  }));
  shadowMesh.renderOrder = 1;
  scene.add(shadowMesh);

  // ---------------- drifting pollen ----------------
  const POLLEN_BOX = 90;
  const pollen = createPollenField(420, POLLEN_BOX, makePollen());
  scene.add(pollen.points);

  // ---------------- pickups ----------------
  const pinecones = PINECONE_SPOTS.map((spot, index) => {
    const group = new THREE.Group();
    const item = placeSprite(tex.pinecone, 0, 0, 1.5, { shadow: false, y: 0 });
    item.center.set(0.5, 0.5);
    item.position.set(0, 0, 0);
    group.add(item);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: 0xffd98a, transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: true,
    }));
    halo.scale.set(3.4, 3.4, 1);
    group.add(halo);
    group.position.set(spot.x, 1.35, spot.z);
    group.userData = { index, baseY: 1.35, seed: index * 1.7, collected: false };
    scene.add(group);
    return group;
  });

  // ---------------- bake the forest into instanced meshes ----------------
  // Everything past the fog distance is invisible, so the shader collapses those
  // instances instead of rasterising a fully fogged quad.
  billboards.setCullFar(scene.fog ? scene.fog.far + 8 : 300);
  billboards.build(scene);

  const update = (dt, time) => {
    waterMap.offset.y = (time * 0.035) % 1;
    waterMap.offset.x = Math.sin(time * 0.25) * 0.02;
    // sway and pollen drift are vertex shader work now; only push the clock
    billboards.update(time);
    pollen.update(time);
    for (const swayer of swayers) {
      const wobble = Math.sin(time * 0.9 + swayer.phase);
      const scale = 1 + wobble * swayer.amp;
      swayer.sprite.scale.set(swayer.baseX * scale, swayer.baseY * scale, 1);
    }
    const flicker = 1 + Math.sin(time * 11) * 0.08 + Math.sin(time * 23.3) * 0.05;
    flame.scale.set(2.6 * flicker, 3.4 * flicker, 1);
    light.intensity = 11 + Math.sin(time * 13) * 2.6;
    for (const ember of embers) {
      const t = (time * 0.6 + ember.userData.seed) % 1;
      ember.position.set(
        Math.sin(time * 1.4 + ember.userData.seed) * ember.userData.radius,
        0.4 + t * 3.4,
        Math.cos(time * 1.1 + ember.userData.seed) * ember.userData.radius,
      );
      ember.material.opacity = 0.75;
      ember.scale.setScalar(0.3 * (1 - t) + 0.06);
    }
    for (const cone of pinecones) {
      if (cone.userData.collected) continue;
      cone.position.y = cone.userData.baseY + Math.sin(time * 1.8 + cone.userData.seed) * 0.16;
      cone.rotation.y = time * 0.8 + cone.userData.seed;
    }
  };

  return {
    colliders,
    update,
    pinecones,
    pathSamples,
    sunLight: directional,
    doomed: {
      sprite: doomed,
      sway: doomedSway,
      stump: stumpSprite,
      felledTrunk,
      height: DOOMED_TREE.height,
    },
  };
}
