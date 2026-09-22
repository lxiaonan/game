import * as THREE from '../vendor/three.module.js';
import { createCharacter, syncCharacter } from './npcs.js';
import { makeGlow, makePollen } from './assets.js';
import { RIVER } from './world.js';

const BOSS_HP = 100;
const TREE_HP = 100;
const HIT_DAMAGE = 20;
const CHOP_INTERVAL = 2.6;
const CHOP_DAMAGE = 11;
const BOSS_REACH = 2.9;
const BOSS_CHARGE_SPEED = 1.9;

/**
 * The lumberjack boss fight: he chops the tree, bear two punches him.
 * Beating him saves the tree; letting the tree reach zero fails the tutorial step.
 */
export function createBossFight(scene, tex, world, audio, player, ui) {
  const home = { x: 45.6, z: 15.4 };
  const character = createCharacter(scene, tex, {
    id: 'guangtouqiang',
    name: '光头强',
    sprite: 'guangtouqiang',
    height: 2.1,
    x: home.x,
    z: home.z,
    home: 0,
    lines: [
      '臭狗熊!你敢过来?这棵树今天必须倒!',
      '别挡着我发财,不然连你一起砍!',
      '哼,有本事来打我啊,笨熊!',
    ],
    after: ['算你狠……今天不砍了,明天再说。'],
    done: ['七颗金松果都找到了?熊二你比吉吉还贼。'],
  });

  const state = {
    phase: 'idle', // idle | chopping | staggered | defeated | fleeing
    hp: BOSS_HP,
    treeHp: TREE_HP,
    chopTimer: CHOP_INTERVAL,
    staggerTimer: 0,
    chopAnim: 0,
    windup: 0,
    chargeCooldown: 0,
    hits: 0,
    tauntTimer: 6,
    flash: 0,
    active: false,
    treeFallen: false,
    lastEvent: null,
  };

  // ---------------- wood chips, hit sparks and the swing arc ----------------
  const glow = makeGlow();
  const chipTexture = makePollen();
  const CHIP_COUNT = 90;
  const chipGeo = new THREE.BufferGeometry();
  const chipPositions = new Float32Array(CHIP_COUNT * 3);
  const chipVel = [];
  const chipLife = new Float32Array(CHIP_COUNT);
  for (let i = 0; i < CHIP_COUNT; i += 1) {
    chipVel.push(new THREE.Vector3());
  }
  chipGeo.setAttribute('position', new THREE.BufferAttribute(chipPositions, 3));
  const chips = new THREE.Points(chipGeo, new THREE.PointsMaterial({
    map: chipTexture, size: 0.24, color: 0xd8b073, transparent: true, opacity: 0.95,
    depthWrite: false, sizeAttenuation: true,
  }));
  chips.frustumCulled = false;
  scene.add(chips);
  let chipCursor = 0;

  const burst = (x, y, z, count, speed) => {
    const pos = chipGeo.attributes.position;
    for (let i = 0; i < count; i += 1) {
      const index = chipCursor % CHIP_COUNT;
      chipCursor += 1;
      pos.setXYZ(index, x, y, z);
      chipVel[index].set(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.75 + 0.6,
        (Math.random() - 0.5) * speed,
      );
      chipLife[index] = 0.85 + Math.random() * 0.5;
    }
    pos.needsUpdate = true;
  };

  const spark = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: 0xfff0b0, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: true,
  }));
  spark.scale.set(2.6, 2.6, 1);
  scene.add(spark);
  let sparkLife = 0;

  // ---------------- the axe the lumberjack swings ----------------
  const swing = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: 0xffd08a, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: true,
  }));
  swing.scale.set(3.2, 3.2, 1);
  scene.add(swing);

  const baseScaleX = character.sprite.scale.x;
  const baseScaleY = character.sprite.scale.y;

  const setPhase = (phase) => {
    if (state.phase === phase) return;
    state.phase = phase;
  };

  const activate = () => {
    state.active = true;
    if (state.phase === 'idle') setPhase('chopping');
  };

  const reset = () => {
    state.hp = BOSS_HP;
    state.treeHp = TREE_HP;
    state.chopTimer = CHOP_INTERVAL;
    state.treeFallen = false;
    character.sprite.position.set(home.x, 0, home.z);
    character.sprite.visible = true;
    character.plate.visible = true;
    world.doomed.sprite.visible = true;
    world.doomed.stump.visible = false;
    world.doomed.felledTrunk.visible = false;
    world.doomed.sprite.material.rotation = 0;
    setPhase('idle');
  };

  const defeat = () => {
    setPhase('defeated');
    state.hp = 0;
    character.talked = true;
    character.lines = ['哎哟哟,别打了别打了!我认输!', '这树我不砍了还不行吗……你等着我告诉李老板去!'];
    character.after = ['熊二是吧?我记住你了。'];
    audio.fanfare();
    ui.toast('<b>光头强</b> 认输了!大树保住了');
  };

  const fellTree = () => {
    state.treeFallen = true;
    world.doomed.sprite.visible = false;
    world.doomed.stump.visible = true;
    world.doomed.felledTrunk.visible = true;
    audio.blip(160);
    state.lastEvent = 'treeFell';
  };

  /** Resolve one bear paw swing against the lumberjack. */
  const resolvePunch = () => {
    if (state.phase === 'defeated' || state.phase === 'fleeing') return false;
    const px = player.position.x;
    const pz = player.position.z;
    const dx = character.sprite.position.x - px;
    const dz = character.sprite.position.z - pz;
    const distance = Math.hypot(dx, dz);
    if (distance > player.ATTACK_REACH) return false;
    const facing = (dx / (distance || 1)) * Math.sin(player.state.yaw)
      + (dz / (distance || 1)) * Math.cos(player.state.yaw);
    if (facing < player.ATTACK_ARC) return false;
    return true;
  };

  const applyHit = () => {
    state.hp = Math.max(0, state.hp - HIT_DAMAGE);
    state.hits += 1;
    state.flash = 0.32;
    state.staggerTimer = 0.85;
    setPhase('staggered');
    state.chopTimer = Math.max(state.chopTimer, CHOP_INTERVAL * 0.85);
    const cx = character.sprite.position.x;
    const cz = character.sprite.position.z;
    burst(cx, 1.5, cz, 14, 3.4);
    spark.position.set(cx, 1.6, cz);
    sparkLife = 0.3;
    const pushX = cx - player.position.x;
    const pushZ = cz - player.position.z;
    const len = Math.hypot(pushX, pushZ) || 1;
    const eastBank = RIVER.x + RIVER.halfWidth + 1.3;
    character.sprite.position.x = Math.min(60, Math.max(eastBank, cx + (pushX / len) * 0.55));
    character.sprite.position.z = cz + (pushZ / len) * 0.55;
    audio.blip(210);
    ui.toast('<b>揍到了!</b> 光头强 ' + state.hp + ' / ' + BOSS_HP, 900);
    if (state.hp <= 0) defeat();
  };

  const update = (dt, time, playerPos, dialogueOpen) => {
    // particles
    const pos = chipGeo.attributes.position;
    for (let i = 0; i < CHIP_COUNT; i += 1) {
      if (chipLife[i] <= 0) {
        if (pos.getY(i) !== -999) pos.setY(i, -999);
        continue;
      }
      chipLife[i] -= dt;
      chipVel[i].y -= 16 * dt;
      pos.setXYZ(
        i,
        pos.getX(i) + chipVel[i].x * dt,
        Math.max(0.05, pos.getY(i) + chipVel[i].y * dt),
        pos.getZ(i) + chipVel[i].z * dt,
      );
      if (chipLife[i] <= 0) pos.setY(i, -999);
    }
    pos.needsUpdate = true;
    if (sparkLife > 0) {
      sparkLife -= dt;
      spark.material.opacity = Math.max(0, sparkLife / 0.3);
      spark.scale.setScalar(2.6 * (1 + (0.3 - sparkLife) * 2.4));
    } else {
      spark.material.opacity = 0;
    }

    syncCharacter(character, dt, playerPos);
    const sprite = character.sprite;

    // hit flash tint
    if (state.flash > 0) {
      state.flash -= dt;
      const t = Math.max(0, state.flash / 0.32);
      sprite.material.color.setRGB(1, 1 - t * 0.45, 1 - t * 0.55);
    } else if (sprite.material.color.g !== 1) {
      sprite.material.color.setRGB(1, 1, 1);
    }

    if (!state.active) {
      // idle pose before the fight starts
      sprite.scale.set(baseScaleX, baseScaleY, 1);
      return state;
    }

    if (state.phase === 'defeated') {
      // he gives up, drops the axe and jogs off towards the lumber yard
      const targetX = 66;
      const targetZ = 24;
      const dx = targetX - sprite.position.x;
      const dz = targetZ - sprite.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 1.2) {
        const step = Math.min(distance, 3.2 * dt);
        sprite.position.x += (dx / distance) * step;
        sprite.position.z += (dz / distance) * step;
        character.bob += dt * 8;
        sprite.position.y = Math.abs(Math.sin(character.bob)) * 0.1;
        sprite.scale.set(baseScaleX, baseScaleY, 1);
        sprite.material.rotation = Math.sin(character.bob) * 0.05;
      } else {
        sprite.position.y = 0;
        sprite.scale.set(baseScaleX, baseScaleY, 1);
        sprite.material.rotation = 0;
        setPhase('fleeing');
      }
      swing.material.opacity = 0;
      return state;
    }

    if (state.phase === 'fleeing') {
      sprite.scale.set(baseScaleX, baseScaleY, 1);
      return state;
    }

    if (state.staggerTimer > 0) {
      state.staggerTimer -= dt;
      const wobble = Math.sin(state.staggerTimer * 30) * 0.12;
      sprite.material.rotation = wobble;
      sprite.scale.set(baseScaleX, baseScaleY * (1 - Math.abs(wobble) * 0.3), 1);
      if (state.staggerTimer <= 0) {
        sprite.material.rotation = 0;
        sprite.scale.set(baseScaleX, baseScaleY, 1);
        setPhase('chopping');
      }
      return state;
    }
    sprite.material.rotation = 0;
    sprite.scale.set(baseScaleX, baseScaleY, 1);

    if (state.treeFallen) return state;

    // the tree dies if he is left alone with it
    state.chopTimer -= dt;
    if (state.chopTimer <= 0) {
      state.chopTimer = CHOP_INTERVAL;
      state.chopAnim = 0.5;
      state.treeHp = Math.max(0, state.treeHp - CHOP_DAMAGE);
      const treeX = world.doomed.sprite.position.x;
      const treeZ = world.doomed.sprite.position.z;
      burst(treeX, 2.2, treeZ, 10, 2.6);
      audio.blip(150);
      ui.toast('<b>光头强</b> 砍了树!大树 ' + state.treeHp + ' / ' + TREE_HP, 900);
      if (state.treeHp <= 0) fellTree();
    }

    if (state.chopAnim > 0) {
      state.chopAnim -= dt;
      const t = 1 - state.chopAnim / 0.5;
      const lean = Math.sin(t * Math.PI);
      sprite.material.rotation = lean * 0.16;
      sprite.scale.set(baseScaleX * (1 + lean * 0.06), baseScaleY * (1 - lean * 0.05), 1);
      const treeX = world.doomed.sprite.position.x;
      const treeZ = world.doomed.sprite.position.z;
      swing.position.set(treeX - 1.1 + lean, 1.7 + lean * 0.7, treeZ + 0.2);
      swing.material.opacity = lean * 0.9;
      swing.scale.setScalar(2.6 + lean * 1.4);
    } else {
      swing.material.opacity = 0;
    }

    // if the bear comes close he stops chopping and shoves back
    state.chargeCooldown = Math.max(0, state.chargeCooldown - dt);
    const toPlayer = Math.hypot(playerPos.x - sprite.position.x, playerPos.z - sprite.position.z);
    // a swing in progress has to be able to land; shoving first made the opening hit miss
    if (toPlayer < BOSS_REACH && state.chargeCooldown <= 0 && !dialogueOpen && !player.isAttacking()) {
      state.chargeCooldown = 2.4;
      player.knockback(sprite.position.x, sprite.position.z, 7.5);
      player.state.stun = 0.32;
      audio.blip(180);
      ui.toast('<b>光头强</b> 推了你一把!', 900);
    } else if (toPlayer > 4 && toPlayer < 26) {
      const dx = playerPos.x - sprite.position.x;
      const dz = playerPos.z - sprite.position.z;
      const step = Math.min(toPlayer - 3.4, BOSS_CHARGE_SPEED * dt);
      if (step > 0) {
        sprite.position.x += (dx / toPlayer) * step;
        sprite.position.z += (dz / toPlayer) * step;
        const eastBank = RIVER.x + RIVER.halfWidth + 1.3;
        if (sprite.position.x < eastBank) sprite.position.x = eastBank;
        character.bob += dt * 7;
        sprite.position.y = Math.abs(Math.sin(character.bob)) * 0.08;
      }
    }
    return state;
  };

  return {
    character,
    state,
    update,
    activate,
    reset,
    resolvePunch,
    applyHit,
    getTreeHp: () => state.treeHp,
    getHp: () => state.hp,
  };
}
