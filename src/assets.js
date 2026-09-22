import * as THREE from '../vendor/three.module.js';

export const TEXTURES = {
  sky: 'sky_pano',
  grass: 'ground_grass',
  dirt: 'ground_dirt',
  treePine: 'tree_pine',
  treeOak: 'tree_oak',
  treeBig: 'tree_big',
  bush: 'tree_bush',
  log: 'prop_log',
  rock: 'prop_rock',
  hut: 'prop_hut',
  pinecone: 'item_pinecone',
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
  portrait: 'portrait_xionger',
  hands: 'hands_xionger',
};

const BASE = 'assets/tex/';

// Anisotropic filtering only helps surfaces seen at a grazing angle. The billboards
// always face the camera — and their quad aspect matches the texture aspect, so
// their UV derivatives are isotropic — meaning 8x anisotropy was up to 8 texture
// taps per fragment for no visual gain, exactly where the overdraw is. The ground
// and water planes are the ones actually viewed obliquely, so they keep 4.
const ANISOTROPY = {
  grass: 4,
  dirt: 4,
  water: 4,
  bark: 2,
  cliff: 2,
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
  bark: 512,
  cliff: 512,
  sky: 1024,
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
