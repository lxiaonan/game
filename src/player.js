import * as THREE from '../vendor/three.module.js';
import { isInSwampWater, groundHeightAt } from './terrain.js';

const EYE_HEIGHT = 1.62;
const CROUCH_HEIGHT = 1.02;
const WALK_SPEED = 4.3;
const RUN_SPEED = 7.6;
const CROUCH_SPEED = 2.1;
const WADE_SPEED = 2.6;
const ACCEL = 26;
const FRICTION = 12;
const GRAVITY = 22;
const JUMP_SPEED = 7.2;
const WORLD_LIMIT = 205;

const STAMINA_MAX = 100;
const SPRINT_DRAIN = 21;
const ROLL_COST = 20;
const STAMINA_REGEN = 19;
const STAMINA_DELAY = 0.55;

const ROLL_TIME = 0.42;
const ROLL_IFRAMES = 0.34;
const ROLL_SPEED = 12.5;
const ROLL_COOLDOWN = 0.55;

/** Three swing combo: two quick jabs and a heavy finisher. */
const COMBO = [
  { swing: 0.28, hitAt: 0.62, reach: 3.1, arc: 0.6, damage: 15 },
  { swing: 0.28, hitAt: 0.62, reach: 3.1, arc: 0.6, damage: 16 },
  { swing: 0.42, hitAt: 0.55, reach: 3.7, arc: 0.34, damage: 32 },
];
const COMBO_WINDOW = 0.6;
const COMBO_COOLDOWN = 0.22;
const ATTACK_REACH = 3.1;
const ATTACK_ARC = 0.6;

const THROW_COOLDOWN = 0.65;
const THROW_SPEED = 19;
const THROW_LIFE = 3.2;
const PROJECTILE_COUNT = 12;

export function createPlayer(camera, scene, textures, colliders, sampleGround) {
  const groundAt = sampleGround || groundHeightAt;
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
    attackIndex: 0,
    comboWindow: 0,
    stun: 0,
    shake: 0,
    inRiver: false,
    wasInRiver: false,
    crouching: false,
    rolling: false,
    rollTimer: 0,
    rollCooldown: 0,
    invuln: 0,
    hp: 100,
    maxHp: 100,
    stamina: STAMINA_MAX,
    staminaMax: STAMINA_MAX,
    staminaHold: 0,
    wading: false,
    throwCooldown: 0,
    damageBonus: 0,
    speedBonus: 0,
    hurtFlash: 0,
    lastHurt: 99,
    hitsTaken: 0,
    downs: 0,
  };

  // ------------------------------------------------------------------ paws
  // Left and right are separate textures now. They used to be two sprites
  // sharing one image that itself contained both paws, which is why the bear
  // appeared to have four hands — and why the matte kept only the bigger blob.
  const pawMaterial = (map) => new THREE.SpriteMaterial({
    map, transparent: true, alphaTest: 0.1, fog: false, depthWrite: false,
  });
  const hands = new THREE.Group();
  const aspectOf = (texture) => {
    const image = texture && texture.image ? texture.image : { width: 1, height: 1 };
    return (image.width || 1) / (image.height || 1);
  };
  const rightTex = textures.handRight || textures.hands;
  const leftTex = textures.handLeft || textures.hands;
  const rightAspect = aspectOf(rightTex);
  const leftAspect = aspectOf(leftTex);

  const RIGHT = { x: 0.47, y: -1.02, z: -1.0, h: 0.9, rot: -0.24 };
  const LEFT = { x: -0.5, y: -1.08, z: -0.92, h: 0.84, rot: 0.3 };

  const rightPaw = new THREE.Sprite(pawMaterial(rightTex));
  rightPaw.center.set(0.5, 0.06);
  rightPaw.position.set(RIGHT.x, RIGHT.y, RIGHT.z);
  rightPaw.scale.set(RIGHT.h * rightAspect, RIGHT.h, 1);
  rightPaw.material.rotation = RIGHT.rot;

  const leftPaw = new THREE.Sprite(pawMaterial(leftTex));
  leftPaw.center.set(0.5, 0.06);
  leftPaw.position.set(LEFT.x, LEFT.y, LEFT.z);
  leftPaw.scale.set(LEFT.h * leftAspect, LEFT.h, 1);
  leftPaw.material.rotation = LEFT.rot;

  hands.add(rightPaw, leftPaw);
  hands.position.set(0, 0, 0);
  hands.renderOrder = 999;
  camera.add(hands);

  // ------------------------------------------------------------------ throwing
  const stoneTexture = textures.pinecone;
  const projectiles = [];
  for (let i = 0; i < PROJECTILE_COUNT; i += 1) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: stoneTexture, transparent: true, alphaTest: 0.2, depthWrite: false, fog: true,
    }));
    sprite.scale.set(0.34, 0.34, 1);
    sprite.visible = false;
    scene.add(sprite);
    projectiles.push({ sprite, live: false, life: 0, velocity: new THREE.Vector3() });
  }
  let projectileCursor = 0;

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  const resolveCollisions = () => {
    for (const collider of colliders) {
      if (!collider) continue;
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

  /** Camera bob, breathing, roll tuck, hit shake and the paw animation. */
  const applyCamera = (dt, strafeInput, extraPitch) => {
    const bobY = Math.sin(state.bob * 2) * 0.045 * state.bobAmount;
    const bobX = Math.sin(state.bob) * 0.05 * state.bobAmount;
    const breath = Math.sin(state.bob * 0.6) * 0.012;
    const landingDip = -state.landing * 0.22;
    const stunWobble = state.stun > 0 ? Math.sin(state.stun * 26) * 0.05 : 0;
    const crouchDip = state.crouching ? -(EYE_HEIGHT - CROUCH_HEIGHT) : 0;
    const rollDip = state.rolling ? -state.rollTimer * 0.35 : 0;

    const rollTilt = state.rolling ? Math.sin((1 - state.rollTimer / ROLL_TIME) * Math.PI) * 0.5 : 0;
    const roll = -strafeInput * 0.035 + Math.sin(state.bob) * 0.012 * state.bobAmount
      + stunWobble + rollTilt;
    camera.rotation.set(0, 0, 0);
    // three.js cameras look down -Z, while our forward vector is (sin yaw, cos yaw)
    camera.rotateY(state.yaw + Math.PI);
    camera.rotateX(state.pitch + bobY * 0.35 + landingDip * 0.5 + extraPitch + rollDip * 0.2);
    camera.rotateZ(roll);

    const hurt = state.hurtFlash > 0 ? state.hurtFlash * 0.05 : 0;
    const shakeX = (state.shake > 0 ? (Math.random() - 0.5) * state.shake * 0.14 : 0) + hurt;
    const shakeY = (state.shake > 0 ? (Math.random() - 0.5) * state.shake * 0.14 : 0) - hurt;
    camera.position.set(
      position.x + Math.cos(state.yaw) * bobX * 0.4 + shakeX,
      position.y + (state.crouching ? CROUCH_HEIGHT : EYE_HEIGHT) + bobY + breath + landingDip
        + shakeY + stunWobble * 0.1 + rollDip,
      position.z - Math.sin(state.yaw) * bobX * 0.4,
    );

    // ---------------- paw pose ----------------
    const swayX = -strafeInput * 0.07 + Math.sin(state.bob) * 0.026 * state.bobAmount;
    const swayY = -Math.abs(Math.sin(state.bob)) * 0.035 * state.bobAmount - state.landing * 0.05;
    const tuck = state.rolling ? Math.sin((1 - state.rollTimer / ROLL_TIME) * Math.PI) : 0;
    hands.position.set(
      swayX * (1 - tuck),
      swayY - tuck * 0.35,
      tuck * 0.2,
    );
    hands.rotation.z = Math.sin(state.bob) * 0.02 * state.bobAmount - strafeInput * 0.02 - tuck * 0.4;

    const walkSwing = Math.sin(state.bob) * 0.09 * state.bobAmount;
    let rightRot = RIGHT.rot - walkSwing;
    let leftRot = LEFT.rot + walkSwing;
    let rightScale = 1;
    let leftScale = 1;
    let rightPos = { x: RIGHT.x, y: RIGHT.y, z: RIGHT.z };
    let leftPos = { x: LEFT.x, y: LEFT.y, z: LEFT.z };

    if (state.attacking) {
      const spec = COMBO[state.attackIndex] || COMBO[0];
      const t = Math.min(1, 1 - state.attackTimer / spec.swing);
      const swing = Math.sin(t * Math.PI);
      const heavy = state.attackIndex === 2;
      if (state.attackIndex % 2 === 0) {
        rightRot -= swing * (heavy ? 2.0 : 1.5);
        rightPos.x = RIGHT.x - swing * (heavy ? 1.5 : 1.15);
        rightPos.y = RIGHT.y + swing * (heavy ? 0.5 : 0.34);
        rightPos.z = RIGHT.z - swing * 0.55;
        rightScale = 1 + swing * (heavy ? 0.8 : 0.5);
        leftPos.y = LEFT.y + swing * 0.12;
      } else {
        leftRot += swing * 1.5;
        leftPos.x = LEFT.x + swing * 1.15;
        leftPos.y = LEFT.y + swing * 0.34;
        leftPos.z = LEFT.z - swing * 0.55;
        leftScale = 1 + swing * 0.5;
        rightPos.y = RIGHT.y + swing * 0.12;
      }
      hands.rotation.z += swing * (heavy ? 0.5 : 0.3);
    } else if (state.throwCooldown > THROW_COOLDOWN - 0.25) {
      // the throwing arm whips forward
      const t = (THROW_COOLDOWN - state.throwCooldown) / 0.25;
      const swing = Math.sin(Math.min(1, t) * Math.PI);
      rightRot -= swing * 1.9;
      rightPos.x = RIGHT.x - swing * 0.5;
      rightPos.y = RIGHT.y + swing * 0.7;
      rightPos.z = RIGHT.z - swing * 0.7;
    }

    rightPaw.position.set(rightPos.x, rightPos.y, rightPos.z);
    leftPaw.position.set(leftPos.x, leftPos.y, leftPos.z);
    rightPaw.scale.set(RIGHT.h * rightAspect * rightScale, RIGHT.h * rightScale, 1);
    leftPaw.scale.set(LEFT.h * leftAspect * leftScale, LEFT.h * leftScale, 1);
    rightPaw.material.rotation = rightRot;
    leftPaw.material.rotation = leftRot + Math.sin(state.bob + 1.2) * 0.05 * state.bobAmount;
  };

  const update = (dt, input) => {
    state.stun = Math.max(0, state.stun - dt);
    state.shake = Math.max(0, state.shake - dt * 3.4);
    state.attackCooldown = Math.max(0, state.attackCooldown - dt);
    state.comboWindow = Math.max(0, state.comboWindow - dt);
    state.throwCooldown = Math.max(0, state.throwCooldown - dt);
    state.rollCooldown = Math.max(0, state.rollCooldown - dt);
    state.invuln = Math.max(0, state.invuln - dt);
    state.hurtFlash = Math.max(0, state.hurtFlash - dt * 3);
    state.lastHurt += dt;

    if (state.attacking) {
      state.attackTimer -= dt;
      if (state.attackTimer <= 0) {
        state.attacking = false;
        state.comboWindow = COMBO_WINDOW;
        state.attackIndex = (state.attackIndex + 1) % COMBO.length;
      }
    } else if (state.comboWindow <= 0) {
      state.attackIndex = 0;
    }

    if (state.rolling) {
      state.rollTimer -= dt;
      if (state.rollTimer <= 0) state.rolling = false;
    }

    // ---------------- projectiles (they keep flying while you are stunned) ----------------
    for (const shot of projectiles) {
      if (!shot.live) continue;
      shot.life -= dt;
      shot.velocity.y -= GRAVITY * 0.55 * dt;
      shot.sprite.position.addScaledVector(shot.velocity, dt);
      shot.sprite.material.rotation += dt * 9;
      const floor = groundAt(shot.sprite.position.x, shot.sprite.position.z);
      if (shot.life <= 0 || shot.sprite.position.y <= floor + 0.12) {
        shot.live = false;
        shot.sprite.visible = false;
      }
    }

    // ---------------- stamina ----------------
    state.staminaHold = Math.max(0, state.staminaHold - dt);
    if (state.staminaHold <= 0 && state.stamina < state.staminaMax) {
      state.stamina = Math.min(state.staminaMax, state.stamina + STAMINA_REGEN * dt);
    }

    // ---------------- health regen out of combat ----------------
    if (state.lastHurt > 6 && state.hp > 0 && state.hp < state.maxHp) {
      state.hp = Math.min(state.maxHp, state.hp + 6 * dt);
    }

    state.crouching = Boolean(input.crouch) && !state.rolling;

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

    // ---------------- dodge roll ----------------
    if (input.roll) {
      input.roll = false;
      if (!state.rolling && state.rollCooldown <= 0 && state.onGround
        && state.stamina >= ROLL_COST) {
        state.rolling = true;
        state.rollTimer = ROLL_TIME;
        state.rollCooldown = ROLL_COOLDOWN + ROLL_TIME;
        state.invuln = ROLL_IFRAMES;
        state.stamina -= ROLL_COST;
        state.staminaHold = STAMINA_DELAY;
        state.attacking = false;
        const wishX = Math.sin(state.yaw) * (input.forward || 1);
        const wishZ = Math.cos(state.yaw) * (input.forward || 1);
        const len = Math.hypot(wishX, wishZ) || 1;
        velocity.x = (wishX / len) * ROLL_SPEED;
        velocity.z = (wishZ / len) * ROLL_SPEED;
      }
    }

    if (state.rolling) {
      const decay = Math.max(0, 1 - 4.5 * dt);
      velocity.x *= decay;
      velocity.z *= decay;
      position.x += velocity.x * dt;
      position.z += velocity.z * dt;
      resolveCollisions();
      fallStep(dt, input);
      applyCamera(dt, 0, 0);
      input.jump = false;
      return;
    }

    // ---------------- throwing ----------------
    if (input.throw) {
      input.throw = false;
      if (state.throwCooldown <= 0 && state.hp > 0) {
        state.throwCooldown = THROW_COOLDOWN;
        launchProjectile();
      }
    }

    // ---------------- movement ----------------
    const wading = isInSwampWater(position.x, position.z);
    state.wading = wading;
    const wantsRun = Boolean(input.run) && input.forward > 0.1 && !state.crouching && state.stamina > 1;
    let maxSpeed = state.crouching ? CROUCH_SPEED : wantsRun ? RUN_SPEED : WALK_SPEED;
    if (wading) maxSpeed = Math.min(maxSpeed, WADE_SPEED);
    maxSpeed *= 1 + state.speedBonus;

    if (wantsRun) {
      state.stamina = Math.max(0, state.stamina - SPRINT_DRAIN * dt);
      state.staminaHold = STAMINA_DELAY;
    }

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
    fallStep(dt, input);

    state.speed = Math.hypot(velocity.x, velocity.z);
    state.distanceWalked += state.speed * dt;
    state.bobAmount += (Math.min(state.speed / RUN_SPEED, 1) - state.bobAmount) * Math.min(1, dt * 6);
    state.bob += dt * (6.2 + state.speed * 1.15);
    state.landing = Math.max(0, state.landing - dt * 3.4);

    applyCamera(dt, input.strafe, 0);
    input.jump = false;
  };

  /** Gravity, landing and walking off a ledge (the gorge). */
  function fallStep(dt, input) {
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
    } else if (position.y > floor + 0.06) {
      state.onGround = false;
      velocity.y = 0;
    } else {
      position.y = floor;
    }
  }

  function launchProjectile() {
    const shot = projectiles[projectileCursor % PROJECTILE_COUNT];
    projectileCursor += 1;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    shot.sprite.position.copy(camera.position).addScaledVector(dir, 0.5);
    shot.velocity.copy(dir).multiplyScalar(THROW_SPEED);
    shot.velocity.y += 3.4;
    shot.life = THROW_LIFE;
    shot.live = true;
    shot.sprite.visible = true;
  }

  const look = (dx, dy, sensitivity) => {
    state.yaw -= dx * sensitivity;
    state.pitch -= dy * sensitivity;
    const limit = Math.PI / 2 - 0.08;
    state.pitch = Math.max(-limit, Math.min(limit, state.pitch));
  };

  /** Start the next swing of the combo. Returns true when a swing starts. */
  const attack = () => {
    if (state.attacking || state.attackCooldown > 0 || state.stun > 0 || state.rolling) return false;
    if (state.hp <= 0) return false;
    state.attacking = true;
    const spec = comboSpec();
    state.attackTimer = spec.swing;
    state.attackCooldown = COMBO_COOLDOWN;
    state.attackLanded = false;
    return true;
  };

  const comboSpec = () => COMBO[state.attacking ? state.attackIndex : state.attackIndex % COMBO.length];

  /** The moment in the swing where the paw actually connects. */
  const attackImpactReady = () => {
    if (!state.attacking || state.attackLanded) return false;
    const spec = COMBO[state.attackIndex] || COMBO[0];
    return state.attackTimer <= spec.swing * (1 - spec.hitAt) + 0.0001;
  };

  /** Damage of the swing that is currently in the air. */
  const attackDamage = () => (COMBO[state.attackIndex] || COMBO[0]).damage + state.damageBonus;

  const currentReach = () => (COMBO[state.attackIndex] || COMBO[0]).reach;
  const currentArc = () => (COMBO[state.attackIndex] || COMBO[0]).arc;

  const knockback = (fromX, fromZ, force) => {
    const dx = position.x - fromX;
    const dz = position.z - fromZ;
    const length = Math.hypot(dx, dz) || 1;
    velocity.x += (dx / length) * force;
    velocity.z += (dz / length) * force;
    state.shake = 1;
  };

  /** Take a hit. Rolling grants i-frames; at zero health the bear is carried home. */
  const hurt = (amount, fromX, fromZ) => {
    if (state.invuln > 0 || state.hp <= 0) return false;
    state.hp = Math.max(0, state.hp - amount);
    state.hitsTaken += 1;
    state.lastHurt = 0;
    state.hurtFlash = 1;
    state.shake = 1;
    if (fromX !== undefined) knockback(fromX, fromZ, 5.5);
    if (state.hp <= 0) {
      state.downs += 1;
      state.stun = 1.2;
    }
    return true;
  };

  const revive = () => {
    state.hp = state.maxHp;
    state.stamina = state.staminaMax;
    state.stun = 0;
    state.invuln = 1.6;
  };

  const teleport = (x, z, yaw) => {
    position.set(x, groundAt(x, z), z);
    velocity.set(0, 0, 0);
    state.onGround = true;
    if (yaw !== undefined) state.yaw = yaw;
  };

  /** Permanent upgrades handed out by the level system. */
  const grantReward = (levelId) => {
    if (levelId === 'lv1') state.damageBonus += 4;
    if (levelId === 'lv2') state.staminaMax += 30;
    if (levelId === 'lv3') state.speedBonus += 0.08;
    if (levelId === 'lv4') { state.maxHp += 30; state.hp = state.maxHp; }
    if (levelId === 'lv5') state.damageBonus += 6;
  };

  return {
    update,
    look,
    attack,
    attackImpactReady,
    attackDamage,
    currentReach,
    currentArc,
    knockback,
    hurt,
    revive,
    teleport,
    grantReward,
    position,
    velocity,
    state,
    hands,
    projectiles,
    EYE_HEIGHT,
    CROUCH_HEIGHT,
    ATTACK_REACH,
    ATTACK_ARC,
    isAttacking: () => state.attacking,
  };
}
