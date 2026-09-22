import * as THREE from '../vendor/three.module.js';
import { makeGlow } from './assets.js';
import { RIVER, DOOMED_TREE } from './world.js';

export const STAGES = {
  intro: {
    title: '新手任务 1 · 找熊大',
    hint: '走进营地找熊大,他有急事找你。',
    bark: '先去找熊大',
  },
  bridge: {
    title: '新手任务 2 · 走过独木桥',
    hint: '沿小路一路向东,踩着独木桥过河。桥很窄,小心别掉下去!',
    bark: '走过独木桥',
  },
  fight: {
    title: '新手任务 3 · 阻止光头强',
    hint: '按 F 用熊掌拍他,把他赶走。别让他把那棵大树砍倒!',
    bark: '揍光头强',
  },
  report: {
    title: '新手任务 4 · 回去报喜',
    hint: '大树保住了,回营地告诉熊大这个好消息。',
    bark: '回去找熊大',
  },
  cones: {
    title: '任务 · 寻找金松果',
    hint: '和邻居们聊聊,他们会告诉你金松果藏在哪儿。',
    bark: '寻找金松果',
  },
  done: {
    title: '任务完成',
    hint: '森林又恢复了平静。',
    bark: '完成',
  },
};

export function createQuest({ scene, ui, audio, player, world, xiongdaPos }) {
  const state = {
    stage: 'intro',
    cones: 0,
    total: 7,
    treeFallen: false,
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

  const objective = { x: xiongdaPos.x, z: xiongdaPos.z, label: STAGES.intro.bark, show: true };
  const setObjective = (x, z, label) => {
    objective.x = x;
    objective.z = z;
    objective.label = label;
    marker.position.set(x, 0, z);
    marker.visible = true;
  };

  const applyStage = (stage, opts = {}) => {
    state.stage = stage;
    const info = STAGES[stage];
    ui.setQuestCard({ title: info.title, hint: info.hint });
    ui.setBossBars(null);
    if (stage === 'intro' || stage === 'report') {
      setObjective(xiongdaPos.x, xiongdaPos.z, info.bark);
    } else if (stage === 'bridge') {
      setObjective(RIVER.x - RIVER.halfWidth - 6, RIVER.bridgeZ, info.bark);
    } else if (stage === 'fight') {
      setObjective(DOOMED_TREE.x, DOOMED_TREE.z, info.bark);
    } else if (stage === 'cones') {
      // first remaining cone becomes the marker
      const left = world.pinecones.filter((c) => !c.userData.collected);
      if (left.length) setObjective(left[0].position.x, left[0].position.z, '金松果');
      else marker.visible = false;
    } else {
      marker.visible = false;
    }
    if (opts.toast) ui.toast(opts.toast, 3600);
    if (opts.sound) audio.blip(700);
  };

  const retargetCones = () => {
    if (state.stage !== 'cones') return;
    const left = world.pinecones.filter((c) => !c.userData.collected);
    if (left.length) {
      const target = player ? world.pinecones
        .filter((c) => !c.userData.collected)
        .sort((a, b) => Math.hypot(a.position.x - player.position.x, a.position.z - player.position.z)
          - Math.hypot(b.position.x - player.position.x, b.position.z - player.position.z))[0] : left[0];
      setObjective(target.position.x, target.position.z, '金松果');
    } else {
      marker.visible = false;
    }
  };

  // ---------------- stage transitions ----------------
  const onXiongdaTalked = () => {
    if (state.stage === 'intro') {
      applyStage('bridge', { toast: '新任务:走过独木桥,去阻止光头强砍树', sound: true });
    } else if (state.stage === 'report') {
      applyStage('cones', { toast: '新任务:找回 <b>7</b> 颗金松果', sound: true });
    }
  };

  const onCrossedBridge = () => {
    if (state.stage === 'bridge') {
      applyStage('fight', { toast: '光头强就在前面!按 <b>F</b> 用熊掌拍他', sound: true });
    }
  };

  const onBossDefeated = () => {
    applyStage('report', { toast: '大树保住了!回去告诉 <b>熊大</b>', sound: true });
  };

  const onTreeFell = () => {
    state.treeFallen = true;
    ui.toast('<b>大树倒了!</b> 光头强又拖来一棵小树继续砍……再来一次!', 4200);
    applyStage('fight');
  };

  const onConeCollected = (found, total) => {
    state.cones = found;
    state.total = total;
    ui.setQuestCard({
      title: STAGES.cones.title,
      hint: found >= total
        ? '七颗金松果已集齐,回营地把它们交给熊大。'
        : STAGES.cones.hint,
      progress: found,
      total,
    });
    retargetCones();
  };

  const update = (dt, time) => {
    if (marker.visible) {
      arrow.rotation.y = time * 1.6;
      arrow.position.y = 3.6 + Math.sin(time * 2.2) * 0.22;
      beamMat.opacity = 0.18 + Math.sin(time * 1.7) * 0.06;
      halo.material.opacity = 0.5 + Math.sin(time * 2.6) * 0.16;
    }
  };

  return {
    state,
    objective,
    applyStage,
    update,
    onXiongdaTalked,
    onCrossedBridge,
    onBossDefeated,
    onTreeFell,
    onConeCollected,
    retargetCones,
    stageInfo: () => STAGES[state.stage],
  };
}
