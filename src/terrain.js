import * as THREE from '../vendor/three.module.js';

/**
 * The shape of 狗熊岭.
 *
 * The valley used to be a perfectly flat slab with one straight gorge cut into
 * it. It is now an analytic height field: rolling hills, a raised northern
 * plateau, a sunken swamp bowl, flattened clearings where the landmarks are, and
 * the river gorge carved through all of it. Everything that needs to know where
 * the ground is — the player, every billboard, every blob shadow, the trail
 * ribbons — asks this one function, so a hill can never be drawn in one place and
 * walked on in another.
 *
 * It is deterministic and cheap (a handful of sin/cos), which matters: it is
 * sampled once per frame for the player and thousands of times while the world
 * is built.
 */

export const WORLD = {
  size: 460,
  playRadius: 205,
  clearingRadius: 34,
  villageCenter: new THREE.Vector2(0, 0),
  sunDir: new THREE.Vector3(-0.45, 0.72, -0.52).normalize(),
  fogColor: 0xb7cdbd,
};

/** The gorge that splits the valley: the camp is west, the lumber yard east. */
export const RIVER = {
  x: 34,
  halfWidth: 6,
  bankWidth: 4.2,
  floorY: -4.6,
  waterY: -3.3,
  bridgeZ: 18,
  bridgeHalfWalk: 1.15,
  bridgeFrom: 26.2,
  bridgeTo: 41.8,
  deckY: 0.32,
};

/** Standing water in the swamp bowl. */
export const SWAMP_WATER_Y = -1.42;

/**
 * Named places. `r` is the radius of influence; `y` is the height the middle of
 * the region is flattened to (omit it to keep whatever the hills do).
 */
export const REGIONS = [
  {
    id: 'camp', name: '森林营地', x: 0, z: 0, r: 38, y: 0,
    blurb: '熊大和邻居们住的地方,营火一直烧着。',
  },
  {
    id: 'lumberyard', name: '河湾伐木场', x: 64, z: 20, r: 32, y: 0,
    blurb: '光头强砍树的地方,木头堆得满地都是。',
  },
  {
    id: 'stones', name: '巨石阵', x: -58, z: -34, r: 30, y: 3.4,
    blurb: '咕咕长老守了三百年的石头圈。',
  },
  {
    id: 'grove', name: '蘑菇林', x: 54, z: -60, r: 30, y: 1.1,
    blurb: '会长出发光蘑菇的林间凹地。',
  },
  {
    id: 'oldwood', name: '老林子', x: -30, z: -104, r: 44, y: 2.2,
    blurb: '千年大树脚下最老的林子,雾一起就看不见路。',
  },
  {
    id: 'swamp', name: '迷雾沼泽', x: -104, z: 74, r: 62, y: -1.95,
    blurb: '水没过脚踝的烂泥塘,野蜂在蜂巢边上转。',
  },
  {
    id: 'highland', name: '夜色高地', x: 104, z: -104, r: 66, y: 17, core: 0.2,
    blurb: '东边最高的石台,太阳一落就只剩星光。',
  },
];

export const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

export const LANDMARKS = [
  { x: 0, z: 0, label: '森林营地', region: 'camp' },
  { x: -16, z: 5, label: '木屋', region: 'camp' },
  { x: 0, z: -62, label: '千年大树', region: 'oldwood' },
  { x: 64, z: 20, label: '伐木场', region: 'lumberyard' },
  { x: 48, z: 13, label: '光头强砍树处', region: 'lumberyard' },
  { x: -58, z: -34, label: '巨石阵', region: 'stones' },
  { x: 54, z: -60, label: '蘑菇林', region: 'grove' },
  { x: -104, z: 74, label: '迷雾沼泽', region: 'swamp' },
  { x: 104, z: -104, label: '夜色高地', region: 'highland' },
  { x: 34, z: 18, label: '独木桥', region: 'camp' },
];

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (t) => { const s = clamp01(t); return s * s * (3 - 2 * s); };

/** Rolling hills, before anything is flattened or carved into them. */
function hills(x, z) {
  return 1.9 * Math.sin(x * 0.0193 + 0.7) * Math.cos(z * 0.0161 - 0.4)
    + 1.2 * Math.sin(x * 0.0411 - 1.3) * Math.sin(z * 0.0357 + 0.9)
    + 0.8 * Math.sin((x * 0.7 + z * 0.9) * 0.0125 + 2.1)
    + 0.35 * Math.cos(x * 0.083) * Math.sin(z * 0.071);
}

/**
 * Small scale unevenness, 20-50m across and at most about 70cm high.
 *
 * Without it every hill is a pure sine of one wavelength and the whole valley
 * reads as a smooth sheet — no amount of texture detail fixes a silhouette that
 * obviously mathematical. The wavelengths are deliberately kept well above the
 * 2.4m terrain grid so this shows up in the shading, not as mesh noise.
 */
function microRelief(x, z) {
  return 0.44 * Math.sin(x * 0.147 + 0.9) * Math.cos(z * 0.131 - 0.4)
    + 0.24 * Math.sin(x * 0.311 - 1.7) * Math.sin(z * 0.287 + 1.3)
    + 0.11 * Math.cos(x * 0.53 + 0.4) * Math.sin(z * 0.49 - 2.2);
}

/** Blend the raw hills towards a region's flat height. */
function flatten(h, x, z, region) {
  const d = Math.hypot(x - region.x, z - region.z);
  if (d > region.r) return h;
  // a large plateau is only dead flat in the middle: a 60m disc of perfectly
  // level ground is its own kind of fake
  const core = region.core || 0.44;
  const t = smooth((d - region.r * core) / (region.r * (1 - core)));
  return region.y * (1 - t) + h * t;
}

/** Distance from the river centre line, used for the gorge and the banks. */
export function isGorge(x) {
  return Math.abs(x - RIVER.x) < RIVER.halfWidth;
}

/** Height of the walkable ground at a point, including the carved gorge. */
export function terrainHeight(x, z) {
  let h = hills(x, z);

  // the northern plateau: a wide dome, then the region flattening on top of it
  const dh = Math.hypot(x - 104, z + 104);
  h += 19 * smooth(1 - dh / 150);
  // a softer shoulder so the climb out of the valley is not a wall
  h += 4.5 * smooth(1 - Math.hypot(x - 70, z + 60) / 190);
  // the stone circle sits on its own little knoll
  h += 6 * smooth(1 - Math.hypot(x + 58, z + 34) / 86);

  // Unevenness goes on before the clearings are flattened, so a clearing really
  // is level.
  h += microRelief(x, z);

  // The river runs along the bottom of the valley. Without this the hills ran
  // right up to the gorge lip and the banks beside the log bridge sat two metres
  // above its fixed deck — the plank was buried at both ends. Blending the
  // ground towards the valley floor over a 22m flood plain puts the banks back
  // where a bridge can reach them, and reads as a river valley rather than a
  // slot canyon cut into a hillside.
  const gorgeEdge = RIVER.halfWidth + RIVER.bankWidth;
  h *= smooth((Math.abs(x - RIVER.x) - gorgeEdge) / 22);

  for (const region of REGIONS) {
    if (region.y !== undefined) h = flatten(h, x, z, region);
  }

  // the river gorge is carved last, so it cuts through every region
  const g = Math.abs(x - RIVER.x);
  if (g < gorgeEdge) {
    const t = smooth((g - RIVER.halfWidth) / RIVER.bankWidth);
    h = RIVER.floorY + (h - RIVER.floorY) * t;
  }
  return h;
}

/** Surface normal by central differences — used for slope blending and props. */
export function groundSlope(x, z, eps = 1.2) {
  const dx = (terrainHeight(x + eps, z) - terrainHeight(x - eps, z)) / (2 * eps);
  const dz = (terrainHeight(x, z + eps) - terrainHeight(x, z - eps)) / (2 * eps);
  return Math.hypot(dx, dz);
}

/** 0 on flat ground, 1 where the ground is a cliff. */
export function steepness(x, z) {
  return clamp01(groundSlope(x, z) / 1.5);
}

export function isOnBridge(x, z) {
  return x > RIVER.bridgeFrom - 0.35 && x < RIVER.bridgeTo + 0.35
    && Math.abs(z - RIVER.bridgeZ) < RIVER.bridgeHalfWalk;
}

/** Height of the walkable ground at a point: deck on the log, terrain elsewhere. */
export function groundHeightAt(x, z) {
  if (isOnBridge(x, z)) return RIVER.deckY;
  return terrainHeight(x, z);
}

export function regionAt(x, z) {
  let best = REGIONS[0];
  let bestScore = -Infinity;
  for (const region of REGIONS) {
    const d = Math.hypot(x - region.x, z - region.z);
    const score = region.r - d;
    if (score > bestScore) {
      bestScore = score;
      best = region;
    }
  }
  return best;
}

/** True while the player is standing in the swamp's standing water. */
export function isInSwampWater(x, z) {
  const region = REGION_BY_ID.swamp;
  if (Math.hypot(x - region.x, z - region.z) > region.r * 0.86) return false;
  return terrainHeight(x, z) < SWAMP_WATER_Y;
}
