import * as THREE from '../vendor/three.module.js';

/**
 * A field of upright, camera facing quads drawn as one InstancedMesh per texture.
 *
 * The forest used to be ~870 separate THREE.Sprite objects. Each sprite is its
 * own draw call, and each one re-wrote its scale on the CPU every frame to sway.
 * That saturated the main thread long before the GPU was full. Here the quads are
 * instanced, and both the billboarding and the sway happen in the vertex shader:
 *
 *   - billboarding is done by offsetting the vertex in view space, which is what
 *     THREE.Sprite does internally, so the look is identical;
 *   - sway scales the quad about its bottom centre, from a per instance phase;
 *   - instances past the fog distance collapse to a degenerate vertex, so fully
 *     fogged trees cost nothing to rasterise.
 *
 * `mirror` is off by default, and that is deliberate. The sprite shader sizes a
 * sprite with length(modelMatrix[0].xyz), so the negative x scale that placeSprite
 * used for mirrored trees never actually flipped anything: every billboard in the
 * old forest was drawn un-mirrored. Honouring it here would visibly flip half the
 * trees, which is not what optimising the renderer should do. Pass mirror: true to
 * get the variety the original code was reaching for.
 */
export function createBillboardField({ mirror = false } = {}) {
  const groups = new Map(); // texture -> entry list
  const materials = new Map(); // texture.uuid|alphaTest -> material
  const timeUniform = { value: 0 };
  const cullUniform = { value: 300 };
  const meshes = [];

  /**
   * Queue one quad. Height is the on-screen height in metres; width defaults to
   * the texture's aspect ratio so the art is never stretched.
   */
  function add(texture, opts) {
    const image = texture.image || { width: 1, height: 1 };
    const aspect = (image.width || 1) / (image.height || 1);
    const height = opts.height;
    let list = groups.get(texture);
    if (!list) {
      list = [];
      groups.set(texture, list);
    }
    list.push({
      x: opts.x,
      y: opts.y === undefined ? 0 : opts.y,
      z: opts.z,
      w: opts.width === undefined ? height * aspect : opts.width,
      h: height,
      mirror: Boolean(opts.mirror),
      phase: opts.phase === undefined ? 0 : opts.phase,
      amp: opts.amp === undefined ? 0 : opts.amp,
      alphaTest: opts.alphaTest === undefined ? 0.42 : opts.alphaTest,
    });
  }

  function materialFor(texture, alphaTest) {
    const key = texture.uuid + '|' + alphaTest;
    const cached = materials.get(key);
    if (cached) return cached;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: false,
      alphaTest,
      fog: true,
      depthWrite: true,
      side: THREE.FrontSide,
    });

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeUniform;
      shader.uniforms.uCullFar = cullUniform;
      shader.vertexShader = 'attribute vec3 aSway;\nuniform float uTime;\nuniform float uCullFar;\n'
        + shader.vertexShader.replace('#include <project_vertex>', /* glsl */`
          vec3 bbPos = instanceMatrix[3].xyz;
          vec2 bbScale = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
          vec4 mvPosition = vec4(0.0, 0.0, -1.0, 1.0);
          if (distance(bbPos, cameraPosition) > uCullFar) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          } else {
            float bbSway = 1.0 + sin(uTime * 0.9 + aSway.x) * aSway.y;
            mvPosition = viewMatrix * vec4(bbPos, 1.0);
            mvPosition.xy += vec2(
              position.x * bbScale.x * aSway.z * bbSway,
              position.y * bbScale.y * bbSway
            );
            gl_Position = projectionMatrix * mvPosition;
          }
        `);
    };
    // All these materials compile the same program, so let three.js reuse it.
    material.customProgramCacheKey = () => 'billboard';
    materials.set(key, material);
    return material;
  }

  /** Turn everything queued so far into instanced meshes added to `scene`. */
  function build(scene) {
    for (const [texture, list] of groups) {
      if (!list.length) continue;

      // A texture can be used with more than one alphaTest (solid trees vs soft
      // props), and each bucket needs its own instanced attributes.
      const buckets = new Map();
      for (const entry of list) {
        let bucket = buckets.get(entry.alphaTest);
        if (!bucket) {
          bucket = [];
          buckets.set(entry.alphaTest, bucket);
        }
        bucket.push(entry);
      }

      for (const [alphaTest, entries] of buckets) {
        const geometry = new THREE.PlaneGeometry(1, 1);
        geometry.translate(0, 0.5, 0); // pivot at the bottom centre
        const sway = new Float32Array(entries.length * 3);
        const matrix = new THREE.Matrix4();
        const mesh = new THREE.InstancedMesh(geometry, materialFor(texture, alphaTest), entries.length);
        entries.forEach((entry, i) => {
          matrix.makeScale(entry.w, entry.h, 1);
          matrix.setPosition(entry.x, entry.y, entry.z);
          mesh.setMatrixAt(i, matrix);
          sway[i * 3] = entry.phase;
          sway[i * 3 + 1] = entry.amp;
          sway[i * 3 + 2] = mirror && entry.mirror ? -1 : 1;
        });
        mesh.instanceMatrix.needsUpdate = true;
        geometry.setAttribute('aSway', new THREE.InstancedBufferAttribute(sway, 3));
        // Instances are spread over the whole valley, so the mesh bounding sphere
        // is always on screen; per instance culling happens in the shader instead.
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        scene.add(mesh);
        meshes.push(mesh);
      }
      list.length = 0;
    }
    return meshes.length;
  }

  /** Push the animation clock; the shader does the rest. */
  function update(time) {
    timeUniform.value = time;
  }

  /** Quads further than this from the camera are collapsed away. */
  function setCullFar(distance) {
    cullUniform.value = distance;
  }

  return { add, build, update, setCullFar, get meshes() { return meshes; } };
}
