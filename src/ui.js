const DIRECTIONS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

export function createUI() {
  const $ = (id) => document.getElementById(id);
  const el = {
    hud: $('hud'),
    loading: $('loading'),
    loadBar: $('load-bar'),
    loadTip: $('load-tip'),
    start: $('start'),
    pause: $('pause'),
    win: $('win'),
    dialogue: $('dialogue'),
    dName: $('d-name'),
    dText: $('d-text'),
    prompt: $('prompt'),
    promptName: $('prompt-name'),
    toast: $('toast'),
    qNow: $('q-now'),
    qTotal: $('q-total'),
    qBar: $('q-bar'),
    qHint: $('q-hint'),
    qTitle: $('q-title'),
    qLabel: $('q-label'),
    tracker: $('tracker'),
    trTri: $('tr-tri'),
    trLabel: $('tr-label'),
    trDist: $('tr-dist'),
    boss: $('boss'),
    bHp: $('b-hp'),
    tHp: $('t-hp'),
    cDir: $('c-dir'),
    cPos: $('c-pos'),
    map: $('map'),
    touch: $('touch'),
    wCones: $('w-cones'),
    wTalked: $('w-talked'),
    wTime: $('w-time'),
    wWalk: $('w-walk'),
    winText: $('win-text'),
  };
  const ctx = el.map.getContext('2d');

  let toastTimer = 0;
  let typing = null;
  let dialogueOpen = false;
  let fullLine = '';
  let minimapStatic = null;
  let minimapLast = 0;
  let compassDir = '';
  let compassPos = '';
  let trackerOn = false;
  let trackerLabel = '';
  let trackerDist = '';
  let trackerDeg = NaN;
  let promptOn = false;
  let promptName = '';

  const api = {
    el,
    setLoading(ratio, tip) {
      el.loadBar.style.width = Math.round(ratio * 100) + '%';
      if (tip) el.loadTip.textContent = tip;
    },
    showStart() {
      el.loading.classList.add('hidden');
      el.start.classList.remove('hidden');
    },
    hideStart() { el.start.classList.add('hidden'); },
    showPause(on) { el.pause.classList.toggle('hidden', !on); },
    showWin(stats) {
      el.wCones.textContent = stats.cones;
      el.wTalked.textContent = stats.talked;
      el.wTime.textContent = stats.time;
      el.wWalk.textContent = stats.walk;
      el.winText.textContent = stats.text;
      el.win.classList.remove('hidden');
    },
    hideWin() { el.win.classList.add('hidden'); },
    setHud(on) { el.hud.classList.toggle('on', on); },
    setTouch(on) { el.touch.classList.toggle('on', on); },
    setQuest(found, total, hint) {
      el.qNow.textContent = found;
      el.qTotal.textContent = total;
      el.qBar.style.width = Math.round((found / total) * 100) + '%';
      if (hint) el.qHint.textContent = hint;
    },
    /** Stage driven quest card: title, hint and an optional progress bar. */
    setQuestCard({ title, hint, progress, total }) {
      if (title) el.qTitle.textContent = title;
      if (hint) el.qHint.textContent = hint;
      if (typeof progress === 'number' && total) {
        el.qLabel.textContent = '已找到';
        el.qNow.textContent = progress;
        el.qTotal.textContent = total;
        el.qBar.style.width = Math.round((progress / total) * 100) + '%';
      } else {
        el.qLabel.textContent = '目标';
        el.qNow.textContent = '★';
        el.qTotal.textContent = '★';
        el.qBar.style.width = '100%';
      }
    },
    /** Boss panel showing the lumberjack and the tree health. */
    setBossBars(info) {
      if (!info) {
        el.boss.classList.remove('on');
        return;
      }
      el.boss.classList.add('on');
      el.bHp.style.width = Math.round((info.hp / info.maxHp) * 100) + '%';
      el.tHp.style.width = Math.round((info.treeHp / info.treeMaxHp) * 100) + '%';
    },
    /** On screen tracker pointing at the current objective. */
    setTracker(rel) {
      if (!rel) {
        if (trackerOn) {
          el.tracker.classList.remove('on');
          trackerOn = false;
        }
        return;
      }
      if (!trackerOn) {
        el.tracker.classList.add('on');
        trackerOn = true;
      }
      if (rel.label !== trackerLabel) {
        el.trLabel.textContent = rel.label;
        trackerLabel = rel.label;
      }
      const dist = rel.distance < 1 ? '到了' : Math.round(rel.distance) + 'm';
      if (dist !== trackerDist) {
        el.trDist.textContent = dist;
        trackerDist = dist;
      }
      const deg = Math.round(rel.degrees);
      if (deg !== trackerDeg) {
        el.trTri.style.transform = 'rotate(' + deg + 'deg)';
        trackerDeg = deg;
      }
    },
    setPrompt(name) {
      const on = Boolean(name);
      if (on === promptOn && (!on || name === promptName)) return;
      if (on) {
        el.promptName.textContent = name;
        el.prompt.classList.add('on');
      } else {
        el.prompt.classList.remove('on');
      }
      promptOn = on;
      promptName = name || '';
    },
    toast(text, ms = 2200) {
      el.toast.innerHTML = text;
      el.toast.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.toast.classList.remove('on'), ms);
    },
    isDialogueOpen: () => dialogueOpen,
    openDialogue(name, line) {
      dialogueOpen = true;
      el.dialogue.classList.add('on');
      el.dName.textContent = name;
      fullLine = line;
      let i = 0;
      el.dText.textContent = '';
      clearInterval(typing);
      typing = setInterval(() => {
        i += 2;
        el.dText.textContent = fullLine.slice(0, i);
        if (i >= fullLine.length) {
          el.dText.textContent = fullLine;
          clearInterval(typing);
        }
      }, 22);
    },
    finishTyping() {
      if (typing) {
        clearInterval(typing);
        typing = null;
        el.dText.textContent = fullLine;
        return true;
      }
      return false;
    },
    closeDialogue() {
      dialogueOpen = false;
      clearInterval(typing);
      typing = null;
      el.dialogue.classList.remove('on');
    },
    setCompass(yaw, x, z) {
      const heading = (Math.atan2(Math.sin(yaw), -Math.cos(yaw)) * 180) / Math.PI;
      const index = Math.round(((heading % 360) + 360) % 360 / 45) % 8;
      // only touch the DOM when the text actually changes: a textContent write
      // invalidates layout, and these are called 60 times a second
      const dir = DIRECTIONS[index];
      const pos = Math.round(x) + ', ' + Math.round(z);
      if (dir !== compassDir) {
        el.cDir.textContent = dir;
        compassDir = dir;
      }
      if (pos !== compassPos) {
        el.cPos.textContent = pos;
        compassPos = pos;
      }
    },
    drawMinimap(world) {
      // The paths, river, grid rings and landmark labels never move, so they are
      // painted once into an offscreen canvas. Redrawing all of that (with text
      // layout) 60 times a second was pure main thread waste; the moving dots only
      // need a handful of updates a second to read correctly.
      const now = performance.now();
      if (now - minimapLast < 90) return;
      minimapLast = now;

      const w = el.map.width;
      const c = w / 2;
      const scale = (w / 2) / 136;

      if (!minimapStatic || minimapStatic.width !== w) {
        minimapStatic = document.createElement('canvas');
        minimapStatic.width = minimapStatic.height = w;
        paintMinimapBase(minimapStatic.getContext('2d'), w, c, scale, world);
      }

      ctx.clearRect(0, 0, w, w);
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, c - 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(minimapStatic, 0, 0);

      const toX = (x) => c + x * scale;
      const toY = (z) => c + z * scale;

      for (const cone of world.pinecones) {
        if (cone.collected) continue;
        ctx.beginPath();
        ctx.arc(toX(cone.x), toY(cone.z), 5.2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffb02e';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      for (const npc of world.neighbours) {
        ctx.beginPath();
        ctx.arc(toX(npc.x), toY(npc.z), 3.4, 0, Math.PI * 2);
        ctx.fillStyle = npc.talked ? 'rgba(150,230,140,0.9)' : 'rgba(255,255,255,0.75)';
        ctx.fill();
      }

      if (world.objective) {
        const ox = toX(world.objective.x);
        const oy = toY(world.objective.z);
        const pulse = 1 + Math.sin(now / 220) * 0.18;
        ctx.beginPath();
        ctx.arc(ox, oy, 8 * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffe9a8';
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ox, oy, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff3c9';
        ctx.fill();
      }

      const px = toX(world.player.x);
      const py = toY(world.player.z);
      const heading = Math.atan2(Math.sin(world.player.yaw), -Math.cos(world.player.yaw));
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(heading);
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(6, 7);
      ctx.lineTo(0, 3.5);
      ctx.lineTo(-6, 7);
      ctx.closePath();
      ctx.fillStyle = '#ff5b3a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();

      ctx.restore();
    },
  };

  return api;
}

/** The unchanging half of the minimap, painted once and reused as a bitmap. */
function paintMinimapBase(ctx, w, c, scale, world) {
  const grad = ctx.createRadialGradient(c, c, 10, c, c, c);
  grad.addColorStop(0, '#4d6b34');
  grad.addColorStop(1, '#26361b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, w);

  const toX = (x) => c + x * scale;
  const toY = (z) => c + z * scale;

  if (world.river) {
    ctx.fillStyle = 'rgba(96,178,196,0.85)';
    ctx.fillRect(
      toX(world.river.x - world.river.halfWidth), 0,
      world.river.halfWidth * 2 * scale, w,
    );
    ctx.strokeStyle = 'rgba(232,246,255,0.75)';
    ctx.lineWidth = 1.6;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(toX(world.river.x + side * world.river.halfWidth), 0);
      ctx.lineTo(toX(world.river.x + side * world.river.halfWidth), w);
      ctx.stroke();
    }
    // the bridge as a short plank across the water
    ctx.strokeStyle = '#e7c489';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(toX(world.river.x - world.river.halfWidth), toY(world.river.bridgeZ));
    ctx.lineTo(toX(world.river.x + world.river.halfWidth), toY(world.river.bridgeZ));
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(196,164,110,0.75)';
  ctx.lineWidth = Math.max(1, 5 * scale);
  ctx.lineCap = 'round';
  for (const path of world.paths) {
    ctx.beginPath();
    path.forEach(([x, z], i) => (i ? ctx.lineTo(toX(x), toY(z)) : ctx.moveTo(toX(x), toY(z))));
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let r = 30; r <= 120; r += 30) {
    ctx.beginPath();
    ctx.arc(c, c, r * scale, 0, Math.PI * 2);
    ctx.stroke();
  }

  // one font assignment for every label instead of one per landmark
  ctx.font = '11px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  for (const lm of world.landmarks) {
    ctx.fillStyle = '#ffe6ae';
    ctx.beginPath();
    ctx.arc(toX(lm.x), toY(lm.z), 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,246,221,0.85)';
    ctx.fillText(lm.label, toX(lm.x), toY(lm.z) - 8);
  }

  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,214,130,0.6)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = 'rgba(255,246,221,0.9)';
  ctx.textAlign = 'center';
  ctx.fillText('N', c, 20);
}
