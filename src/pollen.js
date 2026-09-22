import * as THREE from '../vendor/three.module.js';

/**
 * Drifting pollen that is animated entirely in the vertex shader.
 *
 * The old version walked all 420 particles in JavaScript every frame and then
 * re-uploaded the position buffer. Here each particle keeps its base position and
 * a seed; the shader derives its drift from the clock, wraps the cloud around the
 * camera and pushes particles out of the lens, so a frame costs no JS at all.
 */
export function createPollenField(count, box, tex) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * box;
    positions[i * 3 + 1] = 0.6 + Math.random() * 14;
    positions[i * 3 + 2] = (Math.random() - 0.5) * box;
    seeds[i] = Math.random() * 100;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const timeUniform = { value: 0 };
  const material = new THREE.PointsMaterial({
    map: tex,
    size: 0.2,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    fog: true,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.uniforms.uBox = { value: box };
    shader.vertexShader = 'attribute float aSeed;\nuniform float uTime;\nuniform float uBox;\n'
      + shader.vertexShader.replace('#include <project_vertex>', /* glsl */`
        // drift: rise slowly, wander sideways, and loop within a 16m column
        float seed = aSeed;
        transformed.x += sin(uTime * 0.5 + seed) * 0.7;
        transformed.z += cos(uTime * 0.4 + seed * 1.3) * 0.7;
        transformed.y += mod(uTime * (0.15 + fract(seed) * 0.35) + seed, 16.0);
        transformed.y = mod(transformed.y - 0.4, 15.6) + 0.4;

        // keep the cloud wrapped around the viewer so it never runs out
        vec2 rel = transformed.xz - cameraPosition.xz;
        rel = mod(rel + uBox * 0.5, uBox) - uBox * 0.5;
        transformed.xz = cameraPosition.xz + rel;

        // and out of the lens
        vec2 near = transformed.xz - cameraPosition.xz;
        float nearLen = length(near);
        if (nearLen < 2.4) {
          transformed.xz = cameraPosition.xz + normalize(near + vec2(0.001, 0.001)) * 3.2;
        }

        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      `);
  };
  material.customProgramCacheKey = () => 'pollen';

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.matrixAutoUpdate = false;

  return {
    points,
    update(time) { timeUniform.value = time; },
  };
}
