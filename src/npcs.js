import * as THREE from '../vendor/three.module.js';
import { makeBlobShadow } from './assets.js';

/** Twelve forest neighbours. Bear two is the player, everybody else lives here. */
export const NEIGHBOURS = [
  {
    id: 'xiongda', name: '熊大', sprite: 'xiongda', height: 3.2, x: -3, z: -6, home: 5,
    lines: [
      '熊二!你可算醒了,太阳都晒到屁股啦。',
      '森林里的小松果被风刮得到处都是,你那七颗金松果也吹跑咯。',
      '帮我把它们找回来吧,找齐了我请你吃蜂蜜!',
    ],
    after: ['还差几颗呀?金松果会发光,夜里也看得见。'],
    done: ['全部找齐啦!你真是我们狗熊岭最棒的熊!'],
  },
  {
    id: 'cuihua', name: '翠花', sprite: 'cuihua', height: 3.0, x: -22, z: 10, home: 4,
    lines: [
      '熊二,你又在发呆呀?',
      '我刚烤好蜂蜜饼,香得很,找完松果记得回家吃饭。',
    ],
    after: ['饼还热着呢,快去吧。'],
    done: ['都找齐啦?来来来,先吃块饼!'],
  },
  {
    id: 'bengbeng', name: '蹦蹦', sprite: 'squirrel', height: 1.25, x: 8, z: 9, home: 5,
    lines: [
      '熊二熊二!我知道最大的松果藏在哪儿!',
      '就在营地北边那棵千年大树底下,风一吹就滚出来啦。',
    ],
    after: ['往北走,一直走到最大那棵树。'],
    done: ['哇,你真的全找到了!分我一颗好不好嘛?'],
  },
  {
    id: 'jiji', name: '吉吉', sprite: 'monkey', height: 1.5, x: -9, z: 14, home: 5,
    lines: [
      '哼,松果都是本大王的!你凭什么捡?',
      '……好啦好啦,巨石阵那边还有一颗,拿去拿去。',
    ],
    after: ['西边的巨石阵,你敢去吗?'],
    done: ['算你厉害,本大王服了。'],
  },
  {
    id: 'tutu', name: '涂涂', sprite: 'owl', height: 1.35, x: 12, z: -3, home: 3,
    lines: [
      '呼……白天我要睡觉,晚上才出门。',
      '不过我看见风把松果吹到东边的小路上了。',
    ],
    after: ['呼……让我再睡会儿。'],
    done: ['呼……找齐啦?那我可以安心睡觉了。'],
  },
  {
    id: 'asong', name: '阿松', sprite: 'squirrel', height: 1.15, x: -30, z: 34, home: 7,
    lines: [
      '我是蹦蹦的表弟阿松,我在守着这片林子。',
      '这附近的松果可多了,仔细找找看。',
    ],
    after: ['小声点儿,别把松鼠吓跑啦。'],
    done: ['你真厉害,比我表哥还能干。'],
  },
  {
    id: 'maomao', name: '毛毛', sprite: 'monkey', height: 1.35, x: 50, z: 46, home: 7,
    lines: [
      '吉吉大王让我在这里站岗,不许别人靠近。',
      '……其实我一个人有点怕,你能陪我聊聊天吗?',
    ],
    after: ['有你在我就不怕了。'],
    done: ['你找齐松果啦?吉吉大王要气坏咯。'],
  },
  {
    id: 'gugu', name: '咕咕长老', sprite: 'owl', height: 1.6, x: -52, z: -30, home: 4,
    lines: [
      '老夫在这片森林里住了三百年。',
      '巨石阵的石头下面,藏着一颗金松果。',
    ],
    after: ['石头会说话,你要仔细听。'],
    done: ['七颗归位,森林就安宁了。谢谢你,熊二。'],
  },
  {
    id: 'huashen', name: '花婶', sprite: 'cuihua', height: 2.9, x: 20, z: -30, home: 6,
    lines: [
      '熊二呀,别光顾着玩,森林也要有人照看。',
      '我在这儿采蘑菇,顺便帮你看着松果呢。',
    ],
    after: ['蘑菇熟了记得来拿。'],
    done: ['找齐啦?真是个好孩子。'],
  },
  {
    id: 'dahei', name: '大黑叔', sprite: 'xiongda', height: 3.4, x: -14, z: -74, home: 6,
    lines: [
      '小崽子,往北走可别迷路咯。',
      '千年大树下面风大,松果最爱滚到那儿。',
    ],
    after: ['小心脚下,别摔着。'],
    done: ['七颗都齐啦?不愧是熊家的小子。'],
  },
  {
    id: 'laoli', name: '老李', sprite: 'guangtouqiang', height: 2.05, x: 72, z: 32, home: 7,
    lines: [
      '我是新来的护林员老李,光头强的老同事。',
      '这林子里松鼠比人多,你说话它们都听得懂。',
    ],
    after: ['放心玩,树我替你看着。'],
    done: ['听说你把金松果都找回来啦?好样的。'],
  },
];

function nameplate(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const radius = 34;
  ctx.beginPath();
  ctx.moveTo(radius, 14);
  ctx.lineTo(canvas.width - radius, 14);
  ctx.quadraticCurveTo(canvas.width - 12, 14, canvas.width - 12, 14 + radius);
  ctx.lineTo(canvas.width - 12, canvas.height - 14 - radius);
  ctx.quadraticCurveTo(canvas.width - 12, canvas.height - 14, canvas.width - radius, canvas.height - 14);
  ctx.lineTo(radius, canvas.height - 14);
  ctx.quadraticCurveTo(12, canvas.height - 14, 12, canvas.height - 14 - radius);
  ctx.lineTo(12, 14 + radius);
  ctx.quadraticCurveTo(12, 14, radius, 14);
  ctx.closePath();
  ctx.fillStyle = 'rgba(24,34,22,0.72)';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(255,214,120,0.95)';
  ctx.stroke();
  ctx.font = 'bold 62px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillStyle = '#fff6dd';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

let sharedShadow = null;

/** Build one standing character: body sprite, blob shadow and name plate. */
export function createCharacter(scene, tex, data) {
  if (!sharedShadow) sharedShadow = makeBlobShadow();
  const texture = tex[data.sprite];
  const image = texture.image || { width: 1, height: 1 };
  const aspect = (image.width || 1) / (image.height || 1);
  const material = new THREE.SpriteMaterial({
    map: texture, transparent: false, alphaTest: 0.4, fog: true, depthWrite: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0);
  sprite.scale.set(data.height * aspect, data.height, 1);
  sprite.position.set(data.x, 0, data.z);
  scene.add(sprite);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(data.height * 0.8, data.height * 0.8),
    new THREE.MeshBasicMaterial({ map: sharedShadow, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(data.x, 0.035, data.z);
  scene.add(shadow);

  const plate = new THREE.Sprite(new THREE.SpriteMaterial({
    map: nameplate(data.name), transparent: true, opacity: 0, depthWrite: false, fog: true,
  }));
  plate.scale.set(1.55, 0.39, 1);
  plate.position.set(data.x, data.height + 0.45, data.z);
  plate.center.set(0.5, 0.5);
  scene.add(plate);

  return {
    ...data,
    sprite,
    shadow,
    plate,
    talked: false,
    state: 'idle',
    timer: 1 + Math.random() * 3,
    target: new THREE.Vector2(data.x, data.z),
    bob: Math.random() * Math.PI * 2,
    speed: 0.55 + Math.random() * 0.35,
  };
}

/** Nearest conversation partner within `maxDistance`, or null. */
export function nearestOf(list, playerPos, maxDistance = 4.2) {
  let best = null;
  let bestDistance = maxDistance;
  for (const npc of list) {
    if (npc.hidden) continue;
    const d = Math.hypot(playerPos.x - npc.sprite.position.x, playerPos.z - npc.sprite.position.z);
    if (d < bestDistance) {
      bestDistance = d;
      best = npc;
    }
  }
  return best;
}

/** Keep the name plate and blob shadow of a character in sync with its body. */
export function syncCharacter(npc, dt, playerPos) {
  const toPlayer = Math.hypot(playerPos.x - npc.sprite.position.x, playerPos.z - npc.sprite.position.z);
  const base = npc.height;
  npc.plate.position.set(npc.sprite.position.x, npc.sprite.position.y + base + 0.55, npc.sprite.position.z);
  const fadeIn = Math.min(1, Math.max(0, (toPlayer - 4.8) / 2.8));
  const fadeOut = Math.min(1, Math.max(0, (20 - toPlayer) / 6));
  const wantOpacity = fadeIn * fadeOut * 0.92;
  npc.plate.material.opacity += (wantOpacity - npc.plate.material.opacity) * Math.min(1, dt * 6);
  npc.shadow.position.set(npc.sprite.position.x, 0.035, npc.sprite.position.z);
  npc.near = toPlayer < 4.2;
  return toPlayer;
}

export function buildNeighbours(scene, tex) {
  const list = NEIGHBOURS.map((data, index) => {
    const npc = createCharacter(scene, tex, data);
    npc.index = index;
    return npc;
  });

  const update = (dt, time, playerPos) => {
    for (const npc of list) {
      const toPlayer = Math.hypot(playerPos.x - npc.sprite.position.x, playerPos.z - npc.sprite.position.z);
      npc.timer -= dt;
      if (npc.timer <= 0) {
        if (npc.state === 'idle' && toPlayer > 3.2) {
          const angle = Math.random() * Math.PI * 2;
          const radius = 1.5 + Math.random() * npc.home;
          npc.target.set(npc.x + Math.cos(angle) * radius, npc.z + Math.sin(angle) * radius);
          npc.state = 'walk';
          npc.timer = 2 + Math.random() * 4;
        } else {
          npc.state = 'idle';
          npc.timer = 1.2 + Math.random() * 3.4;
        }
      }

      let moving = false;
      if (npc.state === 'walk') {
        const dx = npc.target.x - npc.sprite.position.x;
        const dz = npc.target.y - npc.sprite.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > 0.25) {
          const step = Math.min(distance, npc.speed * dt);
          npc.sprite.position.x += (dx / distance) * step;
          npc.sprite.position.z += (dz / distance) * step;
          moving = true;
        } else {
          npc.state = 'idle';
          npc.timer = 1.4 + Math.random() * 3;
        }
      }

      npc.bob += dt * (moving ? 7.5 : 1.9);
      const base = npc.height;
      const breathe = 1 + Math.sin(npc.bob) * (moving ? 0.03 : 0.012);
      const aspect = npc.sprite.scale.x / npc.sprite.scale.y;
      npc.sprite.scale.set(base * aspect * breathe, base * breathe, 1);
      npc.sprite.position.y = moving ? Math.abs(Math.sin(npc.bob)) * 0.09 : 0;

      syncCharacter(npc, dt, playerPos);
    }
  };

  const nearest = (playerPos) => nearestOf(list, playerPos);

  return { list, update, nearest };
}
