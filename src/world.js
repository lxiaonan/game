import * as THREE from '../vendor/three.module.js';
import { makeBlobShadow, makeGlow, makePollen, makeWarpNoise } from './assets.js';
import { createBillboardField } from './billboards.js';
import { createPollenField } from './pollen.js';
import {
  WORLD, RIVER, SWAMP_WATER_Y, REGIONS, REGION_BY_ID, LANDMARKS,
  terrainHeight, steepness, regionAt, isOnBridge, groundHeightAt,
} from './terrain.js';

export {
  WORLD, RIVER, SWAMP_WATER_Y, REGIONS, REGION_BY_ID, LANDMARKS,
  terrainHeight, steepness, regionAt, isOnBridge, groundHeightAt,
};

/** Tree the lumberjack is chopping: the target of the tutorial fight. */
export const DOOMED_TREE = { x: 48, z: 13, height: 16 };

/** Trails, as world space waypoints. They follow the ground, hills and all. */
const PATHS = [
  [[6, 78], [3, 48], [0, 18], [-2, -6], [3, -28], [0, -56], [-6, -86]],
  [[0, 6], [12, 9], [20, 14], [26.2, 18]],
  [[41.8, 18], [48, 15.5], [54, 16], [64, 20], [76, 32]],
  [[-2, -8], [-20, -16], [-40, -25], [-58, -34], [-74, -46], [-88, -62]],
  [[-2, 2], [-24, 22], [-48, 40], [-72, 56], [-92, 68]],
  [[2, -14], [16, -34], [32, -48], [46, -58], [54, -60]],
  [[64, 20], [84, 2], [96, -30], [102, -70], [104, -100]],
];

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

/**
 * A coarse rasterised "how far is the nearest trail" field.
 *
 * The terrain shader needs the distance from every one of its ~37k vertices to
 * the trail network, and doing that against the raw curve samples is ~20M
 * distance tests at load. Stamping discs along the trails into a 2.5m grid and
 * reading it back with bilinear interpolation is a few thousand writes and gives
 * the same soft falloff.
 */
function buildDistanceField(samples, step = 2.5, radius = 9) {
  const count = Math.ceil(WORLD.size / step) + 2;
  const origin = -WORLD.size / 2 - step;
  const field = new Float32Array(count * count).fill(1e9);
  const cells = Math.ceil(radius / step);
  const r2 = radius * radius;
  const put = (x, z) => {
    const cx = Math.round((x - origin) / step);
    const cz = Math.round((z - origin) / step);
    for (let dz = -cells; dz <= cells; dz += 1) {
      const gz = cz + dz;
      if (gz < 0 || gz >= count) continue;
      for (let dx = -cells; dx <= cells; dx += 1) {
        const gx = cx + dx;
        if (gx < 0 || gx >= count) continue;
        const wx = origin + gx * step - x;
        const wz = origin + gz * step - z;
        const d2 = wx * wx + wz * wz;
        const index = gz * count + gx;
        if (d2 < field[index] && d2 < r2) field[index] = d2;
      }
    }
  };
  for (const list of samples) {
    for (let i = 0; i < list.length; i += 1) put(list[i][0], list[i][1]);
  }
  // two cheap box blurs so the trail edge is a gradient rather than a staircase
  const blur = (src) => {
    const out = new Float32Array(src.length);
    for (let z = 0; z < count; z += 1) {
      for (let x = 0; x < count; x += 1) {
        let sum = 0;
        let n = 0;
        for (let dz = -1; dz <= 1; dz += 1) {
          const gz = z + dz;
          if (gz < 0 || gz >= count) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const gx = x + dx;
            if (gx < 0 || gx >= count) continue;
            sum += src[gz * count + gx];
            n += 1;
          }
        }
        out[z * count + x] = sum / n;
      }
    }
    return out;
  };
  let smooth = blur(blur(field));
  return {
    /** Distance in metres to the nearest trail sample (clamped to `radius`). */
    at(x, z) {
      const fx = (x - origin) / step;
      const fz = (z - origin) / step;
      const x0 = Math.floor(fx);
      const z0 = Math.floor(fz);
      if (x0 < 0 || z0 < 0 || x0 + 1 >= count || z0 + 1 >= count) return radius;
      const tx = fx - x0;
      const tz = fz - z0;
      const a = smooth[z0 * count + x0];
      const b = smooth[z0 * count + x0 + 1];
      const c = smooth[(z0 + 1) * count + x0];
      const d = smooth[(z0 + 1) * count + x0 + 1];
      const v = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
      return Math.min(Math.sqrt(Math.max(0, v)), radius);
    },
  };
}

/**
 * The five way surface splat, plus the anti-tiling work.
 *
 * One height field has to look like grass, a worn trail, a river cliff, swamp
 * mud and a bare stone plateau at once, and four of those are not where the
 * others are. Rather than five overlapping meshes (z-fighting on a slope, and
 * five times the vertices) every terrain vertex carries its own blend weights
 * and the fragment shader mixes the five textures with them.
 *
 * On top of that, three things stop the repeat from being visible:
 *
 *  1. One shared low frequency warp bends every layer's lookup at once, so the
 *     straight seam lines the eye hunts for become irregular curves.
 *  2. Each layer is rotated by a different odd angle, so their grids never stack
 *     into a single stronger pattern.
 *  3. The grass — the layer that covers by far the most screen — is sampled
 *     twice at wildly different scales and multiplied. The product only repeats
 *     when *both* octaves line up again, which pushes the visible period far
 *     beyond the distance you can actually see.
 */
function createTerrainMaterial(tex) {
  const material = new THREE.MeshLambertMaterial({ map: tex.grass });
  const samplers = {
    uDirtMap: { value: tex.dirt },
    uRockMap: { value: tex.cliff },
    uStoneMap: { value: tex.stone },
    uSwampMap: { value: tex.swamp },
    uWarpMap: { value: makeWarpNoise() },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, samplers);
    shader.vertexShader = [
      'attribute vec4 aBlend;',
      'attribute float aStone;',
      'attribute vec3 aTint;',
      'varying vec4 vBlend;',
      'varying float vStone;',
      'varying vec3 vTint;',
    ].join('\n') + '\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vBlend = aBlend;\n  vStone = aStone;\n  vTint = aTint;',
    );
    shader.fragmentShader = [
      'uniform sampler2D uDirtMap;',
      'uniform sampler2D uRockMap;',
      'uniform sampler2D uStoneMap;',
      'uniform sampler2D uSwampMap;',
      'uniform sampler2D uWarpMap;',
      'varying vec4 vBlend;',
      'varying float vStone;',
      'varying vec3 vTint;',
      'vec2 rot2(vec2 p, float a) {',
      '  float s = sin(a); float c = cos(a);',
      '  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);',
      '}',
    ].join('\n') + '\n' + shader.fragmentShader.replace(
      '#include <map_fragment>',
      [
        '#include <map_fragment>',
        '  vec2 warped = vMapUv + (texture2D(uWarpMap, vMapUv * 0.035).rg - 0.5) * 0.62;',
        '  vec4 bw = max(vBlend, vec4(0.0));',
        '  float stoneW = max(vStone, 0.0);',
        '  float total = bw.x + bw.y + bw.z + bw.w + stoneW + 1e-4;',
        '  vec3 grassA = texture2D(map, warped).rgb;',
        '  vec3 grassB = texture2D(map, warped * 0.17).rgb;',
        '  vec3 grass = grassA * (0.45 + grassB * 1.3);',
        '  vec3 splat = grass * (bw.x / total)',
        '    + texture2D(uDirtMap, rot2(warped, 0.62) * 1.35).rgb * (bw.y / total)',
        '    + texture2D(uRockMap, rot2(warped, 1.15) * 1.85).rgb * (bw.z / total)',
        '    + texture2D(uSwampMap, rot2(warped, 2.10) * 0.85).rgb * (bw.w / total)',
        '    + texture2D(uStoneMap, rot2(warped, 2.72) * 0.60).rgb * (stoneW / total);',
        '  diffuseColor.rgb *= splat * vTint;',
      ].join('\n'),
    );
  };
  material.customProgramCacheKey = () => 'terrain-splat';
  return material;
}

/**
 * Rewrite a plane's UVs so one UV unit is `tile` metres of world, on both axes.
 *
 * PlaneGeometry hands out 0..1 UVs regardless of size, so a 15m x 460m river bed
 * was getting one texture stretched across all of it — every texel 30cm wide and
 * 90cm long. Anything that big has to be tiled in world units or it reads as a
 * smeared gradient instead of a surface.
 */
function worldUV(geometry, tile) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i += 1) {
    uv.setXY(i, pos.getX(i) / tile, pos.getY(i) / tile);
  }
  uv.needsUpdate = true;
  return geometry;
}

function ribbonGeometry(curve, width, segments, heightAt) {
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
    const ax = point.x + (nx / len) * w;
    const az = point.z + (nz / len) * w;
    const bx = point.x - (nx / len) * w;
    const bz = point.z - (nz / len) * w;
    // the trail is draped over the hill it crosses instead of cutting through it
    positions.push(ax, heightAt(ax, az) + 0.05, az);
    positions.push(bx, heightAt(bx, bz) + 0.05, bz);
    // the trail texture runs along the ribbon, so its repeat period is a
    // stride length rather than a world size; 7m keeps it out of step with the
    // 4m ground tiles it is lying on
    const v = travelled / 7;
    // u spans the ribbon in the same world units, otherwise the texture is
    // stretched across the width and squashed along the length
    uvs.push(0, v, w * 2 / 7, v);
    if (i > 0) {
      const a = (i - 1) * 2;
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
  const swayers = [];
  let nightMode = false;
  const blobShadow = makeBlobShadow();
  const glow = makeGlow();
  const billboards = createBillboardField();

  // ---------------- sky, sun and light ----------------
  const skyMaterial = new THREE.MeshBasicMaterial({
    map: tex.sky, side: THREE.BackSide, fog: false, depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 32), skyMaterial);
  sky.renderOrder = -10;
  scene.add(sky);

  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: 0xfff3cf, transparent: true, opacity: 0.95, depthWrite: false, fog: false,
  }));
  sun.scale.set(120, 120, 1);
  sun.position.copy(WORLD.sunDir).multiplyScalar(330);
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4b6135, 0.95);
  scene.add(hemi);
  const directional = new THREE.DirectionalLight(0xfff0cf, 1.75);
  directional.position.copy(WORLD.sunDir).multiplyScalar(120);
  scene.add(directional);
  scene.fog = new THREE.Fog(WORLD.fogColor, 46, 190);

  // ---------------- trails ----------------
  const pathSamples = [];
  for (const raw of PATHS) {
    const points = raw.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
    const segments = Math.max(48, Math.round(curve.getLength() / 1.5));
    const local = [];
    for (let i = 0; i <= segments; i += 1) {
      const p = curve.getPointAt(i / segments);
      local.push([p.x, p.z]);
    }
    pathSamples.push(local);
  }
  const trailDistance = buildDistanceField(pathSamples);

  // ---------------- the terrain itself ----------------
  const terrainMaterial = createTerrainMaterial(tex);
  const SEGMENTS = 188;
  const terrainGeo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, SEGMENTS, SEGMENTS);
  terrainGeo.rotateX(-Math.PI / 2);
  {
    const pos = terrainGeo.attributes.position;
    const uv = terrainGeo.attributes.uv;
    const blend = new Float32Array(pos.count * 4);
    const stone = new Float32Array(pos.count);
    const tint = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = terrainHeight(x, z);
      pos.setY(i, y);
      // one UV unit is 4 metres of world, so every splat channel is tiled in
      // world space and the seams between channels line up exactly
      uv.setXY(i, x / 4, z / 4);

      const region = regionAt(x, z);
      const slope = steepness(x, z);
      const dp = trailDistance.at(x, z);
      // three scales of colour patchiness: 200m, 60m and 13m. The 13m octave is
      // what keeps a big clearing from reading as one flat wash of one colour.
      let wobble = 0.5 + 0.32 * Math.sin(x * 0.031) * Math.cos(z * 0.027)
        + 0.22 * Math.sin((x + z) * 0.013) + 0.14 * Math.sin(x * 0.101 + 1.7) * Math.sin(z * 0.087)
        + 0.16 * Math.sin(x * 0.483 + 2.4) * Math.sin(z * 0.451 - 1.1);
      wobble = Math.max(0, Math.min(1, wobble));

      let grass = 0.85 + wobble * 0.5;
      let dirt = 0;
      let rock = 0;
      let swamp = 0;
      let stoneW = 0;
      if (dp < 5.5) dirt += 1.5 * (1 - dp / 5.5);
      const toRiver = Math.abs(x - RIVER.x);
      if (toRiver < RIVER.halfWidth + RIVER.bankWidth + 2.5) dirt += 0.8;
      rock += slope * 2.4;

      if (region.id === 'swamp') {
        const t = 1 - Math.min(1, Math.hypot(x - region.x, z - region.z) / (region.r * 0.92));
        swamp += t * 1.7;
      }
      if (region.id === 'highland') {
        const t = 1 - Math.min(1, Math.hypot(x - region.x, z - region.z) / (region.r * 0.8));
        stoneW += t * 1.5;
      }
      if (region.id === 'stones') {
        const t = 1 - Math.min(1, Math.hypot(x - region.x, z - region.z) / (region.r * 0.7));
        stoneW += t * 0.6;
      }
      if (region.id === 'lumberyard') dirt += 0.35;

      blend[i * 4] = grass;
      blend[i * 4 + 1] = dirt;
      blend[i * 4 + 2] = rock;
      blend[i * 4 + 3] = swamp;
      stone[i] = stoneW;
      // mild per-vertex colour patches, centred on 1.0 so they modulate the
      // splat rather than darkening the whole valley
      tint[i * 3] = 0.86 + wobble * 0.24;
      tint[i * 3 + 1] = 0.9 + wobble * 0.18;
      tint[i * 3 + 2] = 0.8 + wobble * 0.22;
    }
    terrainGeo.setAttribute('aBlend', new THREE.BufferAttribute(blend, 4));
    terrainGeo.setAttribute('aStone', new THREE.BufferAttribute(stone, 1));
    terrainGeo.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    terrainGeo.computeVertexNormals();
  }
  const terrain = new THREE.Mesh(terrainGeo, terrainMaterial);
  scene.add(terrain);

  // ---------------- river and swamp water ----------------
  const bedMap = tex.dirt;
  bedMap.wrapS = bedMap.wrapT = THREE.RepeatWrapping;
  const riverbed = new THREE.Mesh(
    worldUV(new THREE.PlaneGeometry(RIVER.halfWidth * 2 + 3, WORLD.size, 1, 1), 8),
    new THREE.MeshLambertMaterial({ map: bedMap, color: 0x6b6255 }),
  );
  riverbed.rotation.x = -Math.PI / 2;
  riverbed.position.set(RIVER.x, RIVER.floorY + 0.02, 0);
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
  const waterGeo = worldUV(new THREE.PlaneGeometry(RIVER.halfWidth * 2 - 0.1, WORLD.size, 1, 30), 9);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(RIVER.x, RIVER.waterY, 0);
  scene.add(water);

  // the swamp is a wide sheet of stagnant water with a slow drifting scum layer
  const swampMap = tex.water.clone();
  swampMap.needsUpdate = true;
  swampMap.wrapS = swampMap.wrapT = THREE.RepeatWrapping;
  const swampWater = new THREE.Mesh(
    worldUV(new THREE.CircleGeometry(REGION_BY_ID.swamp.r * 0.88, 56), 11),
    new THREE.MeshPhongMaterial({
      map: swampMap, color: 0x4e6b46, emissive: 0x16240f, emissiveIntensity: 0.6,
      specular: 0x6a8a70, shininess: 30, transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  swampWater.rotation.x = -Math.PI / 2;
  swampWater.position.set(REGION_BY_ID.swamp.x, SWAMP_WATER_Y, REGION_BY_ID.swamp.z);
  scene.add(swampWater);

  // ---------------- the log bridge ----------------
  const BARK_TILES = { u: 6, v: 1.4 };
  const barkMap = tex.bark;
  barkMap.wrapS = barkMap.wrapT = THREE.RepeatWrapping;
  const barkMat = new THREE.MeshLambertMaterial({ map: barkMap });
  const bridgeLength = RIVER.bridgeTo - RIVER.bridgeFrom;
  const bridgeMid = (RIVER.bridgeFrom + RIVER.bridgeTo) / 2;
  const logRadius = 0.78;
  const deckThickness = 0.16;
  const deckCenterY = RIVER.deckY - deckThickness / 2;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(logRadius, logRadius * 0.92, bridgeLength, 18, 1, false),
    barkMat,
  );
  {
    const uv = trunk.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * BARK_TILES.u, uv.getY(i) * BARK_TILES.v);
  }
  trunk.rotation.z = Math.PI / 2;
  trunk.position.set(bridgeMid, deckCenterY - deckThickness / 2 - logRadius + 0.12, RIVER.bridgeZ);
  scene.add(trunk);

  const deckGeo = new THREE.BoxGeometry(bridgeLength + 0.4, deckThickness, RIVER.bridgeHalfWalk * 2);
  {
    const uv = deckGeo.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * 8, uv.getY(i));
  }
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshLambertMaterial({ map: barkMap, color: 0xc4a57a }));
  deck.position.set(bridgeMid, deckCenterY, RIVER.bridgeZ);
  scene.add(deck);

  for (const x of [RIVER.bridgeFrom + 0.2, RIVER.bridgeTo - 0.2]) {
    for (const side of [-1, 1]) {
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.09, 1.05, 6), barkMat,
      );
      marker.position.set(x, RIVER.deckY + 0.48, RIVER.bridgeZ + side * (RIVER.bridgeHalfWalk - 0.08));
      scene.add(marker);
    }
  }
  for (let i = 0; i < 6; i += 1) {
    const t = (i + 0.5) / 6;
    const x = RIVER.bridgeFrom + t * bridgeLength;
    const side = i % 2 ? 1 : -1;
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.55, 6), barkMat);
    stub.rotation.x = side * 1.15;
    stub.position.set(x, trunk.position.y - 0.05, RIVER.bridgeZ + side * (logRadius + 0.12));
    scene.add(stub);
  }
  const postTop = trunk.position.y - logRadius * 0.35;
  const postHeight = postTop - RIVER.floorY;
  for (const zOffset of [-1.15, 1.15]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, postHeight, 8), barkMat);
    post.position.set(bridgeMid, RIVER.floorY + postHeight / 2, RIVER.bridgeZ + zOffset);
    post.rotation.x = zOffset > 0 ? 0.12 : -0.12;
    scene.add(post);
  }

  // ---------------- trails, drawn as ribbons draped on the terrain ----------------
  const shadowQuads = [];
  const addShadowQuad = (x, z, size) => {
    const h = size / 2;
    const px = [x - h, x + h, x + h, x - h];
    const pz = [z - h, z - h, z + h, z + h];
    const lift = 0.07;
    for (let i = 0; i < 4; i += 1) {
      shadowQuads.push(
        px[i], groundHeightAt(px[i], pz[i]) + lift, pz[i],
        i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0,
      );
    }
  };

  const dirtMap = tex.dirt;
  dirtMap.wrapS = dirtMap.wrapT = THREE.RepeatWrapping;
  dirtMap.anisotropy = 4;
  const dirtMat = new THREE.MeshLambertMaterial({
    map: dirtMap, transparent: true, opacity: 0.95,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const dirtEdgeMat = dirtMat.clone();
  dirtEdgeMat.opacity = 0.4;
  for (const local of pathSamples) {
    const points = local.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
    const segments = Math.max(48, Math.round(curve.getLength() / 1.5));
    const edge = new THREE.Mesh(ribbonGeometry(curve, 5.4, segments, groundHeightAt), dirtEdgeMat);
    edge.position.y = -0.012;
    scene.add(edge);
    scene.add(new THREE.Mesh(ribbonGeometry(curve, 3.4, segments, groundHeightAt), dirtMat));
  }

  // ---------------- helpers ----------------
  const materialCache = new Map();
  const spriteMaterial = (texture, alphaTest, color) => {
    const key = texture.uuid + '|' + alphaTest + '|' + color;
    if (!materialCache.has(key)) {
      materialCache.set(key, new THREE.SpriteMaterial({
        map: texture, transparent: false, alphaTest, color, fog: true, depthWrite: true,
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
    const y = opts.y === undefined ? groundHeightAt(x, z) : opts.y;
    sprite.position.set(x, y, z);
    sprite.center.set(0.5, 0);
    scene.add(sprite);
    if (opts.shadow !== false) addShadowQuad(x, z, height * (opts.shadowScale || 0.75));
    sprite.userData.baseX = height * aspect * sign;
    sprite.userData.baseY = height;
    return sprite;
  };

  const addBillboard = (texture, x, z, height, opts = {}) => {
    billboards.add(texture, {
      x,
      y: opts.y === undefined ? terrainHeight(x, z) : opts.y,
      z,
      height,
      width: opts.width,
      mirror: opts.mirror,
      phase: opts.phase,
      amp: opts.amp,
      alphaTest: opts.alphaTest,
    });
    if (opts.shadow !== false) addShadowQuad(x, z, height * (opts.shadowScale || 0.75));
  };

  const treeTypes = [
    { tex: tex.treePine, height: [12, 18], weight: 0.34 },
    { tex: tex.treeOak, height: [10, 15], weight: 0.34 },
    { tex: tex.treeBig, height: [15, 22], weight: 0.22 },
    { tex: tex.treeDead, height: [7, 12], weight: 0.10 },
  ];

  const regionDistance = (x, z, id) => {
    const region = REGION_BY_ID[id];
    return Math.hypot(x - region.x, z - region.z);
  };

  /** Reject spots that belong to the trail, the water or a landmark. */
  const blocked = (x, z, radius) => {
    if (Math.abs(x - RIVER.x) < RIVER.halfWidth + RIVER.bankWidth + 1.5) return true;
    if (trailDistance.at(x, z) < radius) return true;
    for (const landmark of LANDMARKS) {
      if (Math.hypot(landmark.x - x, landmark.z - z) < 10) return true;
    }
    if (regionDistance(x, z, 'swamp') < REGION_BY_ID.swamp.r * 0.5
      && terrainHeight(x, z) < SWAMP_WATER_Y + 0.15) return true;
    return false;
  };

  // ---------------- forest ----------------
  const treeCount = 980;
  let placed = 0;
  let guard = 0;
  const treeSpots = [];
  while (placed < treeCount && guard < 26000) {
    guard += 1;
    const angle = rand() * Math.PI * 2;
    const radius = 14 + Math.pow(rand(), 0.5) * (WORLD.playRadius - 10);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (blocked(x, z, 4.2)) continue;
    if (Math.hypot(x, z) < 11) continue;
    // the highland plateau keeps only a thin wind-bent pine line
    if (regionDistance(x, z, 'highland') < REGION_BY_ID.highland.r * 0.55 && rand() < 0.72) continue;
    // the swamp is mostly dead wood
    const swampiness = 1 - Math.min(1, regionDistance(x, z, 'swamp') / REGION_BY_ID.swamp.r);
    let type;
    if (swampiness > 0.35) {
      type = rand() < 0.62 ? treeTypes[3] : treeTypes[1];
    } else {
      const roll = rand();
      let acc = 0;
      type = treeTypes[0];
      for (const candidate of treeTypes) {
        acc += candidate.weight;
        if (roll <= acc) { type = candidate; break; }
      }
    }
    const height = type.height[0] + rand() * (type.height[1] - type.height[0]);
    addBillboard(type.tex, x, z, height, {
      shadowScale: 0.6,
      mirror: rand() < 0.5,
      phase: rand() * Math.PI * 2,
      amp: 0.008 + rand() * 0.012,
    });
    treeSpots.push({ x, z, r: 0.55 + height * 0.045 });
    colliders.push(treeSpots[treeSpots.length - 1]);
    placed += 1;
  }

  // shrubs sprinkled everywhere, including inside the clearing
  for (let i = 0; i < 420; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = 4 + Math.pow(rand(), 0.72) * (WORLD.playRadius - 6);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (trailDistance.at(x, z) < 2.4) continue;
    if (Math.abs(x - RIVER.x) < RIVER.halfWidth + RIVER.bankWidth) continue;
    if (LANDMARKS.some((l) => Math.hypot(l.x - x, l.z - z) < 8)) continue;
    if (Math.hypot(x + 16, z - 5) < 9) continue;
    const height = 0.8 + rand() * 1.5;
    addBillboard(rand() < 0.86 ? tex.bush : tex.mushroom, x, z, height, {
      shadowScale: 0.8,
      shadow: radius < 110,
      mirror: rand() < 0.5,
      phase: rand() * Math.PI * 2,
      amp: 0.02 + rand() * 0.02,
    });
  }

  // ---------------- ground clutter ----------------
  // A textured plane with nothing standing up out of it reads as a texture, not
  // as ground — and a bare plane is also exactly where tiling is most obvious,
  // because there is no geometry to interrupt the repeat. These are small, dense
  // and shadowless: they exist to break up the surface. Instanced, and the
  // billboard shader already collapses anything past the fog, so the far ones
  // cost nothing but a vertex shader branch.
  let clutter = 0;
  for (let i = 0; i < 8000; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = 2.5 + Math.pow(rand(), 0.6) * (WORLD.playRadius - 3);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (Math.abs(x - RIVER.x) < RIVER.halfWidth + RIVER.bankWidth + 0.4) continue;
    if (trailDistance.at(x, z) < 1.3) continue;
    const region = regionAt(x, z);
    const rocky = region.id === 'highland' || region.id === 'stones';
    const roll = rand();
    let texture = tex.tuft;
    if (rocky) texture = roll < 0.6 ? tex.pebble : tex.tuft;
    else if (roll > 0.78) texture = tex.fern;
    else if (roll > 0.68) texture = tex.pebble;
    const height = (rocky ? 0.22 : 0.34) + rand() * (rocky ? 0.28 : 0.5);
    addBillboard(texture, x, z, height, {
      shadow: false,
      alphaTest: 0.22,
      mirror: rand() < 0.5,
      phase: rand() * Math.PI * 2,
      amp: 0.03 + rand() * 0.05,
    });
    clutter += 1;
  }

  // reeds and rocks along both river banks so the drop reads clearly
  for (let i = 0; i < 90; i += 1) {
    const z = -WORLD.playRadius + rand() * WORLD.playRadius * 2;
    const side = rand() < 0.5 ? -1 : 1;
    if (Math.abs(z - RIVER.bridgeZ) < 4) continue;
    const x = RIVER.x + side * (RIVER.halfWidth + 0.4 + rand() * 3.4);
    const height = 0.5 + rand() * 0.8;
    addBillboard(rand() < 0.45 ? tex.rock : tex.bush, x, z, height, { shadow: false, mirror: rand() < 0.5 });
  }

  // ---------------- landmarks ----------------
  const giant = placeSprite(tex.treeBig, 0, -62, 40, { shadowScale: 0.55, alphaTest: 0.35 });
  colliders.push({ x: 0, z: -62, r: 4.2 });
  swayers.push({ sprite: giant, baseX: giant.userData.baseX, baseY: 40, phase: 1.1, amp: 0.004 });

  const hut = placeSprite(tex.hut, -16, 5, 6.4, { shadowScale: 0.95, alphaTest: 0.35 });
  colliders.push({ x: -16, z: 5, r: 5.6 });

  const rockSpots = [
    [-58, -34], [-53, -30], [-62, -29], [-57, -39], [-51, -37], [-64, -40],
    [44, -30], [52, -34], [-28, 62], [96, -100], [108, -98], [110, -112], [98, -112],
    [-118, 60], [-96, 44], [-92, 96],
  ];
  for (const [x, z] of rockSpots) {
    const height = 1.5 + rand() * 1.6;
    addBillboard(tex.rock, x, z, height, { shadowScale: 1.1, mirror: rand() < 0.5 });
    colliders.push({ x, z, r: height * 0.55 });
  }

  const logSpots = [
    [58, 26, 3.3], [68, 33, 2.8], [54, 35, 2.5], [-40, -18, 3.0], [30, 48, 2.6],
    [-104, 86, 3.0], [-88, 64, 2.5], [86, -70, 2.6],
  ];
  for (const [x, z, height] of logSpots) {
    addBillboard(tex.log, x, z, height, { shadowScale: 1.0, mirror: rand() < 0.5 });
    colliders.push({ x, z, r: height * 0.6 });
  }

  // glowing mushroom rings in the mushroom grove and the swamp
  const shroomSpots = [[54, -60], [46, -66], [62, -54], [58, -70], [-96, 82], [-112, 66],
    [-88, 86], [-116, 84], [-100, 58]];
  for (const [x, z] of shroomSpots) {
    const height = 1.4 + rand() * 1.6;
    addBillboard(tex.mushroom, x, z, height, { shadowScale: 1.0 });
    colliders.push({ x, z, r: height * 0.5 });
  }

  // an ancient gate arch marking each region boundary the trail passes through
  const gates = [
    [-72, 56, 0.9], [46, -58, 2.2], [102, -70, 1.6], [96, -30, 1.5], [-88, -62, 1.1],
  ];
  for (const [x, z, yaw] of gates) {
    const gate = placeSprite(tex.gate, x, z, 5.2, { shadowScale: 1.3, alphaTest: 0.35 });
    gate.material.rotation = yaw;
    colliders.push({ x: x - 2.1, z, r: 0.5 });
    colliders.push({ x: x + 2.1, z, r: 0.5 });
  }

  // campfire: stone ring, logs and a live flame
  const fire = new THREE.Group();
  const flameMat = new THREE.MeshBasicMaterial({
    map: glow, color: 0xffa63c, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
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
  const light = new THREE.PointLight(0xffa044, 12, 24, 2);
  light.position.set(0, 1.2, 0);
  fire.add(light);
  scene.add(fire);
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2;
    addBillboard(tex.rock, Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0.75, { shadow: false });
  }
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    addBillboard(tex.log, Math.cos(a) * 4.6, Math.sin(a) * 4.6, 1.15, { shadow: false });
  }
  colliders.push({ x: 0, z: 0, r: 2.5 });

  // ---------------- the tree the lumberjack is felling ----------------
  const doomed = placeSprite(tex.treeChopped, DOOMED_TREE.x, DOOMED_TREE.z, DOOMED_TREE.height, {
    shadowScale: 0.62, alphaTest: 0.35,
  });
  const doomedSway = { sprite: doomed, baseX: doomed.userData.baseX, baseY: DOOMED_TREE.height, phase: 2.4, amp: 0.006 };
  swayers.push(doomedSway);
  colliders.push({ x: DOOMED_TREE.x, z: DOOMED_TREE.z, r: 1.15 });

  const felledTrunk = new THREE.Group();
  const lying = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 0.72, DOOMED_TREE.height * 0.95, 14),
    new THREE.MeshLambertMaterial({ map: barkMap }),
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

  billboards.setCullFar(scene.fog ? scene.fog.far + 8 : 300);
  billboards.build(scene);

  const update = (dt, time) => {
    waterMap.offset.y = (time * 0.035) % 1;
    waterMap.offset.x = Math.sin(time * 0.25) * 0.02;
    swampMap.offset.y = (time * 0.006) % 1;
    swampMap.offset.x = (time * 0.004) % 1;
    billboards.update(time);
    pollen.update(time);
    for (const swayer of swayers) {
      const wobble = Math.sin(time * 0.9 + swayer.phase);
      const scale = 1 + wobble * swayer.amp;
      swayer.sprite.scale.set(swayer.baseX * scale, swayer.baseY * scale, 1);
    }
    const flicker = 1 + Math.sin(time * 11) * 0.08 + Math.sin(time * 23.3) * 0.05;
    flame.scale.set(2.6 * flicker, 3.4 * flicker, 1);
    light.intensity = (nightMode ? 20 : 11) + Math.sin(time * 13) * 2.6;
    for (const ember of embers) {
      const t = (time * 0.6 + ember.userData.seed) % 1;
      ember.position.set(
        Math.sin(time * 1.4 + ember.userData.seed) * ember.userData.radius,
        0.4 + t * 3.4,
        Math.cos(time * 1.1 + ember.userData.seed) * ember.userData.radius,
      );
      ember.scale.setScalar(0.3 * (1 - t) + 0.06);
    }
  };

  const DAY = {
    fog: 0xb7cdbd, fogNear: 46, fogFar: 190,
    hemi: 0xcfe6ff, hemiI: 0.95, sun: 0xfff0cf, sunI: 1.75, exposure: 1.06,
  };
  const NIGHT = {
    fog: 0x2b3550, fogNear: 22, fogFar: 132,
    hemi: 0x54628f, hemiI: 0.44, sun: 0xa8b6ff, sunI: 0.34, exposure: 1.2,
  };

  /**
   * Swap the valley between day and dusk. The night plateau chapter needs it, and
   * the billboard cull distance has to follow the fog or the far trees would be
   * culled before the fog hides them.
   */
  const setNight = (on, renderer) => {
    const preset = on ? NIGHT : DAY;
    nightMode = on;
    skyMaterial.map = on ? tex.skyDusk : tex.sky;
    skyMaterial.needsUpdate = true;
    sun.visible = !on;
    scene.fog.color.setHex(preset.fog);
    scene.fog.near = preset.fogNear;
    scene.fog.far = preset.fogFar;
    hemi.color.setHex(preset.hemi);
    hemi.intensity = preset.hemiI;
    directional.color.setHex(preset.sun);
    directional.intensity = preset.sunI;
    billboards.setCullFar(preset.fogFar + 8);
    if (renderer) renderer.toneMappingExposure = preset.exposure;
  };

  return {
    colliders,
    update,
    setNight,
    clutterCount: clutter,
    pathSamples,
    sunLight: directional,
    hemiLight: hemi,
    sky,
    skyMaterial,
    fireLight: light,
    doomed: {
      sprite: doomed,
      sway: doomedSway,
      stump: stumpSprite,
      felledTrunk,
      height: DOOMED_TREE.height,
    },
  };
}
