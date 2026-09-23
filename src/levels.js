import * as THREE from '../vendor/three.module.js';
import { makeGlow } from './assets.js';

/**
 * The five chapters of 狗熊岭.
 *
 * They are not a corridor. Every region of the valley is open from the first
 * second, and a chapter only decides two things: which direction the on screen
 * tracker points, and what the sky is doing. Finishing a chapter is driven by the
 * world state (the pinecones really are in your bag, the crystals really are lit),
 * never by a scripted sequence, so wandering off mid chapter cannot desync it.
 */

export const TYPE = { BOSS: 'boss', COLLECT: 'collect', LIGHT: 'light', ARENA: 'arena' };

export const LEVELS = [
  {
    id: 'lv1',
    index: 1,
    title: '抢树之战',
    type: TYPE.BOSS,
    region: 'lumberyard',
    where: '河湾伐木场',
    totem: { x: 40, z: 30 },
    marker: { x: 48, z: 13, label: '光头强砍树处' },
    brief: '光头强在河对岸砍树!过独木桥,按 F 用熊掌把他赶走,别让那棵大树倒下。',
    done: '大树保住了,狗熊岭安全了。',
    reward: '奖励:熊掌更有劲了(攻击力 +4)',
  },
  {
    id: 'lv2',
    index: 2,
    title: '金松果大搜索',
    type: TYPE.COLLECT,
    kind: 'cone',
    need: 7,
    region: 'camp',
    where: '整片狗熊岭',
    totem: { x: 8, z: 40 },
    brief: '大风把 7 颗金松果吹得满森林都是。和邻居聊聊,他们会告诉你藏在哪儿。',
    done: '7 颗金松果全部找齐啦!',
    reward: '奖励:跑得更久了(体力上限 +30)',
  },
  {
    id: 'lv3',
    index: 3,
    title: '迷雾沼泽',
    type: TYPE.COLLECT,
    kind: 'honey',
    need: 6,
    region: 'swamp',
    where: '西南迷雾沼泽',
    totem: { x: -84, z: 54 },
    brief: '沼泽里泡着 6 罐野蜂蜜。水没过脚踝,走不快,蜂巢边上还会被追着叮——小心点。',
    done: '6 罐蜂蜜到手,翠花的蜂蜜饼有着落了。',
    reward: '奖励:腿脚更利索(移动速度 +8%)',
  },
  {
    id: 'lv4',
    index: 4,
    title: '夜色高地',
    type: TYPE.LIGHT,
    need: 4,
    region: 'highland',
    where: '东北夜色高地',
    totem: { x: 96, z: -68 },
    brief: '太阳一落,高地上的 4 块晶石就熄了。走到每块晶石前按 E,把它们一一点亮。',
    done: '四块晶石全亮了,高地整夜都看得见路。',
    reward: '奖励:更结实了(生命上限 +30)',
    night: true,
  },
  {
    id: 'lv5',
    index: 5,
    title: '巨石阵试炼',
    type: TYPE.ARENA,
    need: 3,
    region: 'stones',
    where: '西边巨石阵',
    totem: { x: -44, z: -28 },
    brief: '巨石阵里有人在等你过招。站进石圈,打赢 3 波对手就算过关。',
    done: '三波对手全被打跑了,咕咕长老点了点头。',
    reward: '奖励:熊掌虎虎生风(攻击力 +6)',
  },
];

export const LEVEL_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l]));

export function createLevels({ scene, ui, audio, world, props, player, boss, arena, env, xiongdaPos, groundAt }) {
  const state = {
    introDone: false,
    activeId: null,
    order: LEVELS.map((l) => l.id),
    progress: Object.fromEntries(LEVELS.map((l) => [l.id, 0])),
    done: Object.fromEntries(LEVELS.map((l) => [l.id, false])),
    completedCount: 0,
  };

  // ---------------- world objective marker ----------------
  const marker = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffd479, transparent: true, opacity: 0.22, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.72, 14, 14, 1, true), beamMat);
  beam.position.y = 7;
  marker.add(beam);
  const glow = makeGlow();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: 0xffe0a0, transparent: true, opacity: 0.6, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  }));
  halo.scale.set(3.2, 3.2, 1);
  halo.position.y = 0.7;
  marker.add(halo);
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.85, 1.5, 4),
    new THREE.MeshBasicMaterial({ color: 0xffcf6a, transparent: true, opacity: 0.9, fog: false }),
  );
  arrow.rotation.x = Math.PI;
  arrow.position.y = 3.6;
  marker.add(arrow);
  marker.visible = false;
  scene.add(marker);

  const objective = { x: 0, z: 0, label: '熊大', show: false };

  const pointAt = (x, z, label) => {
    objective.x = x;
    objective.z = z;
    objective.label = label;
    objective.show = true;
    const y = groundAt ? groundAt(x, z) : 0;
    marker.position.set(x, y, z);
    marker.visible = true;
  };

  const activeLevel = () => (state.activeId ? LEVEL_BY_ID[state.activeId] : null);

  /** Where the tracker should point for a chapter that is not finished yet. */
  function targetFor(level) {
    if (level.type === TYPE.COLLECT) {
      const left = props.items.filter((i) => i.userData.kind === level.kind && !i.userData.collected);
      if (!left.length) return null;
      if (!player) return { x: left[0].position.x, z: left[0].position.z, label: level.title };
      const sorted = left.slice().sort((a, b) => Math.hypot(a.position.x - player.position.x, a.position.z - player.position.z)
        - Math.hypot(b.position.x - player.position.x, b.position.z - player.position.z));
      return { x: sorted[0].position.x, z: sorted[0].position.z, label: level.title };
    }
    if (level.type === TYPE.LIGHT) {
      const left = props.crystals.filter((c) => !c.userData.lit);
      if (!left.length) return null;
      const sorted = left.slice().sort((a, b) => Math.hypot(a.position.x - player.position.x, a.position.z - player.position.z)
        - Math.hypot(b.position.x - player.position.x, b.position.z - player.position.z));
      return { x: sorted[0].position.x, z: sorted[0].position.z, label: '晶石' };
    }
    return { x: level.marker.x, z: level.marker.z, label: level.marker.label };
  }

  function refreshObjective() {
    if (!state.introDone) {
      pointAt(xiongdaPos.x, xiongdaPos.z, '先去找熊大');
      return;
    }
    const level = activeLevel();
    if (!level) {
      marker.visible = false;
      objective.show = false;
      return;
    }
    const target = targetFor(level);
    if (!target) {
      marker.visible = false;
      objective.show = false;
      return;
    }
    pointAt(target.x, target.z, target.label);
  }

  function setCard(level) {
    if (!level) {
      ui.setQuestCard({ title: '自由探索', hint: '走到发光的路牌石碑前按 E,选择要做的关卡。' });
      return;
    }
    const need = level.need || 0;
    ui.setQuestCard({
      title: `第 ${level.index} 关 · ${level.title}`,
      hint: level.brief,
      progress: need ? state.progress[level.id] : undefined,
      total: need || undefined,
    });
  }

  // ---------------- starting / stopping ----------------
  function start(id) {
    const level = LEVEL_BY_ID[id];
    if (!level) return false;
    if (state.done[id]) {
      ui.toast(`<b>${level.title}</b> 已经通关啦,可以再挑战一次`, 2600);
    }
    state.activeId = id;
    state.progress[id] = level.type === TYPE.BOSS ? 0 : state.progress[id];
    env.setNight(Boolean(level.night));
    setCard(level);
    refreshObjective();
    if (level.type === TYPE.BOSS && arena) arena.stop();
    if (level.type === TYPE.ARENA) {
      arena.start();
      pointAt(level.totem.x, level.totem.z, '石圈');
    }
    audio.blip(700);
    ui.toast(`开始 <b>第 ${level.index} 关 · ${level.title}</b>`, 3000);
    return true;
  }

  function abort() {
    state.activeId = null;
    env.setNight(false);
    marker.visible = false;
    objective.show = false;
    if (arena && arena.state.active) arena.stop();
    setCard(null);
  }

  function finish(level) {
    if (state.done[level.id]) return;
    state.done[level.id] = true;
    state.completedCount += 1;
    audio.fanfare();
    ui.toast(`<b>第 ${level.index} 关 · ${level.title}</b> 通关!${level.reward || ''}`, 4800);
    ui.setLevelBoard({ levels: LEVELS, state });
    if (player && player.grantReward) player.grantReward(level.id);
    // hand the player straight on to the next unfinished chapter
    const next = LEVELS.find((l) => !state.done[l.id]);
    if (next) {
      state.activeId = next.id;
      env.setNight(Boolean(next.night));
      setCard(next);
    } else {
      state.activeId = null;
      env.setNight(false);
      setCard(null);
      if (env.win) env.win();
      ui.showWin({
        text: '五个关卡全部通关!狗熊岭的每一块石头、每一片林子你都走过了。',
        stats: {
          通关关卡: `${state.completedCount} / ${LEVELS.length}`,
          金松果: `${state.progress.lv2} / ${LEVEL_BY_ID.lv2.need}`,
          蜂蜜罐: `${state.progress.lv3} / ${LEVEL_BY_ID.lv3.need}`,
          点亮晶石: `${state.progress.lv4} / ${LEVEL_BY_ID.lv4.need}`,
        },
      });
    }
    refreshObjective();
  }

  // ---------------- progress hooks ----------------
  function onPickup(kind) {
    for (const level of LEVELS) {
      if (level.type !== TYPE.COLLECT || level.kind !== kind) continue;
      state.progress[level.id] = Math.min(level.need, state.progress[level.id] + 1);
      if (state.activeId === level.id) {
        ui.setQuestCard({
          title: `第 ${level.index} 关 · ${level.title}`,
          hint: level.brief,
          progress: state.progress[level.id],
          total: level.need,
        });
      }
      if (state.progress[level.id] >= level.need) finish(level);
      else if (state.activeId === level.id) refreshObjective();
    }
  }

  function onCrystalLit() {
    const level = LEVEL_BY_ID.lv4;
    state.progress.lv4 = props.crystals.filter((c) => c.userData.lit).length;
    if (state.activeId === level.id) {
      ui.setQuestCard({
        title: `第 ${level.index} 关 · ${level.title}`,
        hint: level.brief,
        progress: state.progress.lv4,
        total: level.need,
      });
    }
    if (state.progress.lv4 >= level.need) finish(level);
    else if (state.activeId === level.id) refreshObjective();
  }

  function onBossDefeated() {
    const level = LEVEL_BY_ID.lv1;
    if (state.activeId === level.id) finish(level);
  }

  function onArenaCleared() {
    const level = LEVEL_BY_ID.lv5;
    if (state.activeId === level.id) finish(level);
  }

  function onIntroDone() {
    if (state.introDone) return;
    state.introDone = true;
    if (!state.activeId) start('lv1');
    else refreshObjective();
  }

  const update = (dt, time, playerPos) => {
    if (marker.visible) {
      arrow.rotation.y = time * 1.6;
      arrow.position.y = 3.6 + Math.sin(time * 2.2) * 0.22;
      beamMat.opacity = 0.18 + Math.sin(time * 1.7) * 0.06;
      halo.material.opacity = 0.5 + Math.sin(time * 2.6) * 0.16;
    }
    if (state.activeId === 'lv1' && boss
      && (boss.state.phase === 'defeated' || boss.state.phase === 'fleeing')) {
      onBossDefeated();
    }
    if (state.activeId === 'lv5' && arena && arena.state.cleared && !arena.state.reported) {
      arena.state.reported = true;
      onArenaCleared();
    }
    if (state.activeId && (LEVEL_BY_ID[state.activeId].type === TYPE.COLLECT
      || LEVEL_BY_ID[state.activeId].type === TYPE.LIGHT)) {
      // retarget at most twice a second so the tracker follows the nearest one left
      if (!update.retarget || time - update.retarget > 0.5) {
        update.retarget = time;
        refreshObjective();
      }
    }
  };

  return {
    state,
    objective,
    levels: LEVELS,
    activeLevel,
    start,
    abort,
    update,
    onPickup,
    onCrystalLit,
    onBossDefeated,
    onArenaCleared,
    onIntroDone,
    refreshObjective,
    setCard,
    /** Snapshot for the level board UI and the automated test hook. */
    snapshot: () => LEVELS.map((l) => ({
      id: l.id,
      index: l.index,
      title: l.title,
      where: l.where,
      brief: l.brief,
      done: state.done[l.id],
      active: state.activeId === l.id,
      progress: state.progress[l.id],
      need: l.need || 0,
      totem: l.totem,
    })),
  };
}
