import * as THREE from '../vendor/three.module.js';

export const TEXTURES = {
  sky: 'sky_pano',
  skyDusk: 'sky_dusk',
  grass: 'ground_grass',
  dirt: 'ground_dirt',
  swamp: 'ground_swamp',
  stone: 'tex_stone',
  treePine: 'tree_pine',
  treeOak: 'tree_oak',
  treeBig: 'tree_big',
  treeDead: 'tree_dead',
  bush: 'tree_bush',
  mushroom: 'prop_mushroom',
  tuft: 'prop_grass_tuft',
  fern: 'prop_fern',
  pebble: 'prop_small_rock',
  log: 'prop_log',
  rock: 'prop_rock',
  hut: 'prop_hut',
  beehive: 'prop_beehive',
  totem: 'prop_totem',
  crystal: 'prop_crystal',
  gate: 'prop_gate',
  pinecone: 'item_pinecone',
  honey: 'item_honey',
  shroom: 'item_shroom',
  water: 'water_river',
  bark: 'tex_bark',
  cliff: 'tex_cliff',
  stump: 'prop_stump',
  treeChopped: 'tree_chopped',
  xiongda: 'char_xiongda',
  guangtouqiang: 'char_guangtouqiang',
  squirrel: 'char_squirrel',
  monkey: 'char_monkey',
  owl: 'char_owl',
  cuihua: 'char_cuihua',
  frog: 'char_frog',
  deer: 'char_deer',
  portrait: 'portrait_xionger',
  handLeft: 'hand_left',
  handRight: 'hand_right',
};

const BASE = 'assets/tex/';

// Anisotropic filtering only helps surfaces seen at a grazing angle. The billboards
// always face the camera — and their quad aspect matches the texture aspect, so
// their UV derivatives are isotropic — meaning 8x anisotropy was up to 8 texture
// taps per fragment for no visual gain, exactly where the overdraw is. The ground,
// water and the splat layers under them are the ones viewed obliquely, and they
// are what a first person camera stares at all day, so they get the full 8: the
// cleaner grazing angle detail is worth the bandwidth there.
const ANISOTROPY = {
  grass: 8,
  dirt: 8,
  water: 8,
  swamp: 8,
  stone: 8,
  bark: 2,
  cliff: 8,
};

// These are tiling surfaces, and at their tiling rates the 1024x1024 originals are
// an order of magnitude finer than the screen can resolve: the grass tile is 3.2m
// of world with 1024 texels across, i.e. 3mm per texel. Halving them to 512 takes
// the five of them from 27MB of texture memory down to 7MB with nothing visible at
// any viewing distance, and it also makes mipmap generation much cheaper at load.
// The source PNGs are untouched; this only resizes what gets uploaded.
const MAX_SIZE = {
  grass: 512,
  dirt: 512,
  water: 512,
  swamp: 512,
  stone: 512,
  bark: 512,
  cliff: 512,
  sky: 1024,
  skyDusk: 1024,
};

/** Re-draw an over-large texture into a smaller canvas and drop the original. */
function shrink(texture, max) {
  const image = texture.image;
  if (!image || !image.width || Math.max(image.width, image.height) <= max) return;
  const scale = max / Math.max(image.width, image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  texture.image = canvas;
  texture.needsUpdate = true;
}

export function loadTextures(onProgress) {
  const entries = Object.entries(TEXTURES);
  const loader = new THREE.TextureLoader();
  const store = {};
  let done = 0;

  const jobs = entries.map(([key, file]) => new Promise((resolve) => {
    loader.load(
      BASE + file + '.png',
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = ANISOTROPY[key] || 1;
        if (MAX_SIZE[key]) shrink(texture, MAX_SIZE[key]);
        store[key] = texture;
        done += 1;
        if (onProgress) onProgress(done, entries.length, file);
        resolve();
      },
      undefined,
      () => {
        done += 1;
        if (onProgress) onProgress(done, entries.length, file + ' (missing)');
        resolve();
      },
    );
  }));

  return Promise.all(jobs).then(() => store);
}

/** Soft round shadow sprite, generated procedurally so it needs no asset. */
export function makeBlobShadow() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(20,26,14,0.55)');
  grad.addColorStop(0.55, 'rgba(22,30,16,0.30)');
  grad.addColorStop(1, 'rgba(22,30,16,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Radial glow used for the sun and for the floating pinecone pickups. */
export function makeGlow(inner = 'rgba(255,244,200,1)', mid = 'rgba(255,206,110,0.42)') {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.28, mid);
  grad.addColorStop(1, 'rgba(255,200,90,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Tiny soft dot used for the drifting pollen particles. */
export function makePollen() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,252,225,0.95)');
  grad.addColorStop(0.45, 'rgba(255,245,190,0.45)');
  grad.addColorStop(1, 'rgba(255,240,170,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A two channel smooth noise field, used to warp the terrain's texture
 * coordinates.
 *
 * This is the anti-tiling trick. A ground texture repeating every four metres in
 * an axis aligned grid is the single most obvious tell that a landscape is
 * generated: the eye locks onto the straight seam lines and then cannot unsee
 * the repeat. Offsetting the lookup by a slowly varying vector bends those seams
 * into irregular curves, which is enough to stop the eye finding them — and it
 * costs one extra texture lookup for the whole terrain, not one per layer.
 *
 * Built from integer frequency sinusoids so it is exactly periodic: the field
 * tiles with the same period as the UVs it offsets, with no seam of its own.
 * It is a vector field, not colour, so it must not be sRGB decoded.
 */
export function makeWarpNoise(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const octaves = [
    { f: 1, g: 2, a: 0.52, phase: 0.0 },
    { f: 3, g: 1, a: 0.26, phase: 1.7 },
    { f: 2, g: 4, a: 0.14, phase: 3.1 },
    { f: 5, g: 3, a: 0.07, phase: 4.9 },
  ];
  const norm = 1 / octaves.reduce((sum, o) => sum + o.a, 0);
  for (let y = 0; y < size; y += 1) {
    const v = (y / size) * Math.PI * 2;
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * Math.PI * 2;
      let r = 0;
      let g = 0;
      for (const o of octaves) {
        r += o.a * Math.sin(o.f * u + o.phase) * Math.cos(o.g * v - o.phase);
        g += o.a * Math.cos(o.g * u - o.phase * 1.3) * Math.sin(o.f * v + o.phase * 0.7);
      }
      const i = (y * size + x) * 4;
      image.data[i] = Math.round((r * norm * 0.5 + 0.5) * 255);
      image.data[i + 1] = Math.round((g * norm * 0.5 + 0.5) * 255);
      image.data[i + 2] = 128;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}
