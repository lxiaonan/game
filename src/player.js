import * as THREE from '../vendor/three.module.js';

const EYE_HEIGHT = 1.62;
const WALK_SPEED = 4.3;
const RUN_SPEED = 7.4;
const ACCEL = 26;
const FRICTION = 12;
const GRAVITY = 22;
const JUMP_SPEED = 7.2;
const WORLD_LIMIT = 126;

const ATTACK_SWING = 0.34;
const ATTACK_COOLDOWN = 0.36;
const ATTACK_REACH = 3.1;
const ATTACK_ARC = 0.62; // dot-product threshold of the swing cone

export function createPlayer(camera, scene, textures, colliders, sampleGround) {
  const groundAt = sampleGround || (() => 0);
  const position = new THREE.Vector3(2, 0, 14);
  const velocity = new THREE.Vector3();
  const state = {
    yaw: Math.PI,
    pitch: -0.02,
    bob: 0,
    bobAmount: 0,
    landing: 0,
    onGround: true,
    speed: 0,
    distanceWalked: 0,
    attacking: false,
    attackTimer: 0,
    attackCooldown: 0,
    attackLanded: false,
    stun: 0,
    shake: 0,
    inRiver: false,
    wasInRiver: false,
  };

  const pawMaterial = () => new THREE.SpriteMaterial({
    map: textures.hands, transparent: true, alphaTest: 0.12, fog: false, depthWrite: false,
  });
  const hands = new THREE.Group();
  const aspect = (textures.hands.image.width || 1) / (textures.hands.image.height || 1);
  const rightPaw = new THREE.Sprite(pawMaterial());
  rightPaw.center.set(0.5, 0.5);
  rightPaw.scale.set(0.44 * aspect, 0.44, 1);
  rightPaw.position.set(0.47, -0.62, 0);
  rightPaw.material.rotation = -0.28;
  const leftPaw = new THREE.Sprite(pawMaterial());
  leftPaw.center.set(0.5, 0.5);
  leftPaw.scale.set(-0.36 * aspect, 0.36, 1);
  leftPaw.position.set(-0.48, -0.70, 0.12);
  leftPaw.material.rotation = 0.22;
  hands.add(rightPaw, leftPaw);
  hands.position.set(0, 0, -1.12);
  hands.renderOrder = 999;
  camera.add(hands);

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  const resolveCollisions = () => {
    for (const collider of colliders) {
      const dx = position.x - collider.x;
      const dz = position.z - collider.z;
      const minDistance = collider.r + 0.42;
      const distance = Math.hypot(dx, dz);
      if (distance < minDistance && distance > 0.0001) {
        const push = (minDistance - distance) / distance;
        position.x += dx * push;
        position.z += dz * push;
      }
    }
    const radius = Math.hypot(position.x, position.z);
    if (radius > WORLD_LIMIT) {
      position.x *= WORLD_LIMIT / radius;
      position.z *= WORLD_LIMIT / radius;
    }
  };

  /** Camera bob, breathing, attack sway and hit shake. */
  const applyCamera = (dt, strafeInput, extraPitch) => {
    const bobY = Math.sin(state.bob * 2) * 0.045 * state.bobAmount;
    const bobX = Math.sin(state.bob) * 0.05 * state.bobAmount;
    const breath = Math.sin(state.bob * 0.6) * 0.012;
    const landingDip = -state.landing * 0.22;
    const stunWobble = state.stun > 0 ? Math.sin(state.stun * 26) * 0.05 : 0;

    const roll = -strafeInput * 0.035 + Math.sin(state.bob) * 0.012 * state.bobAmount + stunWobble;
    camera.rotation.set(0, 0, 0);
    // three.js cameras look down -Z, while our forward vector is (sin yaw, cos yaw)
    camera.rotateY(state.yaw + Math.PI);
    camera.rotateX(state.pitch + bobY * 0.35 + landingDip * 0.5 + extraPitch);
    camera.rotateZ(roll);

    const shakeX = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 0.14 : 0;
    const shakeY = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 0.14 : 0;
    camera.position.set(
      position.x + Math.cos(state.yaw) * bobX * 0.4 + shakeX,
      position.y + EYE_HEIGHT + bobY + breath + landingDip + shakeY + stunWobble * 0.1,
      position.z - Math.sin(state.yaw) * bobX * 0.4,
    );

    // the paws lag behind the camera a little and swing with each step
    const swayX = -strafeInput * 0.06 + Math.sin(state.bob) * 0.022 * state.bobAmount;
    const swayY = -Math.abs(Math.sin(state.bob)) * 0.03 * state.bobAmount - state.landing * 0.05;
    hands.position.set(swayX, swayY, -1.12 + Math.sin(state.bob * 2) * 0.012 * state.bobAmount);
    hands.rotation.z = Math.sin(state.bob) * 0.02 * state.bobAmount - strafeInput * 0.02;

    let rightRot = -0.28 - Math.sin(state.bob) * 0.05 * state.bobAmount;
    if (state.attacking) {
      const t = 1 - state.attackTimer / ATTACK_SWING;
      const swing = Math.sin(Math.min(1, t) * Math.PI);
      hands.rotation.z += swing * 0.45;
      rightRot -= swing * 1.5;
      rightPaw.position.x = 0.47 - swing * 1.15;
      rightPaw.position.y = -0.62 + swing * 0.34;
      rightPaw.position.z = -swing * 0.55;
      rightPaw.scale.set(0.44 * aspect * (1 + swing * 0.55), 0.44 * (1 + swing * 0.55), 1);
    } else {
      rightPaw.position.set(0.47, -0.62, 0);
      rightPaw.scale.set(0.44 * aspect, 0.44, 1);
    }
    rightPaw.material.rotation = rightRot;
    leftPaw.material.rotation = 0.22 + Math.sin(state.bob + 1.2) * 0.05 * state.bobAmount;
  };

  const update = (dt, input) => {
    state.stun = Math.max(0, state.stun - dt);
    state.shake = Math.max(0, state.shake - dt * 3.4);
    state.attackCooldown = Math.max(0, state.attackCooldown - dt);
    if (state.attacking) {
      state.attackTimer -= dt;
      if (state.attackTimer <= 0) state.attacking = false;
    }

    if (state.stun > 0) {
      const decay = Math.max(0, 1 - 9 * dt);
      velocity.x *= decay;
      velocity.z *= decay;
      position.x += velocity.x * dt;
      position.z += velocity.z * dt;
      resolveCollisions();
      state.speed = Math.hypot(velocity.x, velocity.z);
      applyCamera(dt, 0, 0);
      input.jump = false;
      return;
    }

    const running = input.run && input.forward > 0.1;
    const maxSpeed = running ? RUN_SPEED : WALK_SPEED;

    forward.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
    right.set(-forward.z, 0, forward.x);

    const wishX = forward.x * input.forward + right.x * input.strafe;
    const wishZ = forward.z * input.forward + right.z * input.strafe;
    const wishLength = Math.hypot(wishX, wishZ);
    if (wishLength > 0.001) {
      const nx = wishX / wishLength;
      const nz = wishZ / wishLength;
      velocity.x += nx * ACCEL * dt;
      velocity.z += nz * ACCEL * dt;
    } else {
      const decay = Math.max(0, 1 - FRICTION * dt);
      velocity.x *= decay;
      velocity.z *= decay;
    }

    const planar = Math.hypot(velocity.x, velocity.z);
    if (planar > maxSpeed) {
      velocity.x *= maxSpeed / planar;
      velocity.z *= maxSpeed / planar;
    }

    position.x += velocity.x * dt;
    position.z += velocity.z * dt;
    resolveCollisions();

    const floor = groundAt(position.x, position.z);
    if (!state.onGround) {
      velocity.y -= GRAVITY * dt;
      position.y += velocity.y * dt;
      if (position.y <= floor) {
        position.y = floor;
        velocity.y = 0;
        state.onGround = true;
        state.landing = 1;
      }
    } else if (input.jump) {
      velocity.y = JUMP_SPEED;
      state.onGround = false;
      state.jumpThisFrame = true;
    } else {
      // walking off a ledge (the gorge) starts a fall
      if (position.y > floor + 0.05) {
        state.onGround = false;
        velocity.y = 0;
      } else {
        position.y = floor;
      }
    }

    state.speed = Math.hypot(velocity.x, velocity.z);
    state.distanceWalked += state.speed * dt;
    state.bobAmount += (Math.min(state.speed / RUN_SPEED, 1) - state.bobAmount) * Math.min(1, dt * 6);
    state.bob += dt * (6.2 + state.speed * 1.15);
    state.landing = Math.max(0, state.landing - dt * 3.4);

    applyCamera(dt, input.strafe, 0);
    input.jump = false;
  };

  const look = (dx, dy, sensitivity) => {
    state.yaw -= dx * sensitivity;
    state.pitch -= dy * sensitivity;
    const limit = Math.PI / 2 - 0.08;
    state.pitch = Math.max(-limit, Math.min(limit, state.pitch));
  };

  /** Start a paw swipe. Returns true when the swing actually starts. */
  const attack = () => {
    if (state.attacking || state.attackCooldown > 0 || state.stun > 0) return false;
    state.attacking = true;
    state.attackTimer = ATTACK_SWING;
    state.attackCooldown = ATTACK_COOLDOWN;
    state.attackLanded = false;
    return true;
  };

  /** The moment in the swing where the paw actually connects. */
  const attackImpactReady = () => state.attacking && !state.attackLanded
    && state.attackTimer <= ATTACK_SWING * 0.62;

  const knockback = (fromX, fromZ, force) => {
    const dx = position.x - fromX;
    const dz = position.z - fromZ;
    const length = Math.hypot(dx, dz) || 1;
    velocity.x += (dx / length) * force;
    velocity.z += (dz / length) * force;
    state.shake = 1;
  };

  return {
    update,
    look,
    attack,
    attackImpactReady,
    knockback,
    position,
    state,
    hands,
    EYE_HEIGHT,
    ATTACK_REACH,
    ATTACK_ARC,
    isAttacking: () => state.attacking,
  };
}
