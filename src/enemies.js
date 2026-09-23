import * as THREE from '../vendor/three.module.js';
import { createCharacter, syncCharacter } from './npcs.js';
import { makeGlow } from './assets.js';
import { ARENA } from './props.js';
import { terrainHeight } from './terrain.js';

/**
 * The brawlers of the stone circle trial.
 *
 * The lumberjack fight is hand scripted because it is about the tree; these are
 * the generic version — a handful of neighbours who walk at you, shove you, and
 * fall over when the paw connects. One `enemy` record per body, one shared update
 * loop, and the wave list is data.
 */

export const WAVES = [
  [
    { id: 'monkey', name: '猴兵甲', sprite: 'monkey', height: 1.6, hp: 34, speed: 2.4, damage: 6 },
    { id: 'monkey', name: '猴兵乙', sprite: 'monkey', height: 1.55, hp: 34, speed: 2.6, damage: 6 },
  ],
  [
    { id: 'squirrel', name: '松鼠兵', sprite: 'squirrel', height: 1.3, hp: 26, speed: 3.3, damage: 5 },
    { id: 'squirrel', name: '松鼠兵', sprite: 'squirrel', height: 1.3, hp: 26, speed: 3.1, damage: 5 },
    { id: 'monkey', name: '猴兵丙', sprite: 'monkey', height: 1.5, hp: 30, speed: 2.7, damage: 6 },
  ],
  [
    { id: 'bear', name: '黑熊王', sprite: 'xiongda', height: 3.6, hp: 110, speed: 2.1, damage: 13 },
    { id: 'monkey', name: '猴兵丁', sprite: 'monkey', height: 1.6, hp: 34, speed: 2.5, damage: 6 },
  ],
];

const ATTACK_COOLDOWN = 1.35;
const HIT_FLASH = 0.28;

export function createArena(scene, tex, { ui, audio, player }) {
  const glow = makeGlow();
  const list = [];
  const state = {
    active: false,
    wave: 0,
    totalWaves: WAVES.length,
    cleared: false,
    alive: 0,
    justClearedWave: false,
    reported: false,
  };

  const spark = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: 0xfff0b0, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: true,
  }));
  spark.scale.set(2.8, 2.8, 1);
  scene.add(spark);
  let sparkLife = 0;

  function spawn(data, index, count) {
    const angle = (index / Math.max(1, count)) * Math.PI * 2 + state.wave;
    const radius = ARENA.r - 2.5;
    const x = ARENA.x + Math.cos(angle) * radius;
    const z = ARENA.z + Math.sin(angle) * radius;
    const character = createCharacter(scene, tex, {
      ...data,
      x,
      z,
      home: 0,
      lines: ['来啊,熊二!'],
      after: ['……'],
      done: ['……'],
    });
    character.sprite.position.y = terrainHeight(x, z);
    const enemy = {
      data,
      character,
      hp: data.hp,
      maxHp: data.hp,
      cooldown: 0.6 + Math.random() * 0.6,
      flash: 0,
      stagger: 0,
      dead: false,
      grow: 0.35,
      baseScale: { x: character.sprite.scale.x, y: character.sprite.scale.y },
      spawnedAt: state.wave,
    };
    list.push(enemy);
    state.alive += 1;
    character.sprite.scale.set(enemy.baseScale.x * enemy.grow, enemy.baseScale.y * enemy.grow, 1);
    return enemy;
  }

  function startWave(wave) {
    state.wave = wave;
    state.justClearedWave = false;
    const defs = WAVES[wave];
    if (!defs) return false;
    defs.forEach((data, index) => spawn(data, index, defs.length));
    ui.toast(`第 <b>${wave + 1}</b> / ${WAVES.length} 波来了!`, 2600);
    audio.blip(320 + wave * 60);
    return true;
  }

  const start = () => {
    for (const enemy of list) remove(enemy);
    list.length = 0;
    state.active = true;
    state.cleared = false;
    state.reported = false;
    state.alive = 0;
    startWave(0);
  };

  const stop = () => {
    state.active = false;
    for (const enemy of list) {
      enemy.character.sprite.visible = false;
      enemy.character.plate.visible = false;
      enemy.character.shadow.visible = false;
    }
    list.length = 0;
    state.alive = 0;
  };

  function remove(enemy) {
    enemy.character.sprite.visible = false;
    enemy.character.plate.visible = false;
    enemy.character.shadow.visible = false;
    enemy.dead = true;
  }

  function hit(enemy, damage) {
    enemy.hp -= damage;
    enemy.flash = HIT_FLASH;
    enemy.stagger = 0.42;
    spark.position.copy(enemy.character.sprite.position);
    spark.position.y += 1.4;
    sparkLife = 0.28;
    audio.blip(220);
    if (enemy.hp <= 0) {
      remove(enemy);
      state.alive -= 1;
      audio.blip(150);
      ui.toast(`打跑了 <b>${enemy.data.name}</b>`, 1100);
    }
  }

  /**
   * Resolve the paw swing against every brawler in the cone. Returns how many
   * were hit so the caller can decide whether the swing "connected".
   */
  const resolveSwing = (damage) => {
    if (!state.active) return 0;
    let hits = 0;
    for (const enemy of list) {
      if (enemy.dead) continue;
      const dx = enemy.character.sprite.position.x - player.position.x;
      const dz = enemy.character.sprite.position.z - player.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > player.ATTACK_REACH + 0.6) continue;
      const facing = (dx / (distance || 1)) * Math.sin(player.state.yaw)
        + (dz / (distance || 1)) * Math.cos(player.state.yaw);
      if (facing < player.ATTACK_ARC - 0.2) continue;
      hit(enemy, damage);
      enemy.character.sprite.position.x += (dx / (distance || 1)) * 0.5;
      enemy.character.sprite.position.z += (dz / (distance || 1)) * 0.5;
      hits += 1;
    }
    return hits;
  };

  /**
   * Hit whatever is standing near a point — used by thrown stones, which do not
   * have a facing cone to test against.
   */
  const hitNear = (x, z, radius, damage) => {
    if (!state.active) return 0;
    let hits = 0;
    for (const enemy of list) {
      if (enemy.dead) continue;
      const d = Math.hypot(enemy.character.sprite.position.x - x, enemy.character.sprite.position.z - z);
      if (d > radius) continue;
      hit(enemy, damage);
      hits += 1;
    }
    return hits;
  };

  const update = (dt, time, playerPos) => {
    if (sparkLife > 0) {
      sparkLife -= dt;
      spark.material.opacity = Math.max(0, sparkLife / 0.28);
      spark.scale.setScalar(2.8 * (1 + (0.28 - sparkLife) * 3));
    } else {
      spark.material.opacity = 0;
    }
    if (!state.active) return state;

    for (const enemy of list) {
      if (enemy.dead) continue;
      const sprite = enemy.character.sprite;
      // scale up out of the ground instead of popping into existence
      if (enemy.grow < 1) {
        enemy.grow = Math.min(1, enemy.grow + dt * 2.4);
        sprite.scale.set(
          enemy.baseScale.x * enemy.grow,
          enemy.baseScale.y * (0.5 + enemy.grow * 0.5),
          1,
        );
      }

      if (enemy.flash > 0) {
        enemy.flash -= dt;
        const t = Math.max(0, enemy.flash / HIT_FLASH);
        sprite.material.color.setRGB(1, 1 - t * 0.5, 1 - t * 0.6);
      } else if (sprite.material.color.g !== 1) {
        sprite.material.color.setRGB(1, 1, 1);
      }

      if (enemy.stagger > 0) {
        enemy.stagger -= dt;
        sprite.material.rotation = Math.sin(enemy.stagger * 34) * 0.14;
        syncCharacter(enemy.character, dt, playerPos);
        continue;
      }
      sprite.material.rotation = 0;

      const dx = playerPos.x - sprite.position.x;
      const dz = playerPos.z - sprite.position.z;
      const distance = Math.hypot(dx, dz) || 1;

      enemy.cooldown -= dt;
      if (distance > 2.2) {
        const step = Math.min(distance - 2.0, enemy.data.speed * dt);
        sprite.position.x += (dx / distance) * step;
        sprite.position.z += (dz / distance) * step;
        enemy.character.bob += dt * 8;
        sprite.position.y = terrainHeight(sprite.position.x, sprite.position.z)
          + Math.abs(Math.sin(enemy.character.bob)) * 0.1;
      } else if (enemy.cooldown <= 0 && !player.state.rolling) {
        enemy.cooldown = ATTACK_COOLDOWN;
        player.hurt(enemy.data.damage, sprite.position.x, sprite.position.z);
        audio.blip(170);
      }
      syncCharacter(enemy.character, dt, playerPos);
    }

    if (state.alive === 0 && !state.justClearedWave) {
      state.justClearedWave = true;
      if (state.wave + 1 < WAVES.length) {
        state.wave += 1;
        startWave(state.wave);
      } else {
        state.cleared = true;
        state.active = false;
        ui.toast('巨石阵试炼 <b>通过</b>!', 3200);
        audio.fanfare();
      }
    }
    return state;
  };

  return { state, list, start, stop, update, resolveSwing, hitNear, getAlive: () => state.alive };
}
